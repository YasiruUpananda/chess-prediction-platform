import os
from functools import lru_cache

from langchain_postgres import PGVector
from langchain_huggingface import HuggingFaceEmbeddings

COLLECTION_NAME = "chess_games_vector"

@lru_cache(maxsize=1)
def get_vector_store():
    connection_string = os.getenv("DATABASE_URL")
    if not connection_string:
        raise RuntimeError("DATABASE_URL environment variable is not set")

    model_name = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
    embeddings = HuggingFaceEmbeddings(model_name=model_name)
    vector_store = PGVector(
        embeddings=embeddings,
        collection_name=COLLECTION_NAME,
        connection=connection_string,
        use_jsonb=True,
    )
    return vector_store

if __name__ == "__main__":
    store = get_vector_store()
    print("PGVector store initialized successfully against Docker PostgreSQL!")
