import os

from langchain_postgres import PGVector
from langchain_huggingface import HuggingFaceEmbeddings

CONNECTION_STRING = os.getenv("DATABASE_URL")
if not CONNECTION_STRING:
    raise ValueError("DATABASE_URL environment variable is not set!")
COLLECTION_NAME = "chess_games_vector"

def get_vector_store():
    embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
    
    vector_store = PGVector(
        embeddings=embeddings,
        collection_name=COLLECTION_NAME,
        connection=CONNECTION_STRING,
        use_jsonb=True,
    )
    return vector_store

if __name__ == "__main__":
    store = get_vector_store()
    print("PGVector store initialized successfully against Docker PostgreSQL!")