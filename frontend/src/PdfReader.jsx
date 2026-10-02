import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Document, Page, pdfjs } from 'react-pdf';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import { extractSanMoves } from './chessPdf';
import axios from 'axios';
import { useAuthContext } from '@asgardeo/auth-react';
import { API_BASE_URL, getBearerHeaders, waitForPoll } from './api';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Keep the worker version in lockstep with the installed pdfjs-dist package.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export default function PdfReader() {
  const { getAccessToken } = useAuthContext();
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfDocument, setPdfDocument] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageWidth, setPageWidth] = useState(680);
  const [pdfError, setPdfError] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [game, setGame] = useState(() => new Chess());
  const [pageMoves, setPageMoves] = useState([]);
  const [moveStatus, setMoveStatus] = useState('Choose a move to play it on the board.');

  useEffect(() => {
    const updatePageWidth = () => setPageWidth(Math.min(760, Math.max(280, window.innerWidth - 64)));
    updatePageWidth();
    window.addEventListener('resize', updatePageWidth);
    return () => window.removeEventListener('resize', updatePageWidth);
  }, []);

  useEffect(() => {
    if (!pdfFile || !pdfDocument) return undefined;

    const controller = new AbortController();
    const extractMoves = async () => {
      setIsExtracting(true);
      setPageMoves([]);
      setMoveStatus(`Reading chess moves from page ${pageNumber}…`);

      try {
        const page = await pdfDocument.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item) => item.str || '').join(' ');
        let moves = extractSanMoves(pageText);

        if (!moves.length) {
          const formData = new FormData();
          formData.append('file', pdfFile);
          formData.append('page', String(pageNumber));
          const response = await axios.post(`${API_BASE_URL}/api/v1/extract-page-moves`, formData, {
            signal: controller.signal,
            headers: await getBearerHeaders(getAccessToken),
            timeout: 30000,
          });
          const deadline = Date.now() + 10 * 60 * 1000;
          let job = response.data;
          while (job.status === 'queued' || job.status === 'running') {
            if (Date.now() > deadline) throw new Error('OCR is taking too long. Please try this page again later.');
            if (controller.signal.aborted) return;
            setMoveStatus(job.status === 'queued' ? 'Page queued for OCR…' : 'Reading this scanned page…');
            await waitForPoll(controller.signal);
            const poll = await axios.get(`${API_BASE_URL}/api/v1/ocr-jobs/${job.job_id}`, {
              signal: controller.signal, timeout: 10000,
              headers: await getBearerHeaders(getAccessToken),
            });
            job = poll.data;
          }
          if (job.status !== 'completed') throw new Error(job.error || 'OCR could not process this page.');
          moves = extractSanMoves((job.result?.moves || []).join(' '));
        }

        if (controller.signal.aborted) return;
        setPageMoves(moves);
        setMoveStatus(moves.length
          ? `${moves.length} chess moves found on this page. Choose a move to build the position.`
          : 'No readable chess moves found. Scanned pages need the ML engine and OCR configured.');
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error('Failed to extract moves:', error);
          const detail = error.response?.data?.detail || error.message;
          const status = error.response?.status;
          setMoveStatus(status === 401
            ? 'Your sign-in could not be verified. Sign in again to use OCR on this scanned page.'
            : `Could not read this page${status ? ` (API ${status})` : ''}${detail ? `: ${detail}` : '. For a scanned page, check the ML engine and OCR service.'}`);
        }
      } finally {
        if (!controller.signal.aborted) setIsExtracting(false);
      }
    };

    extractMoves();
    return () => controller.abort();
  }, [getAccessToken, pageNumber, pdfDocument, pdfFile]);

  function onFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setPdfError('Choose a PDF file to start reading.');
      event.target.value = '';
      return;
    }
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

  function onDrop(sourceSquare, targetSquare) {
    const nextGame = new Chess(game.fen());
    try {
      const move = nextGame.move({ from: sourceSquare, to: targetSquare, promotion: 'q' });
      if (!move) return false;
      setGame(nextGame);
      setMoveStatus(`Played ${move.san}.`);
      return true;
    } catch {
      return false;
    }
  }

  function handlePlayMove(sanMove) {
    const nextGame = new Chess(game.fen());
    try {
      const move = nextGame.move(sanMove);
      if (!move) {
        setMoveStatus(`That move is not legal from the current position: ${sanMove}`);
        return;
      }
      setGame(nextGame);
      setMoveStatus(`Played ${move.san}.`);
    } catch {
      setMoveStatus(`Could not read this move: ${sanMove}`);
    }
  }

  function handleReplayMoves() {
    const nextGame = new Chess();
    let played = 0;
    for (const sanMove of pageMoves) {
      try {
        nextGame.move(sanMove);
        played += 1;
      } catch {
        // A book page can contain alternate lines. Stop at the first move that
        // does not continue the current line so the board stays at a legal position.
        break;
      }
    }
    setGame(nextGame);
    setMoveStatus(played ? `Played ${played} consecutive moves from the starting position.` : 'These moves do not form a legal line from the starting position. Choose individual moves instead.');
  }

  function clearPdf() {
    setPdfFile(null);
    setPdfDocument(null);
    setNumPages(0);
    setPageNumber(1);
    setPageMoves([]);
    setPdfError('');
  }

  return (
    <main className="reader-shell">
      <header className="reader-header">
        <Link className="brand" to="/" aria-label="Neuro Chess home">
          <span className="brand-mark">♞</span>
          <span><strong>Neuro Chess</strong><small>Chess book library</small></span>
        </Link>
        <div className="reader-header-actions">
          <span className="eyebrow">Study room</span>
          <Link className="reader-back-link" to="/">← Back to home</Link>
        </div>
      </header>

      <div className="reader-title-row">
        <div><span className="eyebrow">Read. Explore. Play.</span><h1>Interactive book reader</h1>
          <p>Read a chess book and try its moves on the board as you go.</p></div>
        {pdfFile && <button className="reader-secondary-button" type="button" onClick={clearPdf}>Choose another PDF</button>}
      </div>

      <div className="reader-layout">
        <section className="reader-document panel" aria-label="PDF document">
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
              <input type="file" accept="application/pdf,.pdf" onChange={onFileChange} />
            </label>
          ) : (
            <>
              <div className="pdf-toolbar">
                <button className="reader-secondary-button" type="button" onClick={() => setPageNumber((page) => Math.max(1, page - 1))} disabled={pageNumber <= 1}>← Previous</button>
                <span>Page <b>{pageNumber}</b> of <b>{numPages || '…'}</b></span>
                <button className="reader-secondary-button" type="button" onClick={() => setPageNumber((page) => Math.min(numPages, page + 1))} disabled={!numPages || pageNumber >= numPages}>Next →</button>
              </div>
              <div className="pdf-page-stage">
                <Document
                  file={pdfFile}
                  onLoadSuccess={onDocumentLoadSuccess}
                  onLoadError={(error) => setPdfError(`This PDF could not be opened: ${error.message}`)}
                  loading={<div className="reader-placeholder">Opening your PDF…</div>}
                  error={<div className="reader-placeholder">This PDF could not be opened. Try another file.</div>}
                  noData={<div className="reader-placeholder">Choose a PDF to begin reading.</div>}
                >
                  <Page pageNumber={pageNumber} width={pageWidth} renderAnnotationLayer renderTextLayer />
                </Document>
              </div>
            </>
          )}
          {pdfError && <p className="reader-error" role="alert">{pdfError}</p>}
        </section>

        <aside className="reader-side-column">
          <section className="reader-board-card panel">
            <div className="reader-panel-heading"><div><span className="eyebrow">Interactive board</span><h2>Try the position</h2></div><span className="reader-turn">{game.turn() === 'w' ? 'White to move' : 'Black to move'}</span></div>
            <div className="reader-board-frame">
              <Chessboard position={game.fen()} onPieceDrop={onDrop} customDarkSquareStyle={{ backgroundColor: '#54715b' }} customLightSquareStyle={{ backgroundColor: '#e7e1d1' }} />
            </div>
            <p className="reader-status" aria-live="polite">{moveStatus}</p>
            <div className="reader-board-actions"><button className="reader-secondary-button" type="button" onClick={() => { setGame(new Chess()); setMoveStatus('Board reset to the starting position.'); }}>Reset board</button></div>
          </section>

          <section className="reader-moves-card panel">
            <div className="reader-panel-heading"><div><span className="eyebrow">Page analysis</span><h2>Moves on this page</h2></div><span className="reader-page-count">{isExtracting ? 'Reading…' : pageMoves.length}</span></div>
            {pageMoves.length > 0 && <button className="reader-secondary-button reader-replay-button" type="button" onClick={handleReplayMoves}>Play consecutive line from start</button>}
            {!pdfFile ? <p className="reader-empty-state">Open a PDF to find chess moves on each page.</p> : pageMoves.length ? (
              <div className="reader-move-list">{pageMoves.map((move, index) => <button className="reader-move-chip" type="button" key={`${move}-${index}`} onClick={() => handlePlayMove(move)}>{move}</button>)}</div>
            ) : <p className="reader-empty-state">{isExtracting ? 'Checking the page text and scanned image…' : 'No valid move tokens found on this page.'}</p>}
          </section>
        </aside>
      </div>
    </main>
  );
}
