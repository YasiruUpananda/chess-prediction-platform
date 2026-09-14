import os
import psycopg2
import chess.pgn
from pgvector.psycopg2 import register_vector
import google.generativeai as genai

# 1. Initialize API and Database connections
genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))
conn = psycopg2.connect(os.getenv("DATABASE_URL"))
register_vector(conn)
cursor = conn.cursor()

# 2. Create the vector table if it doesn't exist
cursor.execute("""
    CREATE TABLE IF NOT EXISTS opponent_history (
        id serial PRIMARY KEY,
        player_name text,
        game_context text,
        embedding vector(768) 
    )
""")
conn.commit()

def embed_and_store_game(pgn_path):
    with open(pgn_path) as pgn_file:
        while True:
            game = chess.pgn.read_game(pgn_file)
            if game is None:
                break
            
            # Extract metadata
            white = game.headers.get("White", "Unknown")
            black = game.headers.get("Black", "Unknown")
            event = game.headers.get("Event", "Unknown Event")
            eco = game.headers.get("ECO", "Unknown")
            
            # 3. Create a searchable text summary for the AI
            context = f"{white} vs {black} at {event}. Opening ECO: {eco}."
            print(f"Analyzing: {context}")
            
            # 4. Generate the vector embedding using Gemini
            result = genai.embed_content(
                model="models/embedding-001",
                content=context,
                task_type="retrieval_document"
            )
            
            # 5. Insert into pgvector
            cursor.execute(
                "INSERT INTO opponent_history (player_name, game_context, embedding) VALUES (%s, %s, %s)",
                (black, context, result['embedding'])
            )
            conn.commit()
            print(f"Successfully vectorized and stored game for {black}.")
            
if __name__ == "__main__":
    embed_and_store_game("sample_games.pgn")