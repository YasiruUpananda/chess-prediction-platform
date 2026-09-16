import os
import json
import time
import chess.pgn
import pika
import psycopg2
from psycopg2.extras import execute_values

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@db:5432/chessrag")
RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/")

def get_db_connection():
    """Connects to PostgreSQL with retry logic."""
    while True:
        try:
            conn = psycopg2.connect(DATABASE_URL)
            return conn
        except Exception as e:
            print(f"Waiting for database... ({e})")
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
    """)
    conn.commit()
    cur.close()
    conn.close()
    print("Database tables verified.")

def process_pgn(file_path: str):
    """Parses a PGN file and bulk-inserts player moves into PostgreSQL."""
    if not os.path.exists(file_path):
        print(f"File not found: {file_path}")
        return

    conn = get_db_connection()
    cur = conn.cursor()

    records = []
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

    cur.close()
    conn.close()
    print(f"Successfully processed {games_parsed} games from {file_path}!")

def on_message(ch, method, properties, body):
    data = json.loads(body.decode("utf-8"))
    file_path = data.get("filename")
    print(f"Received ingestion task for: {file_path}")

    process_pgn(file_path)
    ch.basic_ack(delivery_tag=method.delivery_tag)

def main():
    init_db()
    params = pika.URLParameters(RABBITMQ_URL)
    connection = pika.BlockingConnection(params)
    channel = connection.channel()

    channel.queue_declare(queue="pgn_ingestion_queue", durable=True)
    channel.basic_qos(prefetch_count=1)
    channel.basic_consume(queue="pgn_ingestion_queue", on_message_callback=on_message)

    print("RabbitMQ PGN Worker started. Waiting for tasks...")
    channel.start_consuming()

if __name__ == "__main__":
    main()