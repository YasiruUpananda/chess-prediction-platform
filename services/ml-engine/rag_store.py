import os
import threading
from functools import lru_cache

from langchain_postgres import PGVector
from langchain_huggingface import HuggingFaceEmbeddings

COLLECTION_NAME = "chess_games_vector"
_initialization_lock = threading.Lock()


def get_vector_store():
    # Warmup and incoming requests can overlap. Avoid duplicate model loads.
    with _initialization_lock:
        return _cached_vector_store()

@lru_cache(maxsize=1)
def _cached_vector_store():
    connection_string = os.getenv("DATABASE_URL")
    if not connection_string:
        raise RuntimeError("DATABASE_URL environment variable is not set")

    model_name = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
    try:
        embeddings = HuggingFaceEmbeddings(model_name=model_name, model_kwargs={"local_files_only": True})
    except OSError:
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
