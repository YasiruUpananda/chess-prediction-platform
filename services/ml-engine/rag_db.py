import os
from langchain_community.vectorstores import PGVector

CONNECTION_STRING = "postgresql+psycopg2://postgres:postgres@host.docker.internal:5432/chessrag"

# Print this out during startup to verify what Docker is running
print("DEBUG DATABASE URL:", CONNECTION_STRING)

COLLECTION_NAME = "chess_games_vector_store"

def get_vector_store(embeddings):
    return PGVector(
        embeddings=embeddings,
        collection_name=COLLECTION_NAME,
        connection=CONNECTION_STRING,
        use_jsonb=True,
    )