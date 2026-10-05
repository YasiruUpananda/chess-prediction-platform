"""Explicit, transactional, checksum-verified platform migrations."""
import argparse
import hashlib
from pathlib import Path

MIGRATIONS = Path(__file__).with_name('migrations')


def definitions():
    sql = (MIGRATIONS / '0001_platform.sql').read_text(encoding='utf8')
    vector_sql=(MIGRATIONS / '0003_vectors_identity.sql').read_text(encoding='utf8')
    return [('0001_platform', hashlib.sha256(sql.encode()).hexdigest(), sql),
            ('0002_position_keys', 'canonical-legal-ep-v1-batched', None),
            ('0003_vectors_identity',hashlib.sha256(vector_sql.encode()).hexdigest(),vector_sql),
            ('0004_game_identity_backfill','canonical-headers-v1',None)]

def backfill_games(db):
    import io
    import chess.pgn
    from game_identity import game_identity
    from player_identity import register_game
    last=''
    while True:
        rows=db.execute('SELECT g.id,e.document FROM ingested_games g JOIN langchain_pg_embedding e ON e.id=g.id WHERE g.canonical_id IS NULL AND g.id>%s ORDER BY g.id LIMIT 500',(last,)).fetchall()
        if not rows: return
        for identity,text in rows:
            last=identity
            game=chess.pgn.read_game(io.StringIO(text))
            if game is None or game.errors: continue
            canonical=game_identity(game)
            previous=db.execute('SELECT id FROM ingested_games WHERE canonical_id=%s AND duplicate_of IS NULL',(canonical,)).fetchone()
            db.execute('UPDATE ingested_games SET canonical_id=%s,duplicate_of=%s,indexed=CASE WHEN %s::text IS NULL THEN indexed ELSE false END,played_date=%s,event=%s WHERE id=%s',
                (canonical,previous[0] if previous else None,previous[0] if previous else None,game.headers.get('Date'),game.headers.get('Event'),identity))
            register_game(db,identity,game)


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
        elif version=='0002_position_keys':
            backfill_positions(db)
        else:
            backfill_games(db)
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
            if args.command=='apply':
                from database_roles import provision
                provision(db)
    finally:
        close_pool()
