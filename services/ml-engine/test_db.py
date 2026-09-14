import os

from sqlalchemy import create_engine, text

CONNECTION_STRING = os.getenv("DATABASE_URL")
if not CONNECTION_STRING:
    raise ValueError("DATABASE_URL environment variable is not set!")

try:
    engine = create_engine(DB_URL)
    with engine.connect() as connection:
        result = connection.execute(text("SELECT version();"))
        for row in result:
            print("Successfully connected to Docker PostgreSQL via Psycopg 3:", row[0])
except Exception as e:
    print("Connection failed:", e)