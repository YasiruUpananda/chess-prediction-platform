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
    """Check schema readiness. Apply migrations explicitly before service startup."""
    from migrate import check_schema
    with connect() as db:
        check_schema(db)
