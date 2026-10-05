# Final implementation and measurement

The eight-step improvement sequence is implemented. Production performance targets
remain targets until enough real traffic has been measured.

| Area | Implemented |
| --- | --- |
| Reliable operation | Reconnecting ingestion workers, confirmed persistent messages, bounded retries/dead letters, health/readiness, idempotent ingestion, explicit insufficient evidence, Redis fallback, coordinated prediction requests |
| Analysis quality | Sample-aware preferences, legal position keys/history, player-filtered evidence, cited structured reports, SQL statistics, bounded Stockfish evaluation |
| Responsiveness | Queued OCR, selected-page image upload, private OCR cache, pooled SQL, versioned prediction/report caches, streamed progress and statistics |
| Product | Responsive boards, keyboard moves/tabs, move history, PGN export, private saved studies in prediction and PDF reader, cited Markdown report export |
| Coverage | SQL/outage/retry tests, scanned PDF fixtures, signed-JWT browser flows, cross-user ownership tests, mixed concurrent load, anonymous Web Vitals payload checks |

## Saved studies and exports

Save a named study from the prediction dashboard or PDF reader. Studies persist
in PostgreSQL and contain the starting position, legal move history, opponent and
preparation context. They are restricted to the validated token's subject, capped
at 100 per account, and limited to 30 study operations per minute. Opening a study
clears stale predictions/reports; it does not automatically request an opponent move.
PDF snapshots preserve board history, not the private PDF file itself. Reader
extraction controls still operate on the currently selected document.

Report export downloads Markdown with claims, confidence labels, cited games,
statistics, limitations and model/prompt/data versions. PGN export preserves the
game's starting position and move history. Browser output is rendered as text.
Existing database backup scripts include saved studies automatically.

## Local monitoring

Metrics need no hosted account. Set a separate random `METRICS_TOKEN` in root
`.env`, copy that same value without quotes into the ignored
`.runtime/metrics-token` file, and run:

```sh
docker compose --profile observability --profile monitoring up -d --wait
```

Use [Prometheus](http://localhost:9090) for metrics and
[Jaeger](http://localhost:16686) for request traces. Both viewers bind only to
localhost. Prometheus keeps seven days or 1 GB of local metrics, whichever limit
is reached first. API and worker scrape endpoints require the metrics credential;
worker ports remain internal to Docker. Never put this credential in Vite variables.

The local installation was configured with a generated private credential. It is
excluded from Git. Scrape targets for the API and both workers were verified up.
Rules flag unreachable targets, stale worker heartbeats, database outages, job
failures and OCR queue delay. Alerts appear in Prometheus; no external notifications
are configured. Counters reset on process restart; Prometheus `rate`/`increase`
handle resets. Retained OCR status gauges reflect the job retention window.

Useful PromQL queries:

```promql
# p95 successful API response duration, by route (seconds; full stream duration)
histogram_quantile(0.95, sum by (le, route) (rate(chess_api_duration_seconds_bucket{status=~"2.."}[15m])))

# Cache hit rate, excluding failures and disabled cache reads
sum by (cache) (rate(chess_cache_requests_total{outcome="hit"}[15m])) / sum by (cache) (rate(chess_cache_requests_total{outcome=~"hit|miss"}[15m]))

# OCR queue p95 and currently waiting jobs
histogram_quantile(0.95, sum by (le) (rate(chess_ocr_queue_seconds_bucket[15m])))
chess_ocr_jobs{status="queued"}

# First verified report content p95 (statistics, not the initial progress message)
histogram_quantile(0.95, sum by (le) (rate(chess_report_first_content_seconds_bucket[15m])))

# Failed job attempts and report failures / busy refusals
sum by (kind,outcome) (increase(chess_jobs_total{outcome=~"failed|dead_lettered"}[1h]))
sum by (reason) (increase(chess_report_failures_total[1h]))

# Estimated USD per completed report, including cached completions
sum(increase(chess_report_estimated_cost_usd_total[1h])) / sum(increase(chess_reports_total[1h]))
chess_report_cost_unknown_total
```

Cost is **unknown** unless `GEMINI_INPUT_USD_PER_MILLION` and
`GEMINI_OUTPUT_USD_PER_MILLION` are set for the configured model. Reported output
usage includes thought tokens. This is an estimate, not a billing reconciliation:
cached-input discounts, pricing tiers and provider failures with unreported usage
need separate accounting. Do not interpret zero estimated cost as free generation
when `chess_report_cost_unknown_total` increases.

## Browser field measurements

Enable `VITE_ENABLE_BROWSER_METRICS=true` at frontend build time and
`ENABLE_BROWSER_METRICS=true` on the API. Both are opt-in defaults; the local
installation was enabled for diagnosis. Rebuild the frontend after changing Vite
variables. Google's official `web-vitals` library loads separately and reports
LCP, INP and CLS on its normal metric lifecycle. Beacon payloads use a simple
request to avoid unload-time CORS preflight. The API validates payloads, limits
them to 1 KB, bounds anonymous admission/deduplication memory, and keeps labels
restricted to metric, device and route categories. It receives no account IDs,
tokens, query strings, PGNs or document content. Anonymous measurements are
untrusted, deduplicated within an API process, and not a billing-grade event ledger.
Metrics describe the initial hard-navigation route; per-route SPA vitals require
additional soft-navigation instrumentation.

```promql
# p75 over a day; LCP/INP in seconds, CLS dimensionless
histogram_quantile(0.75, sum by (le,name,route,device) (increase(chess_browser_vital_bucket[1d])))
sum by (name,route,device) (increase(chess_browser_vital_count[1d]))
```

Targets at p75 are LCP ≤2.5 s, INP ≤0.2 s and CLS ≤0.1, per
[Core Web Vitals guidance](https://web.dev/articles/defining-core-web-vitals-thresholds).
Require meaningful traffic counts and a representative device/network mix before
claiming those targets are met. Histogram percentiles are approximations. Current
tests verify metric collection and anonymous serialization; they do not establish
production p75. Headless Edge's visibility event is controlled explicitly because
background tabs remain visible in headless mode.

## Verification and mixed load

```sh
docker compose build ml-engine ml-worker ocr-worker backend-tests browser-api
docker compose --profile test up -d --wait browser-api
docker compose run --rm --no-deps -e RUN_INTEGRATION_TESTS=1 backend-tests
docker compose run --rm --no-deps backend-tests python load_test.py
cd frontend
npm run lint
npm test
npm run api:check
# PowerShell:
$env:BROWSER_TEST_API='http://127.0.0.1:8011'
npm run test:browser
```

The test server is an explicit test-profile service bound to localhost:8011. It
uses short-lived, ephemeral RS256 test keys with the production JWT verification
code, a test-only signing-key fixture and stubbed Gemini. Production `main:app`
never registers test session routes or overrides signing keys. The browser SDK
fixture is restricted to Vite browser-test mode. This verifies authenticated API
flows, not live Asgardeo login or paid Gemini behavior. Those still need a manual
pass through your configured account. Stop the test service afterward:

```sh
docker compose stop browser-api
```

One local eight-client run sent 20 player queries, 36 move predictions, six reports
and four page images alongside a report warmup. Results:

| Operation | Requests | Local p95 | Responses |
| --- | ---: | ---: | --- |
| Player lookup | 20 | 78.51 ms | 20 × 200 |
| Move prediction | 36 | 3161.93 ms | 36 × 200 |
| Report | 6 | 872.77 ms | 2 × 200, 4 × bounded busy 429 |
| OCR submission | 4 | 582.20 ms | 4 × 202, all later completed |

These small-sample measurements include real PostgreSQL/Redis, bounded Stockfish,
local embeddings and queued Tesseract. Gemini was stubbed, no paid calls were made,
and the test ran locally with the current small dataset. The script only permits
the explicit local test server addresses. Repeat with representative dataset sizes,
realistic arrival patterns, cold/warm caches and a larger sample before setting
production latency budgets. Move prediction is the main measured latency concern
in this mixed test; engine/heuristic traces should guide the next optimization.
