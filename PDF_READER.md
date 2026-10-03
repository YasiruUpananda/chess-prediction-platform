# Document-aware chess book reader

Open a local PDF on `/reader`. Previous/Next and the page-number field navigate directly. Review extracted moves and load the line beneath the board. Left/Right arrow keys replay moves; editable fields keep their normal behavior. Branch points ask which continuation to follow.

## Structure and game history

Text runs retain page, raw text, font name, estimated size, transformation matrix, bounding box and `hasEOL`. Coordinates separate columns before parsing. Move numbers, side to move and legality reconnect commentary and numbered alternatives. Ambiguous anchors require a choice.

When leaving a page with a loaded game for an unread page, choose **Continue previous game**, **Start a new game**, or **Use a diagram FEN**. Continuing seeds parsing with the reviewed line, then merges the next reviewed line into the game tree. Nodes retain parent FEN, SAN/UCI, source spans, comments and alternatives. Earlier branches remain replayable. Separate games are archived in the document's game selector.

Selecting an imported move highlights its estimated printed span and navigates to its source page when needed. Text-run widths provide approximations: ligatures, unusual kerning and split symbols can prevent exact glyph-level highlighting. Deskewed OCR coordinates are not shown as exact original PDF positions. Diagrams/disconnected midgame passages need FEN. Page boundaries require review; this does not claim automatic diagram recognition or reconstruction of every book layout.

## Piece fonts and selected notation

Standard Unicode figurines normalize to SAN. Custom symbols require confirmed mappings scoped to font/document. The recognition panel shows an actual printed-symbol crop. PDF.js document-instance prefixes are removed from mapping keys so reopening the same document can reuse mappings. Legality offers suggestions only when all complete legal readings agree; it cannot prove the printed piece. Unknown symbols stay unresolved. OCR no longer guesses queens or other pieces for unreadable characters.

**Select a move line** enables rectangle dragging with pointer/touch input. Alternatively, select PDF text and choose **Read selected PDF text**. Region filtering happens before parsing. Whitespace-token positions within a single long text run are estimated from its width; review the resulting notation.

**OCR selected region** renders only that crop. Choose block (`--psm 6`) or single-line (`--psm 7`) mode. Whole-page OCR uses `--psm 3`. Region OCR tries a bounded +/-3 degree deskew on a downscaled projection profile. Accuracy on actual chess fonts still needs measurement; no provider change was made.

The authenticated image endpoint accepts `mode=page|block|line`, PNG/JPEG and at most 8 MB. Full PDFs remain local. Dimension/pixel limits apply before decoding and after deskew; the browser bounds canvas allocation. Validation and queue admission run off the event loop. Existing owner isolation, bounded queue/concurrency, 45-second subprocess deadline and 30-second Tesseract timeout remain. Cache identity includes segmentation mode and `ocr-region-v3`. Uploaded bytes are released after completion/failure and results expire after one hour.

## Local sessions

IndexedDB stores metadata under authenticated subject plus document SHA-256 fingerprint. Reopen the same local PDF to restore page, game tree, cursor/variation, FEN, orientation, reviewed lines, corrections and confirmed mappings. The PDF itself is not saved/uploaded. Parser version, FEN and mapping signatures prevent obsolete parsed results from being reused. Up to 40 pages of extraction/review results are retained per document.

Storage belongs to this browser/device; it is not an encrypted cloud library. **Forget local reading progress** deletes this document's session. Storage failures show a message and leave the tab usable. Saved studies and PGN export remain independent.

## Benchmarks

`npm run benchmark:pdf` reports complete-line and variation-attachment accuracy for labelled notation/layout fixtures. Legal truncation gets no complete-line credit. Fixtures cover the supplied 20-ply transcription, Unicode/custom symbols, two columns, commentary, nested branches and page continuation. These scores describe generated/transcribed fixtures, not real-book OCR accuracy.

For real books, copy `frontend/benchmarks/pdf/manifest.example.json` into an ignored local directory. Set actual file paths and manually labelled complete SAN lines and branch prefixes:

```powershell
cd frontend
$env:PDF_BENCHMARK_MANIFEST = '../.runtime/pdf-benchmark/manifest.json'
npm run benchmark:pdf:books
```

Include licensed/local real samples of custom fonts, columns, commentary, nested branches, scans and page continuations. The browser harness processes actual PDFs and attaches a JSON accuracy report. Private books/manifests must not be committed. Real-book measurements remain pending until a corpus is provided. Browser regression tests cover cross-page replay and cropping; backend integration tests check complete-line recovery on generated scans.

## Verification

```powershell
cd frontend
npm run lint
npm test
npm run build
npm run api:check
npm run test:browser
```

From the repository root: `docker compose run --rm -e RUN_INTEGRATION_TESTS=1 backend-tests`.

References: [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html), [Tesseract quality and segmentation guidance](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html).
