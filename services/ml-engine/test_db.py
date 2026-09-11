from sqlalchemy import create_engine, text

# Explicitly use the modern psycopg v3 driver format
DB_URL = "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/chess_rag_db"

try:
    engine = create_engine(DB_URL)
    with engine.connect() as connection:
        result = connection.execute(text("SELECT version();"))
        for row in result:
            print("Successfully connected to Docker PostgreSQL via Psycopg 3:", row[0])
except Exception as e:
    print("Connection failed:", e)