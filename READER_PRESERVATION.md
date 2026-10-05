# Reader and evidence improvements

Reading sessions use schema version 2, independently of extraction versions. Opening the
same PDF upgrades version-1 sessions and preserves position, tree, mappings, game choices
and explicitly validated corrections. Only disposable extraction pages are invalidated.
Reviewed pages do not count toward the 40-page cache limit. Saves flush when changing
documents or leaving the reader; browser termination can still interrupt an IndexedDB
transaction. Progress is local and owner-scoped. The library stores metadata, not PDF bytes;
select the original file again to resume.

Manual moves add user variations. Return to book line restores the printed main path;
reset/undo navigate without deleting it. Export study PGN includes all branches/comments
in the selected game, including moves beyond the board cursor. Earlier document games
remain separate. Applying a new FEN deliberately starts a new tree. The saved-studies API
still stores a board snapshot; full reader trees/corrections live in the local session and
PGN export.

Font normalization applies to parsing and highlighting. Sources have token IDs within a
page extraction, including split figurine/destination runs. Boxes remain approximate for
ligatures, rotated text and long runs. Diagnostics compare extracted candidates with legal
plies; they do not invent an expected count or interpretation probability.

Strict TypeScript models cover session migration and player coverage. Extraction and tree
operations are separate modules. Existing component checks remain incremental rather than
a completed strict TypeScript conversion.

## Data identity and migrations

Back up PostgreSQL, rebuild services together, then run `docker compose run --rm migrate`.
Do not edit applied migrations. Migration 0003 owns vector DDL and player/import tables.
Migration 0004 backfills identities in batches of 500, retaining old game IDs for citations.
Duplicate exports retain their records with `duplicate_of` and are excluded from indexed
evidence. Invalid historical vector documents need review. Date, round, participants and
moves identify games; unrelated export headers and annotations do not. Missing FIDE IDs
or insufficient game metadata can require manual reconciliation between exports.

Migration provisions API, ingestion, OCR and read-only backup roles. Production requires
distinct passwords; development uses the existing password with separate permissions.
Runtime roles cannot create schema or edit the migration ledger. Only migrations and
disposable restore verification use admin access. The pinned LangChain adapter checks
migrations without creating tables or collections.

Place reviewed roster/PGN files in the mounted data directory, then:

```sh
docker compose exec ml-worker python player_identity.py /app/data/sri-roster.json
docker compose exec ml-worker python ingest_games.py sri-chessbase.pgn
docker compose exec ml-worker python evaluate_import.py sri-chessbase.pgn --output /tmp/chronological-evaluation.json
docker compose cp ml-worker:/tmp/chronological-evaluation.json ./chronological-evaluation.json
```

Aliases promote provisional participants only when one reviewed identity fits; FIDE IDs
distinguish namesakes. The dropdown uses IDs and displays names. Coverage shows date,
color and tournament (up to 200 groups). Import batches record source hashes, original
headers and completion/failure status. Evaluation is an explicit post-import step and
does not promote model weights automatically. More ChessBase exports are still needed.

Statistics caching uses dataset version, at most 32 entries and 20,000 IDs per entry.
Reference pagination reuses statistics and selects page rows in SQL. Model samples remain
limited to six references. Full eligible IDs are still used internally for retrieval.

## Regression gates

Committed CC0 PDF fixtures exercise actual PDF.js extraction, custom Type3 figurines,
columns, commentary and continuations. A scanned PDF exercises Tesseract in backend
integration. Browser corpus accuracy must reach 95% for complete lines and attachment.
These source-authored regressions do not establish accuracy across published books.
Use `PDF_BENCHMARK_MANIFEST` for a larger private labelled corpus.

Run `node scripts/create-pdf-fixtures.mjs` in frontend to regenerate text/custom-font PDFs.
Windows/Linux visual baselines cover dark/paper themes and drawers on desktop/mobile.
Review screenshot changes before updating baselines. Axe checks serious/critical WCAG
findings; automated scans do not replace keyboard and screen-reader assessment.

See [BACKUP_SETUP.md](BACKUP_SETUP.md) for manual bucket setup and restore checks.
