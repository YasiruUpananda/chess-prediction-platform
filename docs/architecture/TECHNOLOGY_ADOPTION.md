# Adopted technologies

No new account is needed for the local stack. Stockfish, Redux Toolkit Query,
OpenTelemetry, TypeScript, React Compiler and pgvector run locally. Gemini uses
the existing Google API key. If that key is missing, create one in Google AI
Studio and set `GOOGLE_API_KEY` in the root `.env`; provider quota/billing remains
your responsibility. A hosted tracing service is optional.

## Prediction and API state

Stockfish 18 already runs in a bounded process pool with evaluation limits and
cached results. Reports already use validated Gemini JSON, cited game evidence,
SQL statistics, and streamed progress/statistics followed by the completed report.
This is progress streaming, not token-by-token Gemini streaming. RTK Query caches
and deduplicates player requests, with identity-scoped cache resets.

## OpenTelemetry

Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318` in the root `.env`, then run:

```sh
docker compose --profile observability up -d --wait
```

Open [Jaeger](http://localhost:16686). The viewer binds only to localhost and needs
no account. Traces cover HTTP requests, authentication, database transactions,
evidence statistics, retrieval, Gemini generation, Stockfish, ingestion and OCR.
Trace context crosses RabbitMQ messages and durable OCR jobs. `asyncio.to_thread`
preserves context for API work. Health/readiness requests are excluded.

Tracing is disabled when the endpoint is empty. The default sampling ratio is
0.25; use 1 during local diagnosis. Exporting is bounded and asynchronous with a
two-second exporter timeout. Application spans omit tokens, user identities,
prompts, PGNs, SQL parameters and raw exception messages. Do not enable HTTP
header capture for credentials. Jaeger's local all-in-one storage is transient;
use a secured persistent tracing backend for production retention.

## TypeScript and generated API contracts

Adoption is incremental: the API client, RTK Query player endpoint, responsive
board and report content use strict TypeScript. Existing JavaScript components
remain supported. API request/response types are generated from FastAPI rather
than maintained separately. Backend models now describe candidates, engine
evaluations, players, cited reports and OCR jobs/results.

After changing backend models, export the schema using the rebuilt API image:

```sh
docker compose build ml-engine
docker compose run --rm --no-deps -v ./frontend/openapi:/contracts ml-engine python export_openapi.py /contracts/schema.json
cd frontend
npm run api:generate
npm run api:check
npm run typecheck
```

Use an absolute bind-mount path if your shell does not resolve the relative path.
`api:check` checks generated types against the committed schema; refresh the
schema first to check backend drift. Builds run strict type checking. Contract
checks verify that missing positions, invalid report colors and nonnumeric game
counts fail compilation. Static types do not replace server-side validation.
The chessboard type path points explicitly at the locked v4 package entry. This
avoids stale v5 `Chessboard.d.ts` files in Windows synced `node_modules` folders
shadowing v4's `chessboard` directory; it does not change runtime resolution.

## React Compiler

The Vite 8 / React plugin 6 integration uses `@rolldown/plugin-babel` with the
official compiler preset. Annotation mode compiles only components marked
`use memo`: report content and the responsive board. No broad automatic rollout.

```sh
cd frontend
npm run profile:compiler
```

The headless browser fixture compares identical compiled/uncompiled report
components over 100 updates with unchanged data, using React Profiler. It tests
both the normal four-claim limit and a 200-claim stress case. The baseline file is
temporary and removed afterward. This measures development rendering cost, not
network latency, first-load speed or production end-to-end speed. Functional
desktop/mobile tests verify the board, report tabs and reader after compilation.
One local run with four claims measured 41.7 ms versus 0.7 ms total over 100 updates;
the stress case measured 1180.9 ms versus 1.4 ms. These are isolated development
measurements and should not be used as a production speed guarantee.

## Optional HNSW retrieval

Exact retrieval remains the default for the current 188 embeddings. A disposable
5,000-vector benchmark with 25 player groups and ten queries measured exact search
at 1.338 ms median versus HNSW at 3.602 ms with 0.80 mean recall@6. These synthetic
results do not justify enabling approximate retrieval on the current dataset.

```sh
docker compose run --rm --no-deps ml-engine python vector_index.py
docker compose run --rm --no-deps backend-tests python benchmark_hnsw.py
# After benchmarking larger, representative data:
docker compose run --rm --no-deps ml-engine python vector_index.py --apply
```

The index command defaults to at least 10,000 rows, validates 384 dimensions and
builds concurrently. Set `VECTOR_SEARCH_MODE=hnsw` and recreate the API to opt in.
The query uses the same vector cast/cosine operator as the expression index and
filters by collection, eligible game IDs and normalized player. It checks index
validity, enables bounded iterative scanning and falls back to exact search when
the index is absent or filtered results are too sparse. HNSW can still change
which games appear in a full result set; measure recall as well as latency.
Search mode is part of report cache keys. Revert to `exact` to disable approximate
search without dropping the index. Iterative scanning requires pgvector 0.8+.
