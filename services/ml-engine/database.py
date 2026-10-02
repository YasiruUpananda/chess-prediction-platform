"""Shared additive schema migrations and bounded database connections."""
import os
import psycopg


def connect():
    url = os.getenv("WORKER_DATABASE_URL") or os.environ["DATABASE_URL"]
    return psycopg.connect(url.replace("postgresql+psycopg://", "postgresql://", 1),
                           connect_timeout=5, options="-c statement_timeout=15000")


def init_db():
    with connect() as db:
        db.execute("SELECT pg_advisory_xact_lock(734210)")
        db.execute("""
            CREATE TABLE IF NOT EXISTS ingested_games (
                id TEXT PRIMARY KEY, white TEXT NOT NULL, black TEXT NOT NULL,
                indexed BOOLEAN NOT NULL DEFAULT false,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS player_moves (
                id BIGSERIAL PRIMARY KEY, player_name TEXT NOT NULL, color TEXT NOT NULL,
                fen TEXT NOT NULL, move_played TEXT NOT NULL, san TEXT NOT NULL,
                tournament TEXT, result TEXT, game_id TEXT, ply INTEGER
            );
            ALTER TABLE player_moves ADD COLUMN IF NOT EXISTS game_id TEXT;
            ALTER TABLE player_moves ADD COLUMN IF NOT EXISTS ply INTEGER;
            ALTER TABLE player_moves ADD COLUMN IF NOT EXISTS position_key TEXT;
            CREATE INDEX IF NOT EXISTS idx_player_canonical_position
                ON player_moves(lower(trim(player_name)), position_key);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_game_ply ON player_moves(game_id, ply);
            CREATE INDEX IF NOT EXISTS idx_player_position ON player_moves (
                lower(player_name), split_part(fen, ' ', 1),
                split_part(fen, ' ', 2), split_part(fen, ' ', 3)
            );
            CREATE TABLE IF NOT EXISTS ocr_jobs (
                id UUID PRIMARY KEY, owner TEXT NOT NULL, page INTEGER NOT NULL,
                pdf BYTEA, status TEXT NOT NULL DEFAULT 'queued',
                result JSONB, error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ
            );
            CREATE INDEX IF NOT EXISTS idx_ocr_status ON ocr_jobs(status, created_at);
        """)
        # Older rows were written with legal FENs; normalize legal EP state too.
        import chess
        from chess_positions import position_key
        pending = db.execute("SELECT id,fen FROM player_moves WHERE position_key IS NULL").fetchall()
        updates = []
        for row_id, fen in pending:
            try:
                board = chess.Board(fen)
            except ValueError:
                continue
            if board.is_valid():
                updates.append((position_key(board), row_id))
        if updates:
            with db.cursor() as cursor:
                cursor.executemany("UPDATE player_moves SET position_key=%s WHERE id=%s", updates)
