"""Explicit, transactional, checksum-verified platform migrations."""
import argparse
import hashlib
from pathlib import Path

MIGRATIONS = Path(__file__).with_name('migrations')


def definitions():
    sql = (MIGRATIONS / '0001_platform.sql').read_text(encoding='utf8')
    return [('0001_platform', hashlib.sha256(sql.encode()).hexdigest(), sql),
            ('0002_position_keys', 'canonical-legal-ep-v1-batched', None)]


def backfill_positions(db):
    import chess
    from chess_positions import position_key
    last = 0
    while True:
        rows = db.execute('SELECT id,fen FROM player_moves WHERE position_key IS NULL AND id>%s ORDER BY id LIMIT 500', (last,)).fetchall()
        if not rows:
            return
        updates = []
        for row_id, fen in rows:
            last = row_id
            try:
                board = chess.Board(fen)
                if board.is_valid():
                    updates.append((position_key(board), row_id))
            except ValueError:
                pass
        if updates:
            with db.cursor() as cursor:
                cursor.executemany('UPDATE player_moves SET position_key=%s WHERE id=%s', updates)


def check_schema(db):
    if db.execute("SELECT to_regclass('public.schema_migrations')").fetchone()[0] is None:
        raise RuntimeError('Database migrations are required: run python migrate.py apply')
    applied = dict(db.execute('SELECT version,checksum FROM schema_migrations').fetchall())
    for version, checksum, _ in definitions():
        if applied.get(version) != checksum:
            raise RuntimeError(f'Database migration missing or changed: {version}. Run python migrate.py apply')


def apply(db):
    db.execute('SELECT pg_advisory_xact_lock(734210)')
    db.execute('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())')
    applied = dict(db.execute('SELECT version,checksum FROM schema_migrations').fetchall())
    for version, checksum, sql in definitions():
        if version in applied:
            if applied[version] != checksum:
                raise RuntimeError(f'Applied migration has changed: {version}')
            continue
        if sql:
            db.execute(sql)
        else:
            backfill_positions(db)
        db.execute('INSERT INTO schema_migrations(version,checksum) VALUES (%s,%s)', (version, checksum))
        print(f'Applied {version}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['apply', 'check'])
    args = parser.parse_args()
    from database import connect, close_pool
    try:
        with connect() as db:
            (apply if args.command == 'apply' else check_schema)(db)
    finally:
        close_pool()
