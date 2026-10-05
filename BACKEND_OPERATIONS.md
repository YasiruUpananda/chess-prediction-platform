# Backend efficiency and operations

## Reproducible images

`services/ml-engine/pyproject.toml` and `uv.lock` replace `requirements.txt`.
Production builds use pinned uv 0.11.21 and `uv sync --frozen --no-dev`.
Direct and transitive Python dependencies are locked, including hashes. PyTorch
uses the explicit official CPU wheel index; these deployments do not use CUDA.
Python is constrained to 3.11 and the bundled Stockfish installer targets x86-64.
Base-image tags and OS package repositories still change; Python locking alone
does not make Docker builds byte-identical. Pin image digests when releasing.

Docker targets are `api` (HTTP/JWT, embeddings, Stockfish), `ingestion`
(PGN, embeddings, RabbitMQ), `ocr` (PDF, images, Tesseract), and `test`
(combined tooling for regression checks). OCR excludes PyTorch and LangChain;
API and ingestion exclude Tesseract and PyMuPDF. API still needs embeddings for
query retrieval. Shared dependency layers precede application source so source
changes do not reinstall the large embedding stack.

For local development with uv:

```powershell
cd services/ml-engine
uv sync --frozen --extra api --extra embeddings --group test
uv run --frozen --extra api --extra embeddings --group test python -m unittest test_backend_efficiency -v
```

The normal stack starts with `docker compose up -d --build`. API and ingestion
have separate configurable memory/CPU limits; defaults are 2 GiB/2 CPUs and
2 GiB/1 CPU. OCR retains its 768 MiB/1 CPU bound. Measure actual memory and
queue delays before raising concurrency. Models remain cached across restarts.

## Connections and caches

Psycopg connections are reused through a thread-safe bounded pool with rollback
on error, connection validation, a 2-second checkout timeout, at most 32 waiters,
a 3-second connection timeout and 15-second SQL statement timeout. Defaults are
8 SQL connections plus 4 separate bounded SQLAlchemy vector connections per API
process; each ingestion worker uses 2 plus 2 and OCR uses 2. Multiply by replicas
and processes when sizing PostgreSQL. Read the [Psycopg pool guide](https://www.psycopg.org/psycopg3/docs/advanced/pool.html).

Dataset version changes commit alongside ingestion changes. Move caches include
that version; when the version or history cannot be read, prediction bypasses
cache and remains explicit about heuristic evidence. Existing cached keys expire
after 60 seconds. The active ingestion path publishes `indexed=true` only after
the full game's vector is stored. Manual maintenance of indexed game move/vector
contents must also update its `ingested_games` row to advance the dataset version.
Strategy reports retain their existing evidence-derived versioning.

## Readiness, monitoring and permissions

`/health` is liveness. `/ready` checks PostgreSQL and ingestion/OCR heartbeats,
returning 503 after a heartbeat is older than 45 seconds. Empty datasets are
reported as `indexed_games: 0`; report endpoints still reject insufficient data.
Redis does not gate readiness because prediction caches are optional. Model/API
provider availability is separate from worker readiness; Gemini failures produce
the existing explicit unavailable response.

`GET /api/v1/operations` requires ingestion authorization and reports pool counters,
worker ages, OCR status counts, unindexed games and pending/retry/dead queue counts.
It does not consume the ingestion submission quota. Point the deployment's
monitoring system at `/ready`, container health, operations counters and logs;
alert on stale workers, persistent retry/dead queues, growing unindexed games and
pool waiters. Compose restarts exited containers; it does not automatically
restart a process merely because a health check is unhealthy.

Ingestion requires `INGEST_REQUIRED_SCOPE` (default `chess:ingest`) or a nonempty
`INGEST_REQUIRED_ROLE` in `INGEST_ROLE_CLAIM` (default `roles`). Checks use the
signature-validated JWT, before path lookup and publishing. Configure the API
permission and its assignment in Asgardeo and request it only for authorized
operators. Existing ordinary frontend sign-ins remain unable to ingest. The
operator CLI relies on access to the container/database and calls the same
idempotent implementation; it is an administrator tool.

## Admission limits

PostgreSQL atomically counts admitted requests using database time and hashed
user subjects, shared across API replicas and independent of Redis. Defaults
are 6 reports, 12 OCR submissions, 60 move predictions and 5 ingestion submissions
per user per minute. Both strategy endpoints share one bucket; both OCR upload
endpoints share another. Polling OCR jobs and listing players do not consume
expensive-operation quotas. Cache hits and invalid payload attempts that reach
admission count toward quotas. Fixed windows allow a burst across a minute boundary.
HTTP 429 includes `Retry-After: 60`; inability to enforce admission returns 503
rather than permitting unbounded expensive work. Set a limit to zero to disable
that operation. Old quota rows are removed after one day.

## Benchmarks and vector indexing

Run the read-only benchmark:

```powershell
docker compose exec ml-engine python benchmark_backend.py
```

The local dataset contains 188 game vectors and 14,229 move rows. Initial checks
measured approximately 7.3 ms for a fresh connection/query versus 0.5 ms pooled,
and under 1 ms for exact player-filtered vector SQL. These are warmed local SQL
measurements, not end-to-end prediction or embedding generation speed. Recorded
results are in `services/ml-engine/benchmarks/step6.json`.

Existing canonical-position and legacy position indexes are preserved. Keep exact
vector search at this volume. At larger volume benchmark representative players,
colors, selectivity and cold/warm latency, then compare top-k recall against exact
search before adopting HNSW. Approximate indexes apply filters after searching,
so selective player filters can return too few results without appropriate search
settings/iterative scans. The current LangChain vector column has no declared
dimension; an HNSW migration must validate dimensions and use the same indexed
expression in retrieval. Do not create an unused cast-expression index. Consult
the [pgvector indexing and filtering guide](https://github.com/pgvector/pgvector).

## Backups and recovery

```powershell
docker compose --profile backup up -d db-backup
# Restore verification uses the dedicated administrative checker.
# See BACKUP_SETUP.md for its configuration and schedule.
```

The backup profile runs custom-format `pg_dump` immediately and every 24 hours
by default, writes to a private persistent `backups` volume, atomically publishes
completed snapshots, and removes snapshots older than seven days. Failures exit
and trigger the restart policy. A health check verifies recent success. Restore
verification creates a uniquely named disposable database, restores the latest
snapshot, counts indexed games and drops only that disposable database. It never
restores over the application database.

Backups include user-owned OCR jobs still present at snapshot time. Restrict backup
access and encrypt copies exported off-host. The local volume protects against
application mistakes but not loss of the Docker host; production needs scheduled
off-host copies, retention and periodic restore drills. Gemini credentials remain
outside the database and should be provisioned separately during recovery.

## Checks

```powershell
docker compose build backend-tests
docker compose run --rm -e RUN_INTEGRATION_TESTS=1 backend-tests
cd frontend
npm run lint
npm test
npm audit
npm audit --omit=dev
```

All 39 backend checks passed. The integration suite uses test-specific rows and rollback/cleanup, and does not
call the paid report model. It covers pooled reuse, transaction rollback, dataset
version changes, per-user concurrent limits, forbidden ingestion, cache failure,
retries and owner-scoped OCR. The frontend brace-expansion transitive dependency
is updated to 5.0.12; both full and production-only npm audits report zero known
vulnerabilities at verification time. This is not a complete Python security audit.
