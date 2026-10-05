# Neuro Chess

See the [documentation index](docs/README.md) and [repository structure](docs/architecture/REPOSITORY_STRUCTURE.md) for feature ownership, operations, and verification commands.

For an in-depth explanation of the implementation, read the [project report](docs/project/PROJECT_DEEP_DIVE.md), [architecture diagrams](docs/project/ARCHITECTURE.md), and [100 interview questions](docs/project/INTERVIEW_QUESTIONS.md).

Reader preservation, identity migration, and regression gates: [READER_PRESERVATION.md](./docs/features/READER_PRESERVATION.md).
Off-host bucket setup: [BACKUP_SETUP.md](./docs/operations/BACKUP_SETUP.md).

Neuro Chess combines opponent move analysis, chess strategy search, and a PDF chess book reader with move extraction. The Vite React app in `frontend/` is the web client. The FastAPI service and ingestion worker live in `services/ml-engine/`.

## Start locally

1. Copy `.env.example` to `.env` in the repository root. Set long random `POSTGRES_PASSWORD`, `RABBITMQ_PASSWORD`, and `REDIS_PASSWORD` values. Use URL safe characters for these values, or percent encode reserved characters.
2. Copy `frontend/.env.example` to `frontend/.env`. Set the Asgardeo application values described below.
3. In Asgardeo, configure a single page application with `http://localhost:5173` as an allowed redirect and logout URL. Configure it to issue JWT access tokens with the audience in `ASGARDEO_AUDIENCE`. Set the matching issuer and JWKS URL in the root `.env`. The API validates the token signature and its `exp`, `iss`, `aud`, and `sub` claims.
4. Start PostgreSQL, Redis, RabbitMQ, the API, and the ingestion worker:

   ```powershell
   docker compose up --build
   ```

5. In another terminal, start the web client:

   ```powershell
   cd frontend
   npm ci
   npm run dev
   ```

6. Open <http://localhost:5173>, sign in with Asgardeo, and use the prediction engine or PDF reader. API liveness is at <http://localhost:8000/health>; dependency and worker readiness is at <http://localhost:8000/ready>.

`GOOGLE_API_KEY` is optional for startup but required for strategy reports. Move recommendations combine sample-weighted historical frequencies and a positional heuristic, alongside a separate bounded Stockfish evaluation. Move likelihood is not a calibrated win probability.

## PGN ingestion and RAG

Place `.pgn` files in `services/ml-engine/data/`. `/api/v1/ingest-async` accepts only a filename from that directory and requires a validated token with the `chess:ingest` scope, or the explicitly configured ingestion role. Ordinary signed-in users receive HTTP 403. The worker validates the path again, stores player moves in PostgreSQL, and indexes full games in the shared pgvector collection.

Operators can also invoke the same idempotent ingestion implementation:

```powershell
docker compose exec ml-worker python ingest_games.py tournament.pgn
```

The CLI now uses the active collection and move tables; it no longer writes `opponent_history`. Existing legacy `opponent_history` rows are preserved but are not report evidence. Re-ingest their original PGNs through the worker or CLI to migrate them.

The API endpoints `/api/v1/predict-move`, `/api/v1/predict-strategy`, `/api/v1/extract-page-moves`, `/api/v1/ocr-jobs/{job_id}`, and `/api/v1/ingest-async` require an Asgardeo bearer access token. `/health` and OpenAPI documentation are available without a token. Browser origins are controlled by `CORS_ORIGINS`.

### Reliable background work

The ingestion worker reconnects with exponential backoff and keeps RabbitMQ heartbeats alive while indexing. Publishing uses confirmations and persistent messages. `pgn_ingestion_v2` holds new jobs, `.retry` holds delayed retries, and `.dead` retains malformed jobs or jobs that failed three attempts. Inspect dead jobs in RabbitMQ management, correct their cause, then explicitly resubmit the filename. The previous `pgn_ingestion_queue` is left intact; if upgrading an installation with pending legacy jobs, resubmit those filenames through the new API before retiring that queue.

Each game has a deterministic ID and each move a unique `(game_id, ply)` key. If vector indexing fails after moves were saved, retrying upserts the vector without adding duplicate moves. Existing legacy rows are preserved by additive migrations; rows without game identifiers require a separate migration before deduplicating older imports.

Strategy requests return HTTP 422 with an insufficient-data message when the named player has no indexed evidence. Use the player's exact PGN name (case-insensitive), for example `Amarasekara, Lakmal` in `tournament.pgn`. Reports include `supporting_games` (games actually retrieved) and `available_games` (indexed games for the player). The default Magnus Carlsen input needs a dataset containing that player.

OCR submission returns HTTP 202 with `job_id` and `status`. Poll `/api/v1/ocr-jobs/{job_id}` until `completed` or `failed`; only the submitting user can read it. PostgreSQL durably stores queued uploads, with at most 8 active jobs globally and 2 per user by default. Admission returns HTTP 429 when full. A dedicated worker runs one disposable extraction process at a time with a 45-second deadline, pixel limit, and container memory/CPU limits. Uploaded bytes are erased on completion/failure; results expire after one hour. Stale running jobs fail after their processing deadline plus a recovery allowance, and queued jobs expire after 15 minutes. Leaving the reader cancels browser polling; accepted server work still finishes within its limits.

RabbitMQ data and embedding model downloads use persistent volumes. Check `docker compose ps`, worker logs and `/ready`; `/health` remains API liveness. `/ready` returns HTTP 503 when PostgreSQL or either worker is unavailable, with a 45-second heartbeat grace period. Redis remains an optional cache. Move cache keys include a PostgreSQL dataset version advanced transactionally when ingestion publishes indexed games; new games immediately use different cache keys. The 60-second TTL bounds storage and transient results. Strategy caches already include evidence version, player, context, color, model and prompt version.

See [BACKEND_OPERATIONS.md](./docs/operations/BACKEND_OPERATIONS.md) for locked dependency groups, split images, pool sizing, per-user limits, benchmarks, restricted monitoring, backups and restore verification.

## Checks

Run frontend checks from `frontend/`:

```powershell
npm run lint
npm run build
npm test
```

Check PostgreSQL from the running API container:

```powershell
docker compose exec ml-engine python -m tools.check_database
```

Run reliability regression checks (integration tests require the running OCR worker and create/clean up only test-owned records):

```powershell
docker compose build backend-tests
docker compose run --rm -e RUN_INTEGRATION_TESTS=1 backend-tests
```

## Configuration

- `VITE_API_URL` points the browser app at FastAPI.
- `VITE_ASGARDEO_CLIENT_ID`, `VITE_ASGARDEO_BASE_URL`, `VITE_ASGARDEO_SIGN_IN_REDIRECT_URL`, and `VITE_ASGARDEO_SIGN_OUT_REDIRECT_URL` configure the public Asgardeo SPA client.
- `ASGARDEO_ISSUER`, `ASGARDEO_JWKS_URL`, and `ASGARDEO_AUDIENCE` configure API token validation. The audience must match the JWT access token.
- `DATABASE_URL` is the SQLAlchemy/psycopg URL used by LangChain PGVector. `WORKER_DATABASE_URL` is the PostgreSQL URL used by the ingestion worker and historical move lookup.
- `CORS_ORIGINS` is a comma separated list of exact browser origins.
- `MAX_PDF_BYTES` sets the PDF upload limit. Scanned pages use Tesseract OCR in the container.
- `OCR_QUEUE_LIMIT`, `OCR_TIMEOUT_SECONDS`, and `OCR_MAX_PIXELS` bound queued OCR work and page processing.
- `GOOGLE_MODEL` selects the Gemini model for strategy generation; `GOOGLE_API_KEY` supplies its credential.
- `INGEST_REQUIRED_SCOPE` defaults to `chess:ingest`; `INGEST_REQUIRED_ROLE` and `INGEST_ROLE_CLAIM` optionally allow an administrator role in the validated JWT. Configure and grant the permission in Asgardeo; a frontend role label does not authorize ingestion.
- `DB_POOL_MAX` and `VECTOR_DB_POOL_MAX` bound connections per API process. Workers use smaller pools.
- `RATE_REPORTS_PER_MINUTE`, `RATE_OCR_PER_MINUTE`, `RATE_MOVES_PER_MINUTE`, and `RATE_INGESTION_PER_MINUTE` configure shared per-user admission limits.

See [Technology adoption](./docs/architecture/TECHNOLOGY_ADOPTION.md) for local OpenTelemetry/Jaeger,
generated TypeScript API contracts, React Compiler profiling and optional HNSW retrieval.
See [Repository quality](./docs/architecture/REPOSITORY_QUALITY.md) for CI, explicit migrations,
private deployment networking, bounded report references, chronological evaluation,
and the Sri Lankan ChessBase PGN import workflow.
See [Implementation status and measurements](./docs/reviews/IMPLEMENTATION_STATUS.md) for saved
studies, exports, Prometheus queries, Web Vitals targets and regression/load-test commands.
See [Branding and source review](./docs/reviews/BRANDING_REVIEW.md) for the NeuroChess visual system,
shared navigation, accessibility checks and source corrections.
