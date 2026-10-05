# Repository quality and deployment

## Automated checks

`.github/workflows/checks.yml` runs on pull requests, pushes to `main`, and manual dispatch. It checks lint, unit tests, generated API contracts, type checks, production build, desktop/mobile browser flows, cancellation, parser reconstruction, and viewport transitions. A separate Docker job runs database/queue/OCR integration tests and signed-JWT browser flows. Gemini is mocked and no paid provider credentials are required. CI seeds a player only inside its disposable database, uploads failure diagnostics, and removes its volumes afterwards.

The workflow itself will first execute on GitHub after this change is pushed. Configure branch protection to require its jobs if merges must be blocked on failures.

`npm run typecheck` now checks `PdfReader.jsx`, `Dashboard.jsx`, the parser, and their imported JavaScript alongside the existing strict TypeScript files. The parser additionally gets strict null checking. JavaScript component adoption is incremental: implicit parameter types and component null checks remain relaxed in the separate checked-JavaScript configuration; this is not a claim that every component has been converted to strict TypeScript. Redux report state, board orientation, HTTP request options, and reader session identity now have explicit types.

## Explicit migrations

Back up PostgreSQL before applying a new release. Run:

```sh
docker compose build migrate
docker compose run --rm migrate
```

Compose waits for the migration job before API and worker startup. Outside Compose, run `python migrate.py apply` with the database URL configured. Service startup checks the migration ledger without creating tables or backfilling rows. `python migrate.py check` performs only the readiness check. Vector schema and collection bootstrap now belong to migration 0003; the pinned LangChain adapter performs no DDL. See [READER_PRESERVATION.md](READER_PRESERVATION.md) for runtime roles and identity adoption.

Migrations use an advisory transaction lock, a version/checksum ledger, and one transaction. The initial migration adopts existing tables additively; position-key backfill is recorded once and processes batches of 500. Editing an applied migration fails validation. Add a new numbered migration instead. Roll back application code only to a version compatible with the deployed schema; destructive down migrations are deliberately absent.

Development PostgreSQL and RabbitMQ bindings use `127.0.0.1`. For deployment:

```sh
docker compose -f docker-compose.yml -f docker-compose.production.yml up --build -d
```

The production overlay removes database/broker host ports and uses an internal data network. API and ingestion retain an egress network for Gemini and model downloads. The overlay requires Compose support for `!reset`. Move-prediction failures return a generic message and `X-Request-ID`, with the same ID logged server-side.

## Bounded strategy evidence

SQL statistics retain complete counts but return at most six sample game references per statistic. Gemini receives those compact statistics and at most six supporting PGNs, plus an explicit 75,000-character input budget. This is a character budget, not a measured token count. The report prompt/cache version changed so old oversized reports are not reused.

The dashboard's **Browse all references** uses authenticated pagination through `/api/v1/evidence/references`. It fetches at most 100 references per request (25 in the UI), filters by the chosen statistic/player/color, and rejects a stale evidence version with HTTP 409 instead of mixing a new dataset into an old report. SQL/retrieval can still work with all eligible IDs internally; large-dataset query optimization remains separate from bounding model input.

## Prediction evaluation and Sri Lankan ChessBase data

The saved `prediction-evaluation.json` remains the historical hash-split result. New evaluation defaults to chronological train/validation/test periods, keeps equal dates together, excludes incomplete dates, deduplicates games, tunes the history prior only on validation log loss, and reports test accuracy/calibration plus historical-evidence coverage. The tested prior is not automatically promoted to production.

`HISTORY_PRIOR_STRENGTH` lets an operator deploy a reviewed validation choice; the default remains 20. Move-cache identity includes this strength so changing it cannot reuse an older weighting result.

```sh
python evaluate_predictions.py data/tournament.pgn --output chronological-evaluation.json
```

Chronology uses 60/20/20 percent of distinct dates, so game counts may differ from those ratios. `--split hash` is a diagnostic fallback with a separate validation set. Collect more independent tournaments and player games before treating these small-corpus results as production quality.

Use a ChessBase PGN export you are authorized to use. The importer does not download a licensed ChessBase database or assume that every participant at a Sri Lankan tournament is Sri Lankan. Download the official combined legacy XML list from [FIDE](https://ratings.fide.com/download_lists.phtml), then:

```sh
python build_country_roster.py /path/to/players_list_xml_legacy.zip --output sri-roster.json
python prepare_country_dataset.py /path/to/chessbase-export.pgn --roster sri-roster.json --output data/sri-chessbase.pgn
python ingest_games.py sri-chessbase.pgn
```

Run the ingestion command in the ingestion container, after migrations, with `PGN_DATA_DIR` pointing to the prepared file's directory. For example, `docker compose exec ml-worker python ingest_games.py sri-chessbase.pgn` after placing it in `services/ml-engine/data`.

The roster includes current SRI federation identities from the supplied FIDE list; it does not establish citizenship or historical federation membership. Import accepts roster FIDE IDs, explicit player federation/country tags, or an unambiguous exact roster name/confirmed alias when the game has no valid FIDE ID. It never uses `EventCountry` as player identity. Review unresolved names in the generated `.coverage.json`; add confirmed aliases to the roster and create a new prepared output. Positive unknown FIDE IDs do not fall back to guessing by name. Coverage lists players with zero supplied games as well as those represented. Completeness is limited to the PGN exports supplied.

For this workspace, the October 2026 FIDE download and generated roster are local in `.runtime/fide-players.zip` and `.runtime/sri-roster.json`. They are not committed. The current 188-game ChessBase export produced 134 country-confirmed games in `.runtime/sri-reviewed.pgn`; 54 games lacked a confirmed Sri Lankan player under these rules. Existing indexed games were not removed. The prepared corpus does not add new games beyond that existing export.
