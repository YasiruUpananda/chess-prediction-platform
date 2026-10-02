import os
import json
import hashlib
import time
import logging
from pathlib import Path
import chess.pgn
import pika
import psycopg2
from psycopg2.extras import execute_values
from langchain_core.documents import Document
from rag_store import get_vector_store

DATABASE_URL = os.getenv("WORKER_DATABASE_URL")
RABBITMQ_URL = os.getenv("RABBITMQ_URL")
PGN_DATA_DIR = Path(os.getenv("PGN_DATA_DIR", "/app/data")).resolve()
logger = logging.getLogger("neuro_chess.worker")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))


def resolve_pgn_path(filename: str) -> Path:
    requested = Path(filename)
    candidate = (PGN_DATA_DIR / requested.name).resolve()
    if requested.name != filename or candidate.parent != PGN_DATA_DIR or candidate.suffix.lower() != ".pgn":
        raise ValueError("Ingestion accepts only PGN filenames inside PGN_DATA_DIR")
    return candidate

def get_db_connection():
    """Connects to PostgreSQL with retry logic."""
    if not DATABASE_URL:
        raise RuntimeError("WORKER_DATABASE_URL must be configured")
    while True:
        try:
            conn = psycopg2.connect(DATABASE_URL)
            return conn
        except Exception as e:
            logger.warning("PostgreSQL unavailable; retrying in 2 seconds (%s)", type(e).__name__)
            time.sleep(2)

def init_db():
    """Creates the games and positions tables if they do not exist."""
    conn = get_db_connection()
    cur = conn.cursor()
    
    # Table to store unique positions and moves played by specific players
    cur.execute("""
        CREATE TABLE IF NOT EXISTS player_moves (
            id SERIAL PRIMARY KEY,
            player_name VARCHAR(255) NOT NULL,
            color VARCHAR(10) NOT NULL,
            fen TEXT NOT NULL,
            move_played VARCHAR(20) NOT NULL,
            san VARCHAR(20) NOT NULL,
            tournament VARCHAR(255),
            result VARCHAR(10)
        );
        CREATE INDEX IF NOT EXISTS idx_player_fen ON player_moves (player_name, fen);
        CREATE INDEX IF NOT EXISTS idx_player_position ON player_moves (
            lower(player_name), split_part(fen, ' ', 1), split_part(fen, ' ', 2), split_part(fen, ' ', 3)
        );
    """)
    conn.commit()
    cur.close()
    conn.close()
    print("Database tables verified.")

def process_pgn(filename: str):
    """Parses a PGN file and bulk-inserts player moves into PostgreSQL."""
    file_path = resolve_pgn_path(filename)
    if not file_path.is_file():
        raise FileNotFoundError(f"PGN file not found: {filename}")

    conn = get_db_connection()
    cur = conn.cursor()

    records = []
    documents = []
    document_ids = []
    vector_store = None
    games_parsed = 0

    with open(file_path, "r", encoding="utf-8", errors="replace") as pgn_file:
        while True:
            game = chess.pgn.read_game(pgn_file)
            if game is None:
                break

            white = game.headers.get("White", "Unknown")
            black = game.headers.get("Black", "Unknown")
            event = game.headers.get("Event", "Unknown Tournament")
            result = game.headers.get("Result", "*")

            exporter = chess.pgn.StringExporter(headers=True, variations=False, comments=False)
            pgn_text = game.accept(exporter)
            digest = hashlib.sha256(pgn_text.encode("utf-8")).hexdigest()
            documents.append(Document(
                page_content=pgn_text,
                metadata={"white": white, "black": black, "event": event, "result": result},
            ))
            document_ids.append(digest)

            board = game.board()
            for move in game.mainline_moves():
                player = white if board.turn == chess.WHITE else black
                color = "white" if board.turn == chess.WHITE else "black"
                fen = board.fen()
                san = board.san(move)
                uci = move.uci()

                records.append((player, color, fen, uci, san, event, result))
                board.push(move)

            games_parsed += 1

            # Batch insert every 500 records to keep memory lean
            if len(records) >= 500:
                execute_values(
                    cur,
                    """
                    INSERT INTO player_moves 
                    (player_name, color, fen, move_played, san, tournament, result) 
                    VALUES %s
                    """,
                    records
                )
                conn.commit()
                records = []

            if len(documents) >= 32:
                if vector_store is None:
                    vector_store = get_vector_store()
                vector_store.add_documents(documents, ids=document_ids)
                documents = []
                document_ids = []

    # Insert remaining records
    if records:
        execute_values(
            cur,
            """
            INSERT INTO player_moves 
            (player_name, color, fen, move_played, san, tournament, result) 
            VALUES %s
            """,
            records
        )
        conn.commit()

    if documents:
        if vector_store is None:
            vector_store = get_vector_store()
        vector_store.add_documents(documents, ids=document_ids)

    cur.close()
    conn.close()
    logger.info("Processed %d PGN games from %s", games_parsed, file_path.name)

def on_message(ch, method, properties, body):
    data = json.loads(body.decode("utf-8"))
    filename = data.get("filename", "")
    try:
        process_pgn(filename)
        ch.basic_ack(delivery_tag=method.delivery_tag)
    except Exception:
        logger.exception("PGN ingestion failed for %r", filename)
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)

def main():
    if not RABBITMQ_URL:
        raise RuntimeError("RABBITMQ_URL must be configured")
    init_db()
    params = pika.URLParameters(RABBITMQ_URL)
    connection = pika.BlockingConnection(params)
    channel = connection.channel()

    channel.queue_declare(queue="pgn_ingestion_queue", durable=True)
    channel.basic_qos(prefetch_count=1)
    channel.basic_consume(queue="pgn_ingestion_queue", on_message_callback=on_message)

    logger.info("PGN ingestion worker started")
    channel.start_consuming()

if __name__ == "__main__":
    main()
