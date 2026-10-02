import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import ResponsiveBoard from './ResponsiveBoard';
import SavedStudies from './SavedStudies';
import { Chess } from 'chess.js';
import { parseChessText, textBlocks, EXTRACTION_VERSION } from './chessPdf';
import { restoreGame, gameSnapshot } from './gameHistory';
import { useSession } from './sessionContext';
import { friendlyError, waitForPoll } from './api';
import { extractPageImage, getOcrJob } from './apiClient';
const PdfDocumentView = lazy(() => import('./PdfDocumentView'));

export default function PdfReader() {
  const { getAccessToken, state } = useSession();
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfDocument, setPdfDocument] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageWidth, setPageWidth] = useState(680);
  const documentPanel = useRef(null);
  const [pdfError, setPdfError] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [initialFen, setInitialFen] = useState(new Chess().fen());
  const [fenInput, setFenInput] = useState(new Chess().fen());
  const [timeline, setTimeline] = useState([]);
  const [cursor, setCursor] = useState(0);
  const game = useMemo(() => restoreGame(initialFen, timeline.slice(0, cursor)), [initialFen, timeline, cursor]);
  const [orientation, setOrientation] = useState('white');
  const [promotion, setPromotion] = useState('q');
  const [moveInput, setMoveInput] = useState('');
  const [lines, setLines] = useState([]);
  const [selectedLine, setSelectedLine] = useState(0);
  const [editor, setEditor] = useState('');
  const [extractionInfo, setExtractionInfo] = useState(null);
  const [documentHash, setDocumentHash] = useState('');
  const [forceOCR, setForceOCR] = useState(false);
  const [extractionAttempt, setExtractionAttempt] = useState(0);
  const [pageGeometry, setPageGeometry] = useState(null);
  const extractionCache = useRef(new Map());
  const [pageMoves, setPageMoves] = useState([]);
  const [moveStatus, setMoveStatus] = useState('Choose a move to play it on the board.');

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setPageWidth(Math.min(760, Math.max(1, Math.floor(entry.contentRect.width - 36)))));
    if (documentPanel.current) observer.observe(documentPanel.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdfFile) return;
    let cancelled = false;
    pdfFile.arrayBuffer().then((bytes) => crypto.subtle.digest('SHA-256', bytes)).then((digest) => {
      if (!cancelled) setDocumentHash([...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''));
    }).catch(() => { if (!cancelled) setPdfError('Could not identify this document for extraction.'); });
    return () => { cancelled = true; };
  }, [pdfFile]);

  useEffect(() => {
    if (!pdfDocument) return;
    let cancelled = false;
    pdfDocument.getPage(pageNumber).then((page) => {
      const viewport = page.getViewport({ scale: 1 });
      const height = pageWidth * viewport.height / viewport.width;
      const safe = Number.isFinite(height) && height > 0 && height <= 8192 &&
        Math.max(viewport.width, viewport.height) <= 14400 && pageWidth * height * 4 <= 16000000;
      if (!cancelled) setPageGeometry({ document: pdfDocument, page: pageNumber, width: pageWidth, safe });
    }).catch(() => { if (!cancelled) setPdfError('Could not read page dimensions.'); });
    return () => { cancelled = true; };
  }, [pdfDocument, pageNumber, pageWidth]);

  useEffect(() => {
    if (!pdfFile || !pdfDocument || !documentHash) return;
    const controller = new AbortController();
    let renderTask;
    let canvas;
    const extractMoves = async () => {
      setIsExtracting(true); setPageMoves([]); setLines([]); setEditor(''); setExtractionInfo(null);
      setMoveStatus(`Reading page ${pageNumber}...`);
      try {
        const key = `${documentHash}:${pageNumber}:${EXTRACTION_VERSION}:${forceOCR ? 'ocr' : 'text'}`;
        let extracted = extractionCache.current.get(key);
        const cached = Boolean(extracted);
        if (!extracted) {
          const page = await pdfDocument.getPage(pageNumber);
          const content = await page.getTextContent();
          const viewport = page.getViewport({ scale: 1 });
          const blocks = textBlocks(content.items, viewport.width);
          const readableText = blocks.map((block) => block.text).join('\n');
          extracted = { blocks, source: 'PDF text', ocrConfidence: null };
          if (forceOCR || readableText.trim().length < 10) {
            // Cap dimensions before allocating a canvas. Only this page leaves the browser.
            if (!Number.isFinite(viewport.width * viewport.height) || viewport.width <= 0 || viewport.height <= 0 || Math.max(viewport.width, viewport.height) > 14400) {
              throw new Error('Page dimensions exceed the rendering limit.');
            }
            const scale = Math.min(200 / 72, 4000 / Math.max(viewport.width, viewport.height), Math.sqrt(12000000 / (viewport.width * viewport.height)));
            const imageViewport = page.getViewport({ scale });
            canvas = document.createElement('canvas');
            canvas.width = Math.ceil(imageViewport.width); canvas.height = Math.ceil(imageViewport.height);
            renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport: imageViewport });
            await renderTask.promise;
            if (controller.signal.aborted) return;
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
            canvas.width = 0; canvas.height = 0;
            if (!blob || blob.size > 8 * 1024 * 1024) throw new Error('Page image exceeds the 8 MB OCR upload limit.');
            const formData = new FormData(); formData.append('file', blob, 'page.png'); formData.append('page', String(pageNumber));
            let job = await extractPageImage(formData, {
              signal: controller.signal, getAccessToken, timeout: 30000,
            });
            const deadline = Date.now() + 3 * 60 * 1000;
            while (job.status === 'queued' || job.status === 'running') {
              if (Date.now() > deadline) throw new Error('OCR is taking too long. Try this page again later.');
              setMoveStatus(job.status === 'queued' ? 'Page queued for OCR...' : 'Reading this page image...');
              await waitForPoll(controller.signal);
              job = await getOcrJob(job.job_id, {
                signal: controller.signal, timeout: 10000, getAccessToken,
              });
            }
            if (job.status !== 'completed') throw new Error(job.error || 'OCR could not process this page.');
            const items = (job.result.text_items || []).map((item) => ({ ...item, transform: [1, 0, 0, item.height, item.x, -item.y] }));
            extracted = { blocks: items.length ? textBlocks(items, canvas?.width || imageViewport.width) : [{ column: 1, text: job.result.text || '' }],
              source: 'Page image OCR', ocrConfidence: job.result.ocr_confidence };
          }
          if (controller.signal.aborted) return;
          extractionCache.current.set(key, extracted);
          while (extractionCache.current.size > 40) extractionCache.current.delete(extractionCache.current.keys().next().value);
        }
        if (controller.signal.aborted) return;
        const found = extracted.blocks.flatMap((block) => parseChessText(block.text, initialFen).map((line) => ({ ...line, column: block.column })));
        setLines(found); setSelectedLine(0); setPageMoves(found[0]?.moves || []);
        setEditor(found[0]?.raw || extracted.blocks.map((block) => block.text).join('\n'));
        setExtractionInfo({ ...extracted, cached, confidence: found[0]?.confidence || 'low', issue: found[0]?.issue || '' });
        setMoveStatus(found.length ? `${found.length} lines found. Review a line and its starting position before replaying.` : 'No numbered chess line found. You can correct the text or try page OCR.');
      } catch (error) {
        if (!controller.signal.aborted) setMoveStatus(`Could not read this page: ${friendlyError(error)}`);
      } finally {
        if (canvas) { canvas.width = 0; canvas.height = 0; }
        if (!controller.signal.aborted) setIsExtracting(false);
      }
    };
    extractMoves();
    return () => { controller.abort(); renderTask?.cancel(); };
  }, [getAccessToken, pageNumber, pdfDocument, pdfFile, documentHash, initialFen, forceOCR, extractionAttempt]);

  function onFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setPdfError('Choose a PDF file to start reading.');
      event.target.value = '';
      return;
    }
    if (file.size > 200 * 1024 * 1024) { setPdfError('Choose a PDF smaller than 200 MB.'); return; }
    setDocumentHash(''); setForceOCR(false); setLines([]); setEditor(''); setExtractionInfo(null);
    setPdfError('');
    setPdfDocument(null);
    setPageMoves([]);
    setPageNumber(1);
    setNumPages(0);
    setPdfFile(file);
  }

  function onDocumentLoadSuccess(document) {
    const { numPages: loadedPages } = document;
    setPdfDocument(document);
    setNumPages(loadedPages);
    setPageNumber(1);
    setPdfError('');
  }

  function commitMove(move) {
    const nextGame = restoreGame(initialFen, timeline.slice(0, cursor));
    try {
      const played = nextGame.move(move);
      const snapshot = gameSnapshot(nextGame);
      setTimeline(snapshot.moves); setCursor(snapshot.moves.length);
      setMoveStatus(`Played ${played.san}.`); return true;
    } catch { setMoveStatus('This move is illegal from the current position.'); return false; }
  }

  function onDrop(from, to) { return commitMove({ from, to, promotion }); }
  function handlePlayMove(san) { commitMove(san); }
  function handleReplayMoves() {
    const nextGame = new Chess(initialFen);
    for (const san of pageMoves) nextGame.move(san);
    const snapshot = gameSnapshot(nextGame);
    setTimeline(snapshot.moves); setCursor(0);
    setMoveStatus(`Loaded ${snapshot.moves.length} moves. Use Next move to step through this line.`);
  }
  function selectLine(index) {
    const line = lines[index]; setSelectedLine(index); setPageMoves(line.moves); setEditor(line.raw);
    setExtractionInfo((info) => ({ ...info, confidence: line.confidence, issue: line.issue }));
  }
  function correctLine() {
    try {
      const corrected = parseChessText(editor, initialFen, true);
      if (!corrected.length) { setMoveStatus('Enter SAN moves, for example: e4 e5 Nf3 Nc6.'); return; }
      setLines(corrected.map((line) => ({ ...line, column: 1 }))); setSelectedLine(0);
      setPageMoves(corrected[0].moves);
      setExtractionInfo((info) => ({ ...info, confidence: corrected[0].confidence, issue: corrected[0].issue }));
      setMoveStatus(corrected[0].issue || 'Corrections validated. Load the line to replay it.');
    } catch (error) { setMoveStatus(error.message); }
  }
  function applyFen(fen) {
    try { const board = new Chess(fen); setInitialFen(board.fen()); setFenInput(board.fen()); setTimeline([]); setCursor(0); setMoveStatus('Starting position updated.'); }
    catch { setMoveStatus('Invalid FEN. Check the position and side to move.'); }
  }
  function exportPgn() {
    const url = URL.createObjectURL(new Blob([game.pgn()], { type: 'application/x-chess-pgn' }));
    const link = document.createElement('a'); link.href = url; link.download = 'book-study.pgn'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function clearPdf() {
    setPdfFile(null); setDocumentHash(''); setLines([]); setEditor(''); setExtractionInfo(null); setForceOCR(false); setIsExtracting(false);
    setPdfDocument(null);
    setNumPages(0);
    setPageNumber(1);
    setPageMoves([]);
    setPdfError('');
  }

  return (
    <main className="reader-shell">

      <div className="reader-title-row">
        <div><span className="eyebrow">Read. Explore. Play.</span><h1>Interactive book reader</h1>
          <p>Read a chess book and try its moves on the board as you go.</p></div>
        {pdfFile && <button className="reader-secondary-button" type="button" onClick={clearPdf}>Choose another PDF</button>}
      </div>

      <div className="reader-layout">
        <section ref={documentPanel} className="reader-document panel" aria-label="PDF document">
          <div className="reader-panel-heading">
            <div><span className="eyebrow">Your library</span><h2>{pdfFile ? pdfFile.name : 'Open a chess book'}</h2></div>
            {pdfFile && numPages > 0 && <span className="reader-page-count">{pageNumber} / {numPages}</span>}
          </div>

          {!pdfFile ? (
            <label className="pdf-upload-zone">
              <span className="pdf-upload-icon" aria-hidden="true">＋</span>
              <strong>Choose a PDF to read</strong>
              <span>Text based and scanned chess books are supported.</span>
              <span className="reader-primary-button">Browse files</span>
              <input aria-label="Choose a PDF to read" type="file" accept="application/pdf,.pdf" onChange={onFileChange} />
            </label>
          ) : (
            <>
              <div className="pdf-toolbar">
                <button className="reader-secondary-button" type="button" onClick={() => { setForceOCR(false); setPageNumber((page) => Math.max(1, page - 1)); }} disabled={pageNumber <= 1}>← Previous</button>
                <span>Page <b>{pageNumber}</b> of <b>{numPages || '…'}</b></span>
                <button className="reader-secondary-button" type="button" onClick={() => { setForceOCR(false); setPageNumber((page) => Math.min(numPages, page + 1)); }} disabled={!numPages || pageNumber >= numPages}>Next →</button>
              </div>
              <div className="pdf-page-stage">
                <Suspense fallback={<div className="reader-placeholder">Loading PDF viewer...</div>}>
                  <PdfDocumentView file={pdfFile} onLoadSuccess={onDocumentLoadSuccess}
                    onLoadError={(error) => setPdfError(`This PDF could not be opened: ${error.message}`)}
                    pageNumber={pageNumber} width={pageWidth}
                    geometryReady={pageGeometry?.document === pdfDocument && pageGeometry.page === pageNumber && pageGeometry.width === pageWidth}
                    safe={pageGeometry?.safe} />
                </Suspense>
              </div>
            </>
          )}
          {pdfError && <p className="reader-error" role="alert">{pdfError}</p>}
        </section>

        <aside className="reader-side-column">
          <section className="reader-board-card panel">
            <div className="reader-panel-heading"><div><span className="eyebrow">Interactive board</span><h2>Try the position</h2></div><span className="reader-turn">{game.turn() === 'w' ? 'White to move' : 'Black to move'}</span></div>
            <div className="reader-board-frame">
              <ResponsiveBoard position={game.fen()} boardOrientation={orientation} onPieceDrop={onDrop} customDarkSquareStyle={{ backgroundColor: '#786347' }} customLightSquareStyle={{ backgroundColor: '#eee5d3' }} />
            </div>
            <form className="keyboard-move-form" onSubmit={(event) => {
              event.preventDefault(); const text = moveInput.trim();
              const move = /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(text) ? { from: text.slice(0,2), to: text.slice(2,4), promotion: text[4] || promotion } : text;
              if (commitMove(move)) setMoveInput('');
            }}><label htmlFor="reader-keyboard-move">Play a move (SAN or UCI)</label>
              <input id="reader-keyboard-move" value={moveInput} onChange={(event) => setMoveInput(event.target.value)} autoComplete="off" placeholder="e4 or e2e4" />
              <button className="reader-secondary-button" type="submit">Play move</button>
            </form>
            <p className="reader-status" aria-live="polite">{moveStatus}</p>
            <div className="reader-board-actions">
              <button className="reader-secondary-button" onClick={() => setCursor(Math.max(0, cursor - 1))} disabled={!cursor}>Previous move</button>
              <span>{cursor} / {timeline.length}</span>
              <button className="reader-secondary-button" onClick={() => setCursor(Math.min(timeline.length, cursor + 1))} disabled={cursor >= timeline.length}>Next move</button>
              <button className="reader-secondary-button" onClick={() => { setTimeline(timeline.slice(0, cursor - 1)); setCursor(cursor - 1); }} disabled={!cursor}>Undo move</button>
              <button className="reader-secondary-button" onClick={() => setOrientation(orientation === 'white' ? 'black' : 'white')}>Flip board</button>
              <button className="reader-secondary-button" onClick={() => { setTimeline([]); setCursor(0); }}>Reset board</button>
              <button className="reader-secondary-button" onClick={exportPgn}>Export current PGN</button>
            </div>
            <label className="reader-field">Promote pawn to<select value={promotion} onChange={(event) => setPromotion(event.target.value)}>
              <option value="q">Queen</option><option value="r">Rook</option><option value="b">Bishop</option><option value="n">Knight</option>
            </select></label>
            <label className="reader-field">Starting position FEN<textarea value={fenInput} maxLength={120} onChange={(event) => setFenInput(event.target.value)} /></label>
            <div className="reader-board-actions"><button className="reader-secondary-button" onClick={() => applyFen(fenInput)}>Apply FEN</button>
              <button className="reader-secondary-button" onClick={() => applyFen(game.fen())}>Use current board as start</button>
              <button className="reader-secondary-button" onClick={() => applyFen(new Chess().fen())}>Standard start</button></div>
          </section>

          <section className="reader-moves-card panel">
            <div className="reader-panel-heading"><div><span className="eyebrow">Page analysis</span><h2>Moves on this page</h2></div><span className="reader-page-count">{isExtracting ? 'Reading…' : pageMoves.length}</span></div>
            <p className="reader-empty-state">Text extraction stays in your browser. OCR sends only the selected page image.</p>
            {lines.length > 0 && <label className="reader-field">Choose main line or variation<select value={selectedLine} onChange={(event) => selectLine(Number(event.target.value))}>
              {lines.map((line, index) => <option key={index} value={index}>Column {line.column} · {line.variation ? 'Variation' : 'Main line'} {index + 1} · {line.moves.length}/{line.candidates} validated plies</option>)}
            </select></label>}
            {extractionInfo && <p className="reader-status">{extractionInfo.source}{extractionInfo.cached ? ' · cached' : ''} · Line validation: {extractionInfo.confidence}.
              {extractionInfo.ocrConfidence != null && ` OCR word confidence: ${Math.round(extractionInfo.ocrConfidence)}%.`}
              {' '}A ply is one move by White or Black. Legality does not prove the whole printed line was extracted.</p>}
            {extractionInfo?.issue && <p className="reader-error" role="alert">{extractionInfo.issue}</p>}
            {extractionInfo && <details><summary>Raw extracted page text</summary>
              <label className="reader-field">Extracted text before move parsing<textarea readOnly rows={6} value={extractionInfo.blocks.map((block)=>block.text).join('\n\n')} /></label>
            </details>}
            {pdfFile && <><label className="reader-field">Review and correct moves<textarea rows={5} value={editor} onChange={(event) => setEditor(event.target.value)} maxLength={50000} /></label>
              <div className="reader-board-actions"><button className="reader-secondary-button" onClick={correctLine} disabled={isExtracting}>Validate corrections</button>
                <button className="reader-secondary-button" onClick={() => { setForceOCR(true); setExtractionAttempt((attempt) => attempt + 1); }} disabled={isExtracting}>Try page OCR</button></div></>}
            {pageMoves.length > 0 && <button className="reader-secondary-button reader-replay-button" type="button" onClick={handleReplayMoves}>{extractionInfo?.issue?'Load validated prefix':'Load reviewed line'}</button>}
            {!pdfFile ? <p className="reader-empty-state">Open a PDF to find chess moves on each page.</p> : pageMoves.length ? (
              <div className="reader-move-list">{pageMoves.map((move, index) => <button className="reader-move-chip" type="button" key={`${move}-${index}`} onClick={() => handlePlayMove(move)}>{move}</button>)}</div>
            ) : <p className="reader-empty-state">{isExtracting ? 'Checking the page text and scanned image…' : 'No valid move tokens found on this page.'}</p>}
          </section>
          <SavedStudies owner={state.sub || state.username || 'session'} disabled={isExtracting}
            snapshot={{fen:game.fen(),initial_fen:initialFen,moves:timeline.slice(0,cursor),opponent_name:'',context:'',color:'any'}}
            onLoad={(study)=>{setInitialFen(study.initial_fen);setFenInput(study.initial_fen);setTimeline(study.moves);setCursor(study.moves.length);setMoveInput('');setMoveStatus('Saved study opened.');}} />
        </aside>
      </div>
    </main>
  );
}
