"""Database-backed admission limits and worker readiness shared across replicas."""
import hashlib
import os

from fastapi import Depends, HTTPException
from database import connect
from token_auth import require_asgardeo_user


def admit(user, operation, default):
    limit = int(os.getenv(f"RATE_{operation.upper()}_PER_MINUTE", str(default)))
    if limit < 1:
        raise HTTPException(503, detail="This operation is temporarily disabled.")
    owner = hashlib.sha256(user['sub'].encode()).hexdigest()
    try:
        with connect() as db:
            # Database time avoids clock skew between API replicas. Admission is atomic.
            window_id = db.execute("SELECT floor(extract(epoch FROM clock_timestamp())/60)::bigint").fetchone()[0]
            count = db.execute("""INSERT INTO request_limits(owner,operation,window_id,count) VALUES (%s,%s,%s,1)
                ON CONFLICT (owner,operation) DO UPDATE SET window_id=EXCLUDED.window_id,
                count=CASE WHEN request_limits.window_id=EXCLUDED.window_id THEN request_limits.count+1 ELSE 1 END
                RETURNING count""", (owner,operation,window_id)).fetchone()[0]
            db.execute("DELETE FROM request_limits WHERE window_id < %s", (window_id-1440,))
    except Exception as error:
        raise HTTPException(503, detail="Request admission is temporarily unavailable.") from error
    if count > limit:
        raise HTTPException(429, detail="Rate limit reached. Retry in the next minute.", headers={"Retry-After":"60"})
    return user


def report_user(user=Depends(require_asgardeo_user)):
    return admit(user, 'reports', 6)


def ocr_user(user=Depends(require_asgardeo_user)):
    return admit(user, 'ocr', 12)


def move_user(user=Depends(require_asgardeo_user)):
    return admit(user, 'moves', 60)


def require_ingestion_permission(user=Depends(require_asgardeo_user)):
    scope = os.getenv('INGEST_REQUIRED_SCOPE', 'chess:ingest')
    role = os.getenv('INGEST_REQUIRED_ROLE', '')
    scopes = user.get('scope', '')
    roles = user.get(os.getenv('INGEST_ROLE_CLAIM', 'roles'), [])
    if isinstance(scopes, str): scopes = scopes.split()
    if isinstance(roles, str): roles = roles.split(',')
    if not ((scope and isinstance(scopes, list) and scope in scopes) or
            (role and isinstance(roles, list) and role in roles)):
        raise HTTPException(403, detail="Ingestion requires the configured ingestion scope or role.")
    return user


def ingestion_user(user=Depends(require_asgardeo_user)):
    return admit(require_ingestion_permission(user), 'ingestion', 5)

