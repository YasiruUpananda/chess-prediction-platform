# Evidence-based strategy reports

Authenticated `POST /api/v1/predict-strategy` returns structured JSON. The dashboard uses `POST /api/v1/predict-strategy/stream`, a newline-delimited JSON stream with `progress`, `statistics`, `complete` and `error` events. Each request accepts `opponent_name`, `context`, and optional `color` (`any`, `white`, `black`). Authentication failures use HTTP status codes; errors after streaming starts are terminal error events. A stream without `complete` is a failed report.

SQL computes distinct indexed game counts, results by color, opening frequencies using the first eight plies, and recurring positions after ply eight. Every statistic contains source game identifiers. Missing ECO tags are not guessed. Retrieval filters normalized player identity and eligible indexed game IDs before similarity search, then validates both returned metadata and PGN player names. Up to six supporting games are included with headers and PGN.

At least three indexed games are required for the chosen player/color. This is an admission threshold rather than proof of a representative sample. Reports have fixed `profile`, `tendencies`, `weaknesses`, `recommendations` and `limitations` sections. Each claim requires game or statistic citations, and unknown references are rejected. Weaknesses and recommendations must be marked tentative. Citation validation proves that references exist; it does not prove every interpretation is correct. The UI keeps SQL facts, inferred claims and limitations visible separately.

Gemini uses native JSON-schema output through its REST API, followed by Pydantic validation. The installed LangChain adapter silently ignores its `json_schema` option, so it is not used for generation. See [Gemini structured output documentation](https://ai.google.dev/gemini-api/docs/structured-output). Generation uses a reused HTTP client, at most two simultaneous reports per API process, a 5-second connection/pool timeout, a 45-second HTTP timeout and a 75-second overall pipeline deadline. Output is limited to 4,096 tokens; truncated, blocked and invalid reports fail rather than displaying partial claims. Provider calls do not retry implicitly.

Verified statistics stream before generation, giving useful evidence while the report is pending. Partial model JSON is withheld until validation. Streaming improves perceived responsiveness without promising shorter total generation time.

Redis caches validated reports for one hour. Keys include normalized player, context, color, evidence data version, model, embedding model and prompt version. Evidence versions hash eligible game IDs and deterministic SQL statistics, invalidating the cache when relevant indexed data changes. Cache errors fall back to normal generation with 250 ms socket limits. Cache hits skip retrieval and Gemini calls. Prompt changes must increment `PROMPT_VERSION`.

Embedding initialization runs in the background at API startup. Initialization is serialized to avoid duplicate loads. Local model files are preferred, with download fallback on an empty cache. The existing Compose `modelcache` volume is shared by ingestion and API containers and persists across rebuilds/restarts. `/health` remains a liveness check; warmup failures are logged and retried on demand.

Validation commands:

```
docker compose exec -T ml-engine python -m unittest test_strategy_reports test_reliability test_prediction_quality
docker compose exec -T -e RUN_INTEGRATION_TESTS=1 ml-engine python -m unittest test_reliability_integration
cd frontend
npm run lint
npm run build
node --test src/requestGate.test.js src/gameHistory.test.js src/reportStream.test.js
```
