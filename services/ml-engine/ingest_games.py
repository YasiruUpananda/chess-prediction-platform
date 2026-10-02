"""Operator CLI for the same idempotent ingestion used by the queue worker."""
import argparse
from database import init_db, close_pool
from worker import process_pgn

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('filename', help='PGN filename inside PGN_DATA_DIR')
    args = parser.parse_args()
    try:
        init_db()
        print(f'Verified {process_pgn(args.filename)} indexed games.')
    finally:
        close_pool()

if __name__ == '__main__':
    main()
