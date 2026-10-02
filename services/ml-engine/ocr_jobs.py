"""Durable, owner-scoped OCR jobs with atomic admission and claiming."""
import os
from uuid import uuid4

from database import connect


class QueueFull(Exception):
    pass


def submit(owner, page, content):
    job_id = uuid4()
    with connect() as db:
        db.execute("SELECT pg_advisory_xact_lock(734211)")
        total, own = db.execute("""SELECT count(*), count(*) FILTER (WHERE owner=%s)
            FROM ocr_jobs WHERE status IN ('queued','running')""", (owner,)).fetchone()
        if total >= int(os.getenv("OCR_QUEUE_LIMIT", "8")) or own >= 2:
            raise QueueFull("OCR is busy. Wait for your current pages to finish, then retry.")
        db.execute("INSERT INTO ocr_jobs(id,owner,page,pdf) VALUES (%s,%s,%s,%s)",
                   (job_id, owner, page, content))
    return {"job_id": str(job_id), "status": "queued"}


def get(job_id, owner):
    with connect() as db:
        row = db.execute("SELECT status,result,error FROM ocr_jobs WHERE id=%s AND owner=%s",
                         (job_id, owner)).fetchone()
    if row is None:
        return None
    return {"job_id": str(job_id), "status": row[0], "result": row[1], "error": row[2]}


def claim():
    with connect() as db:
        db.execute("""UPDATE ocr_jobs SET status='failed', error='OCR job timed out or worker stopped.',
            pdf=NULL, finished_at=now() WHERE
            (status='running' AND started_at < now() - (%s * interval '1 second')) OR
            (status='queued' AND created_at < now() - interval '15 minutes')""",
            (int(os.getenv("OCR_TIMEOUT_SECONDS", "45")) + 60,))
        db.execute("DELETE FROM ocr_jobs WHERE finished_at < now() - interval '1 hour'")
        return db.execute("""UPDATE ocr_jobs SET status='running', started_at=now()
            WHERE id=(SELECT id FROM ocr_jobs WHERE status='queued' ORDER BY created_at
                      FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,page,pdf""").fetchone()


def finish(job_id, result=None, error=None):
    from psycopg.types.json import Jsonb
    with connect() as db:
        db.execute("""UPDATE ocr_jobs SET status=%s,result=%s,error=%s,pdf=NULL,finished_at=now()
            WHERE id=%s AND status='running'""",
            ("failed" if error else "completed", Jsonb(result) if result else None, error, job_id))
