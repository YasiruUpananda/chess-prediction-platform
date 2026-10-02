"""Operator-controlled HNSW expression index; never change search mode implicitly."""
import argparse
from database import connect, close_pool

INDEX_NAME = 'idx_chess_embedding_hnsw_384'


def index_status():
    with connect() as db:
        count = db.execute('SELECT count(*) FROM langchain_pg_embedding').fetchone()[0]
        exists = db.execute('SELECT EXISTS(SELECT 1 FROM pg_index WHERE '
                            'indexrelid=to_regclass(%s) AND indisvalid)', (INDEX_NAME,)).fetchone()[0]
        version = db.execute("SELECT extversion FROM pg_extension WHERE extname='vector'").fetchone()[0]
        dimensions = db.execute('SELECT DISTINCT vector_dims(embedding) FROM langchain_pg_embedding').fetchall()
    return {'rows': count, 'index_exists': exists, 'dimensions': [row[0] for row in dimensions], 'pgvector_version': version}


def install(minimum_rows=10000):
    status = index_status()
    if status['index_exists']: return status
    if status['rows'] < minimum_rows:
        raise ValueError(f"Only {status['rows']} rows: benchmark first; minimum is {minimum_rows}")
    if status['dimensions'] != [384]:
        raise ValueError('This index requires 384-dimensional MiniLM embeddings')
    if tuple(int(part) for part in status['pgvector_version'].split('.')[:2]) < (0, 8):
        raise ValueError('Upgrade pgvector to 0.8+ for filtered iterative scanning')
    # Concurrent build avoids blocking ingestion; run outside the pool transaction.
    import psycopg
    import os
    url = os.getenv('WORKER_DATABASE_URL') or os.environ['DATABASE_URL']
    with psycopg.connect(url.replace('postgresql+psycopg://', 'postgresql://', 1), autocommit=True) as db:
        db.execute('SET statement_timeout=300000')
        db.execute('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chess_embedding_hnsw_384 '
                   'ON langchain_pg_embedding USING hnsw ((embedding::vector(384)) vector_cosine_ops)')
    result = index_status()
    if not result['index_exists']:
        raise RuntimeError('Index is invalid: inspect and remove the failed index before retrying')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--minimum-rows', type=int, default=10000)
    args = parser.parse_args()
    try:
        print(install(args.minimum_rows) if args.apply else index_status())
    finally:
        close_pool()
