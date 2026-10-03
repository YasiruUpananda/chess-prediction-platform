# PDF study reader

The reader identifies numbered chess lines before validating SAN. Brace comments, semicolon comments, numeric annotation glyphs and nested parenthesized variations are parsed separately. Main lines continue after variations. Ordinary prose such as “See diagram e4 and square d5” does not create a move list. Alternative lines retain the preceding moves needed to reach their branching position.

PDF.js text items retain font identity, transforms, dimensions and end-of-line metadata. Nearby piece-symbol and destination runs are joined using row geometry. A central gutter heuristic separates two columns, and lines show their originating column. Complex layouts, diagrams, rotated text and OCR errors can still require manual correction; this is not a general book-layout recognizer.

Numbered moves after commentary reconnect to earlier legal positions. Prose alternatives become variations when their anchor is unique. If multiple earlier games or variations fit, the reader asks which starting line to use; unresolved passages cannot be replayed. New games beginning at move one remain separate. Reconstruction operates within one page and column; continuing across pages still uses the chosen starting FEN.

Custom PDF symbols are mapped by font identity and character. The recognition panel renders a bounded crop of the printed symbol, and confirmed mappings apply to that font throughout the current document session. When a glyph occurs within a longer text run, its horizontal crop is approximate. Missing symbols still require OCR or manual correction. Unicode figurines for both colors normalize directly. Desktop-to-mobile resize transitions are covered by browser regressions.

Choose a main line or variation, review/edit its SAN, and validate corrections. Illegal moves retain a warning and only their legal prefix can be replayed. Set the book's starting FEN for midgame lines; move numbers and side to move are checked against it. “Use current board as start” supports continuing from a position studied on a previous page.

“Load reviewed line” returns to its starting position and enables Previous/Next move navigation. Manual board moves create a new branch from the displayed position. Undo removes the last displayed move and its following branch. Board flipping, a promotion-piece selector and export of the current position's PGN are available. PGN includes custom starting FEN and move history. Reset board retains the chosen starting FEN; Standard start restores the usual chess position.

Line validation labels describe syntactic/legal extraction checks, not statistical accuracy. OCR word confidence is shown separately and is not a probability that the line or book analysis is correct.

## OCR and privacy

Text extraction stays local. A scanned page, or the Try page OCR button, renders **only the selected page** to a PNG and uploads it to authenticated `POST /api/v1/extract-page-image`. The full PDF is never uploaded by this reader. The original whole-PDF OCR endpoint remains available for older clients.

The selected-page endpoint accepts PNG/JPEG, a positive page number and at most 8 MB. Image dimensions are checked before pixel decoding/queueing: at most 8,192 pixels per side and `OCR_MAX_PIXELS` total pixels (default 16 million). API and worker use the same Compose setting. The browser bounds its OCR canvas to 4,000 pixels per side and approximately 12 million pixels before allocation. The displayed PDF canvas also has dimension/pixel checks. Locally opened PDF files are limited to 200 MB to bound hashing and PDF worker input.

Image validation and database admission run outside the async event loop. The existing durable queue admits at most eight jobs globally and two per owner. The single OCR worker runs each job in a disposable subprocess with a 45-second deadline, Tesseract's 30-second timeout and the existing container memory/CPU limits. OCR returns raw text, word coordinates, word confidence and `ocr-layout-v2`. The client polls for at most three minutes and cancels obsolete requests/rendering when the page or document changes.

Jobs and caches are scoped to the authenticated owner's subject. Identical page image content/page/OCR-version reuses a queued, running or completed job for that owner; other owners receive separate jobs and cannot poll it. Uploaded bytes are removed after completion/failure, and finished job results are removed after one hour. The hash is computed by the server from the received image, so a client cannot claim another document's cached content.

Browser extraction uses a bounded 40-entry cache keyed by the full PDF's SHA-256, page, extraction version and extraction mode. It stores raw text/layout, which is revalidated for each starting FEN. It lives only for the reader session. Revisiting pages and changing the starting FEN can reuse extraction without rerunning OCR. Failed OCR requests remain retryable.

## Verification

```
cd frontend
npm run lint
npm run build
node --test src/chessPdf.test.js src/gameHistory.test.js src/requestGate.test.js src/reportStream.test.js
```

```
docker compose exec -T -e RUN_INTEGRATION_TESTS=1 ml-engine python -m unittest test_pdf_reader test_reliability_integration
```

Tests cover nested variations/comments, prose square references, two-column ordering, midgame FENs, underpromotion/PGN history, selected-image OCR, owner isolation, cache reuse, image dimensions/pixel limits, queue admission, subprocess deadlines and the legacy PDF endpoint. References: [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/api.js.html), [FastAPI concurrency](https://fastapi.tiangolo.com/async/).
