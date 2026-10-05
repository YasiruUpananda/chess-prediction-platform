# NeuroChess interview questions and answer guide

Use this with the [deep-dive report](PROJECT_DEEP_DIVE.md) and [architecture diagrams](ARCHITECTURE.md). Answers describe source commit **49f6cfe**. Adapt first-person statements to your actual decisions and contribution. The report supplies pinned code citations and more complete qualifications.

## Product and architecture

**1. What problem does the project solve?** It combines opponent-game preparation, independent engine analysis, evidence-backed strategy interpretation and interactive chess-book study. The goal is to reduce manual switching and replay while showing where conclusions came from.

**2. Who would use it?** Players and coaches preparing against known opponents, studying books or organizing board studies. The implementation includes a Sri Lankan roster/import workflow, but the product is not technically restricted to one federation.

**3. Why did you build it?** Explain the workflow problem and your own motivation. A defensible technical motivation is to make preparation more usable and inspectable, rather than relying on opaque percentages and disconnected tools. Do not invent a personal story from the code.

**4. What is the architecture?** A React SPA, a modular FastAPI backend, separate ingestion/OCR workers, PostgreSQL with pgvector, Redis and RabbitMQ, with Asgardeo and Gemini as external services. The workers share the backend codebase and database.

**5. Is it a microservice system?** It has separately deployed processes, but shared code/schema and one main API. “Modular backend with specialized workers” is more precise than claiming independently owned, independently evolved domain microservices.

**6. Why FastAPI?** The domain/ML/OCR ecosystem is already Python. FastAPI adds validated contracts, dependency composition and streaming without a second backend language. Blocking operations still require threads or separate processes.

**7. Why not Express?** Express is a valid lightweight choice. Here it would either require different libraries or a Python service/subprocess boundary. The decision is ecosystem fit, not a claim that Node cannot handle ML or is always slower.

**8. Why not Spring Boot?** Spring is a strong enterprise option. The current application benefits more from direct Python integration than from adding a JVM backend. In a Java-heavy organization that trade-off could change.

**9. Why React/Vite rather than Next.js?** The implemented experience is an interactive SPA with no required server-rendering workflow. Vite and lazy routes support that. An old generated Next.js instruction file does not make the active application Next.js.

**10. What are the most important system boundaries?** User/browser versus server authority; interactive API versus durable background tasks; deterministic statistics versus generated interpretation; likely human move versus strongest engine move; private study state versus shared game corpus.

## ML, probability and chess

**11. Where is your machine learning model?** Neural inference appears in pretrained embeddings, Gemini and the integrated engine's neural evaluation; OCR uses upstream recognition models. The next-human-move estimator itself is historical counts smoothed toward a handcrafted prior.

**12. Did you train a neural network?** No custom neural training loop appears in this repository. An offline evaluator tunes a smoothing hyperparameter, and ingestion accumulates evidence. Be explicit about that distinction.

**13. What features does your heuristic use?** Captures, promotion value, distance to central squares, giving check, castling and a coarse destination attack/defense penalty. It is one-ply and can miss tactics.

**14. Why apply softmax?** It converts arbitrary scores into a normalized preference distribution. Subtracting the largest score stabilizes exponentials. Temperature 0.7 controls concentration; it is not a learned calibration parameter here.

**15. What is the prediction formula?** `p(m)=(c(m)+αq(m))/(N+α)`, where counts come from matching games, `q` is the positional prior and default `α=20`. This interpolates evidence and prior according to sample size.

**16. What does alpha mean?** Total prior pseudocount strength. Larger alpha makes history need more observations to dominate; smaller alpha makes small samples more influential. Current evaluation chooses it using validation log loss, not test accuracy.

**17. Why are one observation and one thousand different?** The historical weight is `N/(N+α)`. More observations place more weight on empirical frequencies. Without that weighting, a tiny sample can look as authoritative as a large one.

**18. Is confidence a win probability?** No. It is a heuristic preference or smoothed estimate of which legal move the player might choose. It is neither a calibrated match-winning probability nor guaranteed human-choice calibration.

**19. Why is the engine's best move separate?** Human tendency and objective move quality answer different questions. Stockfish evaluates the position; the historical estimator predicts behavior. The dashboard's automatic reply uses the latter.

**20. What happens with an unseen player/position?** If historical matching returns no evidence, the move estimator falls back to its positional prior. The UI labels missing matches. Reports have a stricter minimum evidence threshold and may refuse generation.

**21. How do repeated positions affect the sample?** The SQL query takes the first occurrence per game for that player/position, avoiding treating multiple occurrences within one game as independent supporting games.

**22. Why not key history by all six FEN fields?** Move clocks would fragment otherwise matching positions. The canonical key keeps piece placement, turn, castling and legal en-passant state; full history and counters remain relevant for engine/cache semantics.

**23. Why does en passant matter?** It can change legal moves even when the pieces look identical. The key retains it when a legal en-passant capture exists, rather than blindly dropping the field.

**24. Why maintain move history alongside FEN?** FEN cannot prove prior repetitions. Replaying UCI moves from an initial FEN supports repetition and lets the backend verify that history matches the requested current position.

**25. What is NNUE?** An efficiently updatable neural evaluation used within Stockfish's search. Incremental state avoids recomputing everything after each small board change. The repository integrates that binary; it does not implement/train NNUE.

**26. What are centipawns and mate scores?** Centipawns are engine evaluation units; here scores are from White's perspective. Mate distance is represented separately. Neither should be casually converted into a human winning percentage.

**27. Why bound Stockfish?** Unrestricted engines can consume all CPU/RAM under concurrent requests. The process pool, thread/hash configuration and time/node budgets provide predictable resource limits and a busy/unavailable fallback.

**28. Does increasing depth always make the site better?** It can improve analysis but increases latency and resource use. Evaluate user value and budget; depth reached also varies by position. Separate quick interactive analysis from a future deeper job mode if needed.

## RAG and neural language models

**29. Explain RAG in one sentence.** Retrieve relevant corpus evidence at request time and condition language-model output on that evidence, rather than asking the model to answer solely from pretrained knowledge.

**30. What is embedded?** One mainline PGN game with headers, excluding comments and variations. Query text combines player identity and context. The PDF reader's uploaded books are not part of the report vector corpus.

**31. Why MiniLM?** It is a compact pretrained text embedding option that fits local CPU inference. This project uses its 384-dimensional representations; it has not established that MiniLM is optimal for chess notation.

**32. What is an embedding?** A learned numerical representation of text used to compare contextual similarity. A coordinate is not a named chess feature, and nearby text vectors do not imply equal board strength.

**33. How does a transformer work conceptually?** Token representations interact through learned attention, then are transformed into context-sensitive representations. An encoder can pool them for retrieval; a generative model produces output tokens. The application delegates these computations to pretrained systems.

**34. How are cosine similarity and distance related?** Similarity is the normalized dot product. Cosine distance is one minus that quantity, so smaller distance is closer. That is a retrieval ranking signal, not confidence in a report claim.

**35. Why filter by player before similarity search?** Semantically similar games from another player are invalid opponent evidence. Eligibility filtering constrains the candidate corpus before ranking; returned IDs/metadata/PGNs are then checked again.

**36. Does a matching name prove identity?** No. Names vary and can collide. The system prefers FIDE IDs and reviewed unambiguous aliases, retaining provisional identities when appropriate rather than fuzzy-merging everyone.

**37. What is the long-PGN limitation?** The embedding model's default input limit can truncate a full-game document. Stored PGN length and model-visible text are different. Phase/position-aware chunks are a future experiment, not a feature already present.

**38. Why pgvector rather than Pinecone or a separate vector service?** The current corpus already depends on PostgreSQL for identity and evidence. Co-locating vectors simplifies deployment and metadata consistency. A dedicated service may become reasonable at a different scale.

**39. Why isn't HNSW automatically enabled?** At small scale exact search is simple and adequate. HNSW introduces approximation, memory and build cost; filtered recall must be benchmarked. The code provides an explicit operator-controlled path.

**40. Is RAG the same as fine-tuning?** No. RAG changes request context using external records. Fine-tuning changes model weights through training. No Gemini/MiniLM fine-tuning pipeline is implemented here.

**41. Why calculate statistics in SQL?** Counts/results should be deterministic and reproducible. Gemini receives those facts and selected games to interpret. Asking a language model to count a corpus is less reliable and less auditable.

**42. How do you prevent hallucinations?** Reduce them with eligible sources, bounded prompts, required citations, schema validation, numerical-fact separation and tentative recommendations. These are controls, not a proof of zero hallucinations.

**43. Does a citation establish truth?** It establishes that the reference exists among supplied evidence. It does not prove the prose correctly interprets the reference. Semantic support needs further evaluation or human review.

**44. What does structured output solve?** Stable report fields and predictable UI rendering. It does not solve factuality. Pydantic and application validators still inspect the returned object and references.

**45. What is actually streamed?** Progress, verified statistics and the final complete report as NDJSON. Gemini is called with `generateContent`; provider tokens are not streamed into the UI.

**46. What does low temperature achieve?** It reduces sampling variability, but does not turn an LLM into a deterministic database or guarantee truthful analysis. The code also uses output limits and explicit schemas.

**47. Can you explain Gemini's exact layers/parameters?** Not from this repository. It exposes a configurable provider model ID, not the provider's internals. Explain general language-model inference without fabricating proprietary architecture details.

**48. What does ingestion change in the AI system?** It changes SQL observations, available retrieval evidence, vectors and cache versions. It does not retrain pretrained weights.

## PDF reader, algorithms and data structures

**49. Why did extraction stop after five plies?** An unresolved figurine or fragmented text run can break legal parsing after a valid prefix. The exact PDF encoding must be inspected; a screenshot alone does not establish it. The current pipeline preserves font/geometry and unresolved tokens for review.

**50. Why doesn't S3 fix that?** S3 stores documents. It does not map custom glyphs to pieces, establish legal parent positions or reconstruct variations. Better storage and better recognition are independent concerns.

**51. How do you handle standard piece symbols?** Normalize both white/black Unicode figurines to SAN letters, remove variation selectors and then validate against the board. Pawn symbols map to pawn notation.

**52. How do custom fonts differ?** A font can draw a knight while exposing an arbitrary character code. Mappings need document/font context and user confirmation using the actual printed crop; global character replacement can corrupt prose.

**53. Why not infer the piece solely from legality?** A rook and queen may both legally reach the printed destination. Legality filters possibilities but cannot prove what ink was printed. Ambiguous interpretations should remain explicit.

**54. Why a stack for variations?** Parentheses nest. Entering a variation saves the current parser state; leaving it restores the latest state first. That is exactly last-in/first-out behavior.

**55. Why a tree for study moves?** Mainline and alternatives share prefixes and branch. Nodes retain position, notation, comments and sources. A flat list loses parent relationships and makes preserving alternatives difficult.

**56. Is the tree a transposition table?** No. Equal positions reached by different paths may stay separate because history and annotations differ. Engine transposition tables are a different optimization inside Stockfish.

**57. How do you continue across commentary/pages?** Move numbers, side to move and legal replay identify candidate earlier anchors. The reader carries tree context across pages and asks when more than one game/position could fit.

**58. Why preserve geometry?** It separates likely columns, joins split glyph runs, supports selected-region extraction, and links moves back to their printed source. It also makes visual confirmation possible.

**59. How does selected-region OCR help?** It reduces interference from nearby prose, diagrams and columns, and permits line/block segmentation. It also cuts transferred/rendered content, though OCR quality still depends on fonts and image quality.

**60. What is the deskew algorithm?** Try a small bounded angle range on a thumbnail, threshold it, score variance in horizontal ink-row sums, then rotate by the best angle and recheck dimensions. It is classical image processing, not a newly trained neural model.

**61. Is OCR confidence move accuracy?** No. It is a recognition score for image text. Complete-line correctness also depends on layout, glyph mapping, variation attachment and the starting position.

**62. What does IndexedDB preserve?** Local document metadata, page progress, review/corrections, tree, mappings and cursor. It does not currently retain the original PDF bytes or guarantee cross-device synchronization.

**63. Why preserve reviewed data across parser upgrades?** User corrections and study history are durable work; extracted caches are disposable computations. Invalidating both would erase value whenever extraction logic improves.

**64. What is expensive in the tree implementation?** Child lookup is linear in siblings, anchor search replays lines, and manual exploration clones the tree. Large documents may need indexed nodes and structural sharing; current bounded tests do not prove arbitrary-book scalability.

## OOP, backend reliability and security

**65. Where did you use encapsulation?** `EnginePool` manages process slots/cache/locking, while `GeminiReportClient` encapsulates provider requests. Point to their state and public methods rather than only naming the principle.

**66. Where did you use inheritance?** Pydantic response models extend base models, `SavedStudy` extends `StudyInput`, `MigratedPGVector` overrides library hooks, `ApiError` extends Error, and React error boundaries extend Component.

**67. Where is polymorphism?** The PGVector adapter overrides behavior used through the same interface; ASGI middleware is callable like the application it wraps; exceptions share base-class handling. Avoid claiming Java-style overloading that is not present.

**68. Why composition instead of more inheritance?** Pools, clients and components combine smaller responsibilities. Deep inheritance would not improve simple functional parsing or orchestration and could make lifecycle assumptions harder to test.

**69. Are you fully SOLID?** There are useful separations and abstractions, but large orchestration components and concrete global dependencies remain. Explain those trade-offs rather than presenting a design-principle checklist as proof.

**70. Why can't you just cancel a running thread?** Cancelling an async wrapper does not forcibly stop synchronous work already executing. The report slot stays reserved until the underlying future finishes; OCR uses killable subprocesses for a hard deadline.

**71. What is the GIL's relevance?** It limits simultaneous Python bytecode execution in a process, but I/O concurrency and separate processes still help. Some native libraries release it. `async` does not make CPU loops parallel.

**72. How do you avoid duplicate ingestion?** Canonical game identities, unique game/ply rows, stable embedding IDs and an indexed flag make re-delivery safe. Provenance is recorded separately from game identity.

**73. What is a publisher confirmation versus acknowledgment?** Confirmation tells the publisher the broker accepted its publication; consumer acknowledgment tells the broker processing can release the delivery. Both are needed at different stages.

**74. Why is this not exactly-once delivery?** Crash windows can produce duplicate deliveries. The system tolerates them through idempotent effects. A confirmed retry publish followed by a crash before original acknowledgment illustrates that boundary.

**75. How does the OCR queue avoid double claims?** PostgreSQL locks a queued row with `FOR UPDATE SKIP LOCKED` while transitioning it to running. Other workers skip locked rows; job state and claim are transactional.

**76. Why connection pooling?** Reuse avoids opening a PostgreSQL connection for every lookup and bounds concurrency. Pool checkout and SQL timeouts prevent unbounded waiting; total connections must include every process and the separate vector pool.

**77. How is authentication checked?** The API verifies an RS256 signature using JWKS and validates issuer, audience, expiry and subject. Decoding base64 payloads or checking token shape is not sufficient verification.

**78. How is authorization different?** A valid ordinary user may predict/read private studies but cannot ingest without the configured scope/role. Owner-scoped queries additionally restrict access to private resources.

**79. Why isn't CORS enough?** Non-browser clients can call an API regardless of browser CORS rules. Authorization must be enforced server-side for every protected operation.

**80. How do you prevent stale UI replies?** Abort old requests and check request identity, FEN, opponent and revision before applying. A guarded reducer repeats the condition. Version checks remain necessary even if network cancellation fails.

**81. What happens during Redis failure?** Cache access times out quickly and computation continues. Total PostgreSQL failure is different because admission and authoritative evidence depend on it.

**82. What happens during Gemini failure?** The report returns an explicit failure; streamed SQL facts may already be visible. The application does not manufacture a success report. Provider usage might still be charged, so cost can be unknown.

**83. What does readiness guarantee?** Database access and sufficiently fresh ingestion/OCR heartbeats. It does not prove nonempty data, live provider quota, successful OCR on every font, or complete system redundancy.

**84. Are all caches private?** No. Shared game evidence and response caches are keyed by analysis context, not owner. Private studies/OCR results and local document session selection have explicit owner scoping. Do not confuse access control with caching.

## Evaluation, deployment and reflection

**85. How do you prevent evaluation leakage?** Deduplicate games, split whole games rather than random moves, and prefer chronological dates. Tune prior strength on validation only, then evaluate once on test. Related events/players can still require more careful study design.

**86. What do the saved accuracy numbers mean?** An older hash-split report measured about 27.18% top-1 and 46.14% top-3 over 2,642 positions. It is not a fresh production result or Stockfish Elo measurement, and about 95.65% lacked historical matches.

**87. Why measure calibration as well as accuracy?** Two systems can rank equally well while assigning very different probabilities. Log loss/Brier/ECE expose overconfidence and probability quality, though small datasets make these estimates noisy.

**88. What tests matter most?** The tests protecting actual failure modes: malformed or foreign evidence, sparse samples, retry duplication, cancellation capacity, owner separation, fragmented figurines, branching continuations, viewport transitions and stale responses.

**89. Do passing browser tests prove accessibility?** No. Automated axe checks, keyboard cases and snapshots catch important regressions but do not replace screen-reader/manual assessment or prove all WCAG criteria.

**90. How would you scale it?** Measure bottlenecks first. Budget process-local engines/models, DB pools and provider calls; scale workers carefully; add global admission if needed; benchmark filtered ANN retrieval at real volume; improve corpus/query design before buying more compute.

**91. Why split Docker images?** API, ingestion, OCR and migrations have different dependency/resource needs. The OCR worker needs Tesseract; migration does not. Production images also exclude test authentication fixtures.

**92. What is CI doing?** It checks frontend lint/types/contracts/build/tests and isolated backend/authenticated-browser behavior. Hosted CI results must be checked separately; local success is not proof the remote workflow passed.

**93. What do metrics and tracing each provide?** Metrics summarize trends such as p95 latency, cache outcomes and failed attempts. Traces show where one sampled request/job spent time across boundaries. Logs provide diagnostic events; they should not expose credentials.

**94. How do backups work?** PostgreSQL dumps are scheduled, an optional uploader transfers them to a private S3-compatible target, and restore checks use disposable databases. Original books/PGNs and local IndexedDB sessions need their own preservation plan.

**95. What is your most important remaining limitation?** Evidence quality/coverage and document ambiguity. More advanced models cannot compensate automatically for wrong player identity, missing games, truncated retrieval text or incorrectly attached book variations.

**96. What would a custom trained move model require?** A clearly defined target, licensed representative games, chronology-aware splits, board/history features, baselines, training infrastructure, calibration and held-out evaluation. None of that should be implied by the current pretrained integrations.

**97. What would you do differently with a larger team?** Introduce stronger module interfaces, reviewable architecture decisions, strict typed reader models, realistic provider/book evaluation datasets, deployment automation and operational ownership. Keep justified complexity proportional to the workload.

**98. What are your strongest technical lessons?** Distinguish likelihood from strength, legality from extraction correctness, citations from truth, cancellation from stopped work, and cached results from authoritative data. Those distinctions explain the project's most valuable reliability improvements.

**99. How should you describe your personal contribution?** Identify decisions, code and debugging you actually performed, then credit upstream libraries, pretrained models and assistance. A precise explanation of integration and trade-offs is stronger than claiming you authored every underlying algorithm.

**100. What code should you open if challenged?** Start with `prediction_model.py`, `predict_opponent.py`, `engine_pool.py`, `chessPdf.js`, `bookReplay.js`, `task_queue.py` and `ocr_jobs.py`. Follow the pinned source reading map in the report and explain inputs, invariants, failure handling and tests for each.
