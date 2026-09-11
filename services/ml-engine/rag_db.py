import os
from langchain_community.vectorstores import PGVector

# Connection string template for local PostgreSQL with pgvector
# Format: postgresql+psycopg2://user:password@host:port/dbname
CONNECTION_STRING = os.getenv(
    "DATABASE_URL", 
    "postgresql+psycopg2://postgres:postgres@localhost:5432/chess_rag_db"
)
COLLECTION_NAME = "chess_games_vector_store"

def get_vector_store(embeddings):
    """Initializes and returns the PGVector store instance."""
    return PGVector(
        embeddings=embeddings,
        collection_name=COLLECTION_NAME,
        connection=CONNECTION_STRING,
        use_jsonb=True,
    )