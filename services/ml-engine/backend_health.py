import time
from pathlib import Path
from database import connect

_last_heartbeat = {}
def heartbeat(name, health_file):
    Path(health_file).touch()
    now = time.monotonic()
    if now - _last_heartbeat.get(name, -10) >= 5:
        with connect() as db:
            db.execute("""INSERT INTO service_heartbeats(name) VALUES (%s)
                ON CONFLICT(name) DO UPDATE SET seen_at=now()""", (name,))
        _last_heartbeat[name] = now


def readiness():
    try:
        with connect() as db:
            rows = dict(db.execute("SELECT name,seen_at>now()-interval '45 seconds' FROM service_heartbeats").fetchall())
            indexed = db.execute("SELECT count(*) FROM ingested_games WHERE indexed").fetchone()[0]
        ready = all(rows.get(name, False) for name in ('ingestion', 'ocr'))
        return ready, {'database': True, 'ingestion': rows.get('ingestion',False),
                       'ocr': rows.get('ocr',False), 'indexed_games': indexed}
    except Exception:
        return False, {'database': False, 'ingestion': False, 'ocr': False}
