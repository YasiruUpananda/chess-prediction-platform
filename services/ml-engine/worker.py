import hashlib
import json
import logging
import os
import random
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import chess.pgn

from database import connect, init_db
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


def game_identity(game):
    canonical = json.dumps({"headers": dict(sorted(game.headers.items())),
        "fen": game.board().fen(), "moves": [move.uci() for move in game.mainline_moves()]}, sort_keys=True)
    return hashlib.sha256(canonical.encode()).hexdigest()


def process_pgn(filename):
    from langchain_core.documents import Document
    from rag_store import get_vector_store

    path = resolve_pgn_path(filename)
    count = 0
    with path.open(encoding="utf-8", errors="replace") as pgn_file:
        while (game := chess.pgn.read_game(pgn_file)) is not None:
            if game.errors:
                raise ValueError("PGN contains invalid moves; correct the file before retrying")
            if not any(game.mainline_moves()):
                continue
            digest = game_identity(game)
            white, black = game.headers.get("White", "Unknown"), game.headers.get("Black", "Unknown")
            with connect() as db:
                db.execute("INSERT INTO ingested_games(id, white, black) VALUES (%s,%s,%s) ON CONFLICT DO NOTHING",
                           (digest, white, black))
                indexed = db.execute("SELECT indexed FROM ingested_games WHERE id=%s", (digest,)).fetchone()[0]
                if indexed:
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
            document = Document(
                page_content=game.accept(chess.pgn.StringExporter(headers=True, variations=False, comments=False)),
                metadata={"white": white, "black": black, "white_normalized": white.strip().casefold(),
                          "black_normalized": black.strip().casefold(), "game_id": digest})
            # Stable vector IDs make a crash before the indexed flag safe to retry.
            get_vector_store().add_documents([document], ids=[digest])
            with connect() as db:
                db.execute("UPDATE ingested_games SET indexed=true WHERE id=%s", (digest,))
            count += 1
    if not count:
        raise ValueError("PGN contains no playable games")
    logger.info("Verified %d indexed games from %s", count, path.name)
    return count


def decode_task(body):
    data = json.loads(body)
    if not isinstance(data, dict):
        raise ValueError("Expected a job object")
    resolve_pgn_path(data.get("filename"))
    return data["filename"]


def main():
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
                        HEALTH_FILE.touch()
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
                            future = pool.submit(process_pgn, decode_task(body))
                            while not future.done():
                                conn.process_data_events(time_limit=1)
                                HEALTH_FILE.touch()
                            future.result()
                        except Exception as exc:
                            logger.exception("Ingestion job failed")
                            error = exc
                        attempts = int((properties.headers or {}).get("attempts", 0))
                        finish(channel, method.delivery_tag, body, attempts, error)
            except Exception as exc:
                HEALTH_FILE.unlink(missing_ok=True)
                logger.warning("Worker disconnected (%s); retrying in %ss", type(exc).__name__, delay)
                time.sleep(delay + random.random())
                delay = min(delay * 2, 30)


if __name__ == "__main__":
    main()
