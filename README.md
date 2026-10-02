# Neuro Chess

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
   npm install
   npm run dev
   ```

6. Open <http://localhost:5173>, sign in with Asgardeo, and use the prediction engine or PDF reader. The API health check is at <http://localhost:8000/health>.

`GOOGLE_API_KEY` is optional for startup but required for strategy reports. Move recommendations use exact-position move frequencies from ingested games when available, and a transparent one-ply positional heuristic otherwise. The displayed relative preference is not a calibrated probability or chess engine evaluation.

## PGN ingestion and RAG

Place `.pgn` files in `services/ml-engine/data/`. The authenticated `/api/v1/ingest-async` endpoint accepts only a filename from that directory. The worker validates the path again, stores player moves in PostgreSQL, and indexes full games in the shared pgvector collection. Use this endpoint for ingestion; the legacy `ingest_games.py` script writes to a different table and does not supply evidence to reports.

The API endpoints `/api/v1/predict-move`, `/api/v1/predict-strategy`, `/api/v1/extract-page-moves`, `/api/v1/ocr-jobs/{job_id}`, and `/api/v1/ingest-async` require an Asgardeo bearer access token. `/health` and OpenAPI documentation are available without a token. Browser origins are controlled by `CORS_ORIGINS`.

### Reliable background work

The ingestion worker reconnects with exponential backoff and keeps RabbitMQ heartbeats alive while indexing. Publishing uses confirmations and persistent messages. `pgn_ingestion_v2` holds new jobs, `.retry` holds delayed retries, and `.dead` retains malformed jobs or jobs that failed three attempts. Inspect dead jobs in RabbitMQ management, correct their cause, then explicitly resubmit the filename. The previous `pgn_ingestion_queue` is left intact; if upgrading an installation with pending legacy jobs, resubmit those filenames through the new API before retiring that queue.

Each game has a deterministic ID and each move a unique `(game_id, ply)` key. If vector indexing fails after moves were saved, retrying upserts the vector without adding duplicate moves. Existing legacy rows are preserved by additive migrations; rows without game identifiers require a separate migration before deduplicating older imports.

Strategy requests return HTTP 422 with an insufficient-data message when the named player has no indexed evidence. Use the player's exact PGN name (case-insensitive), for example `Amarasekara, Lakmal` in `tournament.pgn`. Reports include `supporting_games` (games actually retrieved) and `available_games` (indexed games for the player). The default Magnus Carlsen input needs a dataset containing that player.

OCR submission returns HTTP 202 with `job_id` and `status`. Poll `/api/v1/ocr-jobs/{job_id}` until `completed` or `failed`; only the submitting user can read it. PostgreSQL durably stores queued uploads, with at most 8 active jobs globally and 2 per user by default. Admission returns HTTP 429 when full. A dedicated worker runs one disposable extraction process at a time with a 45-second deadline, pixel limit, and container memory/CPU limits. Uploaded bytes are erased on completion/failure; results expire after one hour. Stale running jobs fail after their processing deadline plus a recovery allowance, and queued jobs expire after 15 minutes. Leaving the reader cancels browser polling; accepted server work still finishes within its limits.

RabbitMQ data and embedding model downloads use persistent volumes. Check `docker compose ps` and worker logs for health; `/health` is API liveness, not an ingestion readiness guarantee. Redis has bounded best-effort reads/writes; outages do not prevent predictions. Move cache entries expire after 60 seconds so newly ingested evidence becomes visible shortly.

## Checks

Run frontend checks from `frontend/`:

```powershell
npm run lint
npm run build
node --test src/requestGate.test.js
```

Check PostgreSQL from the running API container:

```powershell
docker compose exec ml-engine python test_db.py
```

Run reliability regression checks (integration tests require the running OCR worker and create/clean up only test-owned records):

```powershell
docker compose exec ml-engine python -m unittest test_reliability -v
docker compose exec -e RUN_INTEGRATION_TESTS=1 ml-engine python -m unittest test_reliability_integration -v
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
