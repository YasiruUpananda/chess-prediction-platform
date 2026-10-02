# Prediction quality

The dashboard lists indexed players from authenticated `GET /api/v1/players`, with distinct game counts. Refresh the list after ingestion. Move reports separate estimated opponent behavior from Stockfish's strongest move. Both refer to the position before the automatic reply.

Historical lookup uses piece placement, turn, castling rights and **legal** en-passant state. Each indexed game contributes at most one observation per player and position. Estimates blend observations with a heuristic prior of 20 equivalent observations: `(move_count + 20 * prior_probability) / (matching_games + 20)`. These estimates are not calibrated probabilities or win probabilities. Reports show observed games, matching games and the historical contribution.

The frontend retains initial FEN, UCI moves and exportable PGN. The API validates legal board states, replays submitted history, checks that it matches the submitted FEN, and retains repetition history for engine analysis. Legacy FEN-only requests remain supported with `history_verified: false`. Automatic game endings stop predictions; claimable draws are reported separately.

## Engine

Docker installs checksum-pinned official Stockfish 18, retaining its complete GPL bundle under `/opt/stockfish18`. The bundled binary targets Linux x86-64. Other architectures require a verified native build.

The API uses two reusable processes by default, each with one thread and 64 MB hash. Environment controls: `STOCKFISH_PATH`, `STOCKFISH_POOL_SIZE` (1–4), `STOCKFISH_TIME_SECONDS` (0.05–2, default 0.25) and `STOCKFISH_NODES` (1,000–1,000,000, default 100,000). Set these in the API container environment when overriding Docker defaults. Each candidate search stops at the first time/node limit. Evaluating an estimated move outside the top three can require a second search. UCI communication has a three-second timeout. Busy or failed engines return a status while likelihood predictions continue. Engine results have a bounded 256-entry, five-minute cache including full move history; API responses retain their short Redis TTL.

Scores are from White's perspective, displayed as pawn units or mate distance. This is bounded analysis rather than an exhaustive best-move guarantee.

## Evaluation

Run `docker compose exec -T ml-engine python evaluate_predictions.py data/tournament.pgn --output /tmp/evaluation.json`.

The evaluator deduplicates games by starting position and mainline, then deterministically holds out approximately 20% of entire games. Training observations count distinct games using the same position key and smoothing as the API. It reports top-1/top-3 accuracy, multiclass Brier score, log loss and ten-bin expected calibration error, overall and by player, ECO opening and sample-size bucket. Opening labels missing from PGN appear as Unknown. Small subgroup results need more games before drawing conclusions. Held-out evaluation measures opponent behavior; engine move strength is separate. Re-run after increasing the dataset or changing the model. Do not fit parameters on this test split without reserving another final test set.
