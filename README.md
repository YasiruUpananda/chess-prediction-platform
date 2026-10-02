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

Place `.pgn` files in `services/ml-engine/data/`. The authenticated `/api/v1/ingest-async` endpoint accepts only a filename from that directory. The worker validates the path again, stores player moves in PostgreSQL, and indexes full games in the shared pgvector collection. `ingest_games.py` can add a few example documents for a fresh local setup.

The API endpoints `/api/v1/predict-move`, `/api/v1/predict-strategy`, `/api/v1/extract-page-moves`, and `/api/v1/ingest-async` require an Asgardeo bearer access token. `/health` and OpenAPI documentation are available without a token. Browser origins are controlled by `CORS_ORIGINS`.

## Checks

Run frontend checks from `frontend/`:

```powershell
npm run lint
npm run build
```

Check PostgreSQL from the running API container:

```powershell
docker compose exec ml-engine python test_db.py
```

## Configuration

- `VITE_API_URL` points the browser app at FastAPI.
- `VITE_ASGARDEO_CLIENT_ID`, `VITE_ASGARDEO_BASE_URL`, `VITE_ASGARDEO_SIGN_IN_REDIRECT_URL`, and `VITE_ASGARDEO_SIGN_OUT_REDIRECT_URL` configure the public Asgardeo SPA client.
- `ASGARDEO_ISSUER`, `ASGARDEO_JWKS_URL`, and `ASGARDEO_AUDIENCE` configure API token validation. The audience must match the JWT access token.
- `DATABASE_URL` is the SQLAlchemy/psycopg URL used by LangChain PGVector. `WORKER_DATABASE_URL` is the PostgreSQL URL used by the ingestion worker and historical move lookup.
- `CORS_ORIGINS` is a comma separated list of exact browser origins.
- `MAX_PDF_BYTES` sets the PDF upload limit. Scanned pages use Tesseract OCR in the container.
- `GOOGLE_MODEL` selects the Gemini model for strategy generation; `GOOGLE_API_KEY` supplies its credential.
