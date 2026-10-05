# Repository structure

```text
frontend/
  src/
    app/                 Route composition and workspace providers
    components/          Shared layout, controls, and board wrapper
    features/
      auth/              Asgardeo session and recovery
      prediction/        Move predictions, reports, and evidence
      reader/            PDF extraction, replay, and reading sessions
      studies/           Saved study interface
    generated/           Generated OpenAPI types; regenerate instead of editing
    lib/                 Shared API, request, history, and metrics helpers
    pages/               Public home page
    store/               Redux state and RTK Query
    styles/              Shared styles and feature stylesheets
    main.jsx             Browser entry point
  e2e/                   Browser tests and platform-specific visual baselines
  benchmarks/            Reproducible PDF fixture corpus
  performance/           Bundle baselines and compiler profiling fixtures
  scripts/               Build, profiling, and fixture utilities
  public/                Assets served without bundling
services/ml-engine/
  *.py                   API, workers, domain modules, and operator CLIs
  migrations/            Versioned SQL migrations
  tests/                 Regression tests and isolated authentication fixtures
  tools/                 Operator diagnostics invoked as Python modules
  benchmarks/            Recorded backend and prediction measurements
  data/                  Approved PGN ingestion input
docs/                    Feature, architecture, operations, and review guides
monitoring/              Prometheus configuration and alerts
scripts/                 Backup and restore scripts
.github/workflows/       Continuous integration
```

Frontend unit tests remain beside the code they exercise. `npm test` discovers nested `*.test.js` files. Frontend routes remain `/`, `/predict`, and `/reader`; source paths are not browser routes. Keep optional features behind the existing lazy imports.

The backend retains its existing module entry points (`main:app`, `worker.py`, `ocr_worker.py`, and `migrate.py`) to keep deployment and operational commands stable. Production Docker stages copy application code, migrations, and diagnostic tools; the test stage also contains `tests/`. Browser test authentication runs only through `python -m tests.auth_server` in the test image.

## Verification

From `frontend/`:

```sh
npm ci
npm run lint
npm test
npm run api:check
npm run build
npm run benchmark:pdf
npx playwright test
```

From the repository root, with an isolated test Compose project and its dependencies configured:

```sh
docker compose build backend-tests
docker compose run --rm -e RUN_INTEGRATION_TESTS=1 backend-tests
```

Backend test discovery runs `python -m unittest discover -s tests -t . -v` from `services/ml-engine/` (or `/app` in its test container). The CI workflow demonstrates provisioning an isolated database, migrations, OCR worker, and authenticated browser API. Database diagnostics use `docker compose exec ml-engine python -m tools.check_database`.

## Local and generated files

Keep credentials in ignored environment files. `.runtime/` holds private local data, backup dumps, and temporary diagnostic artifacts; it is not application source. Never bulk-delete it as a cleanup step. Dependency environments, caches, test output, and build output remain ignored. Checked-in PDF fixtures, visual snapshots, API contracts, and benchmark baselines are intentional regression assets.

New guides belong under `docs/` and should be linked from its index. Benchmark results belong near the relevant benchmark implementation. Do not commit Python bytecode or reintroduce unused framework starter assets.
