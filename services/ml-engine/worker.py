from telemetry import traced
import hashlib
import json
import logging
import os
import random
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import chess.pgn
from game_identity import game_identity
from player_identity import register_game, register_player
from psycopg.types.json import Jsonb

from database import connect, init_db
from backend_health import heartbeat
from chess_positions import position_key
from task_queue import QUEUE, RETRY_QUEUE, connection, finish, setup

PGN_DATA_DIR = Path(os.getenv("PGN_DATA_DIR", "/app/data")).resolve()
HEALTH_FILE = Path("/tmp/ingestion-heartbeat")
logger = logging.getLogger("neuro_chess.worker")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))


def resolve_pgn_path(filename):
    if not isinstance(filename, str) or not filename:
        raise ValueError("A PGN filename is required")
    requested = Path(filename)
    candidate = (PGN_DATA_DIR / requested.name).resolve()
    if requested.name != filename or candidate.parent != PGN_DATA_DIR or candidate.suffix.lower() != ".pgn":
        raise ValueError("Ingestion accepts only PGN filenames inside PGN_DATA_DIR")
    return candidate


@traced('process_pgn')
def process_pgn(filename):
    from langchain_core.documents import Document
    from rag_store import get_vector_store

    path = resolve_pgn_path(filename)
    count = 0
    source_hash=hashlib.sha256()
    with path.open('rb') as content:
        for chunk in iter(lambda:content.read(1024*1024),b''): source_hash.update(chunk)
    with connect() as db:
        batch=db.execute('INSERT INTO import_batches(source_name,source_hash) VALUES (%s,%s) RETURNING id',(path.name,source_hash.hexdigest())).fetchone()[0]
    try:
        with path.open(encoding="utf-8", errors="replace") as pgn_file:
            while (game := chess.pgn.read_game(pgn_file)) is not None:
                if game.errors:
                    raise ValueError("PGN contains invalid moves; correct the file before retrying")
                if not any(game.mainline_moves()):
                    continue
                digest = game_identity(game)
                white, black = game.headers.get("White", "Unknown"), game.headers.get("Black", "Unknown")
                with connect() as db:
                    existing=db.execute('SELECT id FROM ingested_games WHERE canonical_id=%s AND duplicate_of IS NULL',(digest,)).fetchone()
                    if existing: digest=existing[0]
                    db.execute("INSERT INTO ingested_games(id, white, black,canonical_id,played_date,event) VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                               (digest, white, black,game_identity(game),game.headers.get('Date'),game.headers.get('Event')))
                    db.execute('INSERT INTO game_exports(game_id,batch_id,headers) VALUES (%s,%s,%s) ON CONFLICT DO NOTHING',(digest,batch,Jsonb(dict(game.headers))))
                    indexed = db.execute("SELECT indexed FROM ingested_games WHERE id=%s", (digest,)).fetchone()[0]
                    if indexed:
                        register_game(db,digest,game)
                        count += 1
                        continue
                    board = game.board()
                    rows = []
                    for ply, move in enumerate(game.mainline_moves(), 1):
                        rows.append((white if board.turn else black, "white" if board.turn else "black",
                            board.fen(), move.uci(), board.san(move), game.headers.get("Event", "Unknown"),
                            game.headers.get("Result", "*"), digest, ply, position_key(board)))
                        board.push(move)
                    with db.cursor() as cursor:
                        cursor.executemany("""INSERT INTO player_moves
                            (player_name,color,fen,move_played,san,tournament,result,game_id,ply,position_key)
                            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (game_id,ply) DO NOTHING""", rows)
                    register_game(db,digest,game)
                    white_id=register_player(db,game.headers,'White');black_id=register_player(db,game.headers,'Black')
                document = Document(
                    page_content=game.accept(chess.pgn.StringExporter(headers=True, variations=False, comments=False)),
                    metadata={"white": white, "black": black, "white_normalized": white.strip().casefold(),
                              "black_normalized": black.strip().casefold(), "game_id": digest})
                document.metadata.update(white_id=white_id,black_id=black_id)
                # Stable vector IDs make a crash before the indexed flag safe to retry.
                get_vector_store().add_documents([document], ids=[digest])
                with connect() as db:
                    db.execute("UPDATE ingested_games SET indexed=true WHERE id=%s", (digest,))
                count += 1
        if not count:
            raise ValueError("PGN contains no playable games")
    except Exception:
        try:
            with connect() as db:
                db.execute("UPDATE import_batches SET games=%s,status='failed' WHERE id=%s",(count,batch))
        except Exception:
            logger.warning('Could not record failed import batch')
        raise
    logger.info("Verified %d indexed games from %s", count, path.name)
    with connect() as db:
        db.execute("UPDATE import_batches SET games=%s,status='completed' WHERE id=%s",(count,batch))
        db.execute('UPDATE dataset_version SET version=version+1 WHERE id=1')
    return count


def decode_task(body):
    data = json.loads(body)
    if not isinstance(data, dict):
        raise ValueError("Expected a job object")
    resolve_pgn_path(data.get("filename"))
    return data["filename"]


def main():
    from telemetry import configure
    configure('neuro-chess-worker')
    from metrics import start_worker_metrics, JOBS
    start_worker_metrics()
    delay = 1
    with ThreadPoolExecutor(max_workers=1) as pool:
        while True:
            try:
                init_db()
                with connection() as conn:
                    channel = conn.channel()
                    setup(channel)
                    channel.basic_qos(prefetch_count=1)
                    logger.info("Ingestion worker connected")
                    delay = 1
                    while conn.is_open:
                        heartbeat('ingestion', HEALTH_FILE)
                        method, properties, body = channel.basic_get(QUEUE, auto_ack=False)
                        if method is None:
                            method, properties, body = channel.basic_get(RETRY_QUEUE, auto_ack=False)
                            if method is not None:
                                conn.sleep(10)
                        if method is None:
                            conn.process_data_events(time_limit=1)
                            continue
                        error = None
                        try:
                            from telemetry import continued
                            future = pool.submit(continued, properties.headers, process_pgn, decode_task(body))
                            while not future.done():
                                conn.process_data_events(time_limit=1)
                                heartbeat('ingestion', HEALTH_FILE)
                            future.result()
                            JOBS.labels('ingestion','completed').inc()
                        except Exception as exc:
                            JOBS.labels('ingestion','failed').inc()
                            logger.exception("Ingestion job failed")
                            error = exc
                        attempts = int((properties.headers or {}).get("attempts", 0))
                        finish(channel, method.delivery_tag, body, attempts, error, properties.headers)
            except Exception as exc:
                HEALTH_FILE.unlink(missing_ok=True)
                logger.warning("Worker disconnected (%s); retrying in %ss", type(exc).__name__, delay)
                time.sleep(delay + random.random())
                delay = min(delay * 2, 30)


if __name__ == "__main__":
    main()
