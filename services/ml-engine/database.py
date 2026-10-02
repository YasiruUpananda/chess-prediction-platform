"""Shared additive schema migrations and bounded database connections."""
import os
import atexit
import threading
from contextlib import contextmanager
from opentelemetry import trace
from psycopg_pool import ConnectionPool

_pool = None
_pool_lock = threading.Lock()


def get_pool():
    global _pool
    with _pool_lock:
        if _pool is None:
            url = os.getenv("WORKER_DATABASE_URL") or os.environ["DATABASE_URL"]
            _pool = ConnectionPool(url.replace("postgresql+psycopg://", "postgresql://", 1),
                min_size=1, max_size=int(os.getenv("DB_POOL_MAX", "8")),
                timeout=float(os.getenv("DB_POOL_TIMEOUT", "2")), max_waiting=32,
                kwargs={"connect_timeout": 3, "options": "-c statement_timeout=15000"},
                check=ConnectionPool.check_connection, open=True)
    return _pool


@contextmanager
def connect():
    with trace.get_tracer('neuro-chess').start_as_current_span('db.transaction', record_exception=False,
            set_status_on_exception=False) as span:
        try:
            with get_pool().connection() as connection:
                yield connection
        except Exception as error:
            span.set_attribute('error.type', type(error).__name__)
            span.set_status(trace.Status(trace.StatusCode.ERROR))
            raise


def close_pool():
    global _pool
    with _pool_lock:
        if _pool is not None:
            _pool.close()
            _pool = None


atexit.register(close_pool)


def data_version():
    with connect() as db:
        return db.execute("SELECT version FROM dataset_version WHERE id=1").fetchone()[0]


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
            ALTER TABLE ocr_jobs ADD COLUMN IF NOT EXISTS cache_key TEXT;
            ALTER TABLE ocr_jobs ADD COLUMN IF NOT EXISTS trace_context JSONB;
            CREATE INDEX IF NOT EXISTS idx_ocr_owner_cache ON ocr_jobs(owner,cache_key);
            CREATE TABLE IF NOT EXISTS dataset_version (
                id INTEGER PRIMARY KEY CHECK (id=1), version BIGINT NOT NULL DEFAULT 0
            );
            INSERT INTO dataset_version(id) VALUES (1) ON CONFLICT DO NOTHING;
            CREATE OR REPLACE FUNCTION bump_dataset_version() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                UPDATE dataset_version SET version=version+1 WHERE id=1;
                RETURN NULL;
            END $$;
            DROP TRIGGER IF EXISTS ingested_games_version ON ingested_games;
            CREATE TRIGGER ingested_games_version AFTER INSERT OR UPDATE OR DELETE
                ON ingested_games FOR EACH ROW EXECUTE FUNCTION bump_dataset_version();
            CREATE TABLE IF NOT EXISTS service_heartbeats (
                name TEXT PRIMARY KEY, seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS request_limits (
                owner TEXT NOT NULL, operation TEXT NOT NULL, window_id BIGINT NOT NULL,
                count INTEGER NOT NULL, PRIMARY KEY(owner,operation)
            );
            CREATE INDEX IF NOT EXISTS idx_request_limit_window ON request_limits(window_id);
            CREATE TABLE IF NOT EXISTS saved_studies (
                id UUID PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL,
                snapshot JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            CREATE INDEX IF NOT EXISTS idx_studies_owner ON saved_studies(owner,created_at DESC);
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
