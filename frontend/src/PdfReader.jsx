import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Field } from './ui';
import ReaderMoves from './ReaderMoves';
import './reader.css';
import ResponsiveBoard from './ResponsiveBoard';
import SavedStudies from './SavedStudies';
import { Chess } from 'chess.js';
import { parseChessText, textBlocks, EXTRACTION_VERSION, fontSymbols, parseTextBlocks, suggestPieceMappings, resolveLineAnchor, regionBlocks } from './chessPdf';
import { readSession, writeSession, deleteSession } from './readingSession';
import PieceSymbolPreview from './PieceSymbolPreview';
import { restoreGame, gameSnapshot } from './gameHistory';
import { buildBookTree, nodeAt, continuation, bookMoveLabels, mergeBookTrees, treeNotation } from './bookReplay';
import { useSession } from './sessionContext';
import { friendlyError, waitForPoll } from './api';
import { extractPageImage, getOcrJob } from './apiClient';
const PdfDocumentView = lazy(() => import('./PdfDocumentView'));

export default function PdfReader() {
  const { getAccessToken, state } = useSession();
  const workspace=useRef(null),tools=useRef(null),splitLayout=useRef(null);
  const [mobileTab,setMobileTab]=useState('book');
  const [readerTheme,setReaderTheme]=useState('dark');
  const [split,setSplit]=useState(56);
  const [zoom,setZoom]=useState(1);
  const [isFullscreen,setIsFullscreen]=useState(false);
  const [viewError,setViewError]=useState('');
  const [documentGames,setDocumentGames]=useState([]);
  const [sessionReady, setSessionReady] = useState(/** @type {false|string} */ (false));
  const [sessionStatus,setSessionStatus]=useState('');
  const [selection,setSelection]=useState(null);
  const [selectRegion,setSelectRegion]=useState(false);
  const [ocrMode,setOcrMode]=useState('block');
  const [pageDecision,setPageDecision]=useState(null);
  const [continuationPrefix,setContinuationPrefix]=useState([]);
  const [continuationNotation,setContinuationNotation]=useState('');
  const [highlight,setHighlight]=useState(null);
  const sessionPages=useRef({});
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfDocument, setPdfDocument] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInput, setPageInput] = useState(null);
  const [pageError, setPageError] = useState('');
  const [pageWidth, setPageWidth] = useState(680);
  const documentPanel = useRef(null);
  const [pdfError, setPdfError] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [initialFen, setInitialFen] = useState(new Chess().fen());
  const [fenInput, setFenInput] = useState(new Chess().fen());
  const [timeline, setTimeline] = useState([]);
  const [cursor, setCursor] = useState(0);
  const [bookTree, setBookTree] = useState(null);
  const [bookOrigins,setBookOrigins]=useState([]);
  const [branchChoices, setBranchChoices] = useState([]);
  const replayRegion = useRef(null);
  const branchRegion = useRef(null);
  useEffect(()=>{
    if(branchChoices.length) branchRegion.current?.querySelector('button')?.focus({preventScroll:true});
  },[branchChoices]);
  const game = useMemo(() => restoreGame(initialFen, timeline.slice(0, cursor)), [initialFen, timeline, cursor]);
  const [orientation, setOrientation] = useState(/** @type {'white'|'black'} */ ('white'));
  const [promotion, setPromotion] = useState('q');
  const [moveInput, setMoveInput] = useState('');
  const [lines, setLines] = useState([]);
  const [selectedLine, setSelectedLine] = useState(0);
  const [editor, setEditor] = useState('');
  const [extractionInfo, setExtractionInfo] = useState(null);
  const [pieceMappings, setPieceMappings] = useState({});
  const [mappingDraft, setMappingDraft] = useState({});
  const customSymbols = useMemo(() => fontSymbols(extractionInfo?.blocks || []), [extractionInfo]);
  const [documentHash, setDocumentHash] = useState('');
  const [forceOCR, setForceOCR] = useState(false);
  const [extractionAttempt, setExtractionAttempt] = useState(0);
  const [pageGeometry, setPageGeometry] = useState(null);
  const extractionCache = useRef(new Map());
  const [pageMoves, setPageMoves] = useState([]);
  const moveLabels=useMemo(()=>bookMoveLabels(initialFen,timeline.length?timeline:pageMoves,Boolean(timeline.length)),[initialFen,timeline,pageMoves]);
  const [moveStatus, setMoveStatus] = useState('Choose a move to play it on the board.');

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {if(entry.contentRect.width>36)setPageWidth(Math.floor(entry.contentRect.width - 36));});
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

  const owner=state.sub || state.username || 'session';
  useEffect(()=>{
    if(!documentHash) return;
    let cancelled=false;
    readSession(owner+':'+documentHash).then(saved=>{
      if(cancelled) return;
      if(saved?.version===1 && saved.extractionVersion===EXTRACTION_VERSION) {
        setPageNumber(saved.pageNumber || 1);setPageInput(null);
        setInitialFen(saved.initialFen);setFenInput(saved.initialFen);
        setTimeline(saved.timeline || []);setCursor(saved.cursor || 0);setBookTree(saved.bookTree || null);
        setBookOrigins(saved.bookOrigins || []);
        setHighlight(nodeAt(saved.bookTree,saved.timeline?.slice(0,saved.cursor || 0) || [])?.sources?.find(source=>source.page===saved.pageNumber) || null);
        setPieceMappings(saved.pieceMappings || {});setMappingDraft(saved.pieceMappings || {});
        setOrientation(saved.orientation || 'white');setDocumentGames(saved.documentGames || []);
        sessionPages.current=saved.pages || {};
        setContinuationPrefix(saved.continuationPrefix || []);
        setContinuationNotation(saved.continuationNotation || '');
        setSessionStatus('Restored your local reading session.');
      } else setSessionStatus('Reading progress is saved locally on this device.');
    }).catch(()=>{if(!cancelled)setSessionStatus('Local storage unavailable; keep this tab open to retain progress.');})
      .finally(()=>{if(!cancelled)setSessionReady(owner+':'+documentHash);});
    return ()=>{cancelled=true;};
  },[documentHash,owner]);
  useEffect(()=>{
    if(sessionReady!==owner+':'+documentHash || !documentHash) return;
    if(extractionInfo?.page===pageNumber && extractionInfo.mappingSignature===JSON.stringify(pieceMappings) && !isExtracting) {
      sessionPages.current[pageNumber]={lines,selectedLine,editor,extractionInfo,selection,pieceMappings,continuationPrefix,continuationNotation};
      const pages=Object.keys(sessionPages.current);
      while(pages.length>40) {const oldest=pages.shift();if(Number(oldest)!==pageNumber)delete sessionPages.current[oldest];}
    }
    const timer=setTimeout(()=>{
      writeSession(owner+':'+documentHash,{pageNumber,initialFen,timeline,cursor,bookTree,bookOrigins,pieceMappings,orientation,
        continuationPrefix,continuationNotation,documentGames,pages:sessionPages.current,extractionVersion:EXTRACTION_VERSION}).catch(()=>setSessionStatus('Could not save locally. Keep this tab open to retain progress.'));
    },400);
    return ()=>clearTimeout(timer);
  },[sessionReady,documentHash,owner,pageNumber,initialFen,timeline,cursor,bookTree,bookOrigins,pieceMappings,orientation,lines,selectedLine,editor,extractionInfo,isExtracting,selection,continuationPrefix,continuationNotation,documentGames]);

  useEffect(() => {
    if (!pdfDocument) return;
    let cancelled = false;
    pdfDocument.getPage(pageNumber).then((page) => {
      const viewport = page.getViewport({ scale: 1 });
      const height = pageWidth * zoom * viewport.height / viewport.width;
      const safe = Number.isFinite(height) && height > 0 && height <= 8192 &&
        Math.max(viewport.width, viewport.height) <= 14400 && pageWidth * zoom * height * 4 <= 16000000;
      if (!cancelled) setPageGeometry({ document: pdfDocument, page: pageNumber, width: pageWidth * zoom, safe });
    }).catch(() => { if (!cancelled) setPdfError('Could not read page dimensions.'); });
    return () => { cancelled = true; };
  }, [pdfDocument, pageNumber, pageWidth, zoom]);

  useEffect(() => {
    if (!pdfFile || !pdfDocument || !documentHash || sessionReady!==owner+':'+documentHash || pageDecision) return;
    const controller = new AbortController();
    let renderTask;
    let canvas;
    const extractMoves = async () => {
      setIsExtracting(true); setPageMoves([]); setLines([]); setEditor(''); setExtractionInfo(null);
      setMoveStatus(`Reading page ${pageNumber}...`);
      try {
        const saved=sessionPages.current[pageNumber];
        if(saved && !forceOCR && !extractionAttempt && !selection && saved.extractionInfo.startingFen===initialFen && saved.extractionInfo.mappingSignature===JSON.stringify(pieceMappings)) {
          setLines(saved.lines);setSelectedLine(saved.selectedLine);setEditor(saved.editor);
          setPageMoves(saved.lines[saved.selectedLine]?.moves || []);setExtractionInfo(saved.extractionInfo);
          setMoveStatus('Restored reviewed moves for this page.');return;
        }
        const key = `${documentHash}:${pageNumber}:${EXTRACTION_VERSION}:${forceOCR ? 'ocr' : 'text'}:${JSON.stringify(selection)}:${ocrMode}`;
        let extracted = extractionCache.current.get(key);
        const cached = Boolean(extracted);
        if (!extracted) {
          const page = await pdfDocument.getPage(pageNumber);
          const content = await page.getTextContent();
          const viewport = page.getViewport({ scale: 1 });
          const blocks = regionBlocks(textBlocks(content.items, viewport.width, pageNumber),selection);
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
            if(selection) {
              const points=[[selection.x,selection.y],[selection.x+selection.width,selection.y+selection.height]].map(([x,y])=>{
                const [a,b,c,d,e,f]=imageViewport.transform;return [a*x+c*y+e,b*x+d*y+f];
              });
              const left=Math.min(...points.map(point=>point[0])),top=Math.min(...points.map(point=>point[1]));
              canvas.width=Math.ceil(Math.abs(points[1][0]-points[0][0]));canvas.height=Math.ceil(Math.abs(points[1][1]-points[0][1]));
              renderTask=page.render({canvas,viewport:imageViewport,transform:[1,0,0,1,-left,-top]});
            } else renderTask = page.render({ canvas, viewport: imageViewport });
            await renderTask.promise;
            if (controller.signal.aborted) return;
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
            canvas.width = 0; canvas.height = 0;
            if (!blob || blob.size > 8 * 1024 * 1024) throw new Error('Page image exceeds the 8 MB OCR upload limit.');
            const formData = new FormData(); formData.append('file', blob, 'page.png'); formData.append('page', String(pageNumber));formData.append('mode',selection?ocrMode:'page');
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
            extracted = { blocks: items.length ? textBlocks(items, imageViewport.width, null) : [{ column: 1, text: job.result.text || '' }],
              source: 'Page image OCR', ocrConfidence: job.result.ocr_confidence };
          }
          if (controller.signal.aborted) return;
          extractionCache.current.set(key, extracted);
          while (extractionCache.current.size > 40) extractionCache.current.delete(extractionCache.current.keys().next().value);
        }
        if (controller.signal.aborted) return;
        const prefixBoard=restoreGame(initialFen,continuationPrefix);
        const prefix=continuationNotation || prefixBoard.pgn().replace(/\[[^\]]*\]/g,'').trim();
        const found = parseTextBlocks(extracted.blocks, initialFen, pieceMappings, prefix);
        setLines(found); setSelectedLine(0); setPageMoves(found[0]?.moves || []);
        setEditor(found[0]?.raw || extracted.blocks.map((block) => block.text).join('\n'));
        const suggestions=suggestPieceMappings(found[0]?.raw || '',initialFen);
        const symbols=fontSymbols(extracted.blocks),draft={...pieceMappings};
        for(const symbol of symbols) if(symbols.filter(item=>item.glyph===symbol.glyph).length===1 && suggestions[symbol.glyph] && !(symbol.key in draft)) draft[symbol.key]=suggestions[symbol.glyph];
        setMappingDraft(draft);
        setExtractionInfo({ ...extracted, page:pageNumber, startingFen:initialFen, mappingSignature:JSON.stringify(pieceMappings), cached, confidence: found[0]?.confidence || 'low', issue: found[0]?.issue || '' });
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
  }, [getAccessToken, pageNumber, pdfDocument, pdfFile, documentHash, initialFen, forceOCR, extractionAttempt, pieceMappings, sessionReady, owner, pageDecision, selection, ocrMode, continuationPrefix,continuationNotation]);

  function onFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setPdfError('Choose a PDF file to start reading.');
      event.target.value = '';
      return;
    }
    if (file.size > 200 * 1024 * 1024) { setPdfError('Choose a PDF smaller than 200 MB.'); return; }
    setSessionReady(false);sessionPages.current={};setDocumentGames([]);setInitialFen(new Chess().fen());setFenInput(new Chess().fen());setSelection(null);setHighlight(null);setPageDecision(null);setContinuationPrefix([]);setContinuationNotation('');setExtractionAttempt(0);setDocumentHash(''); setForceOCR(false); setLines([]); setEditor(''); setExtractionInfo(null);
    setPdfError('');
    setPdfDocument(null);
    setPageMoves([]);
    setPageNumber(1);
    setNumPages(0);
    setPdfFile(file);
    setPageInput('1');setPageError('');
    setPieceMappings({}); setMappingDraft({});
    setTimeline([]);setCursor(0);setBookTree(null);setBookOrigins([]);setBranchChoices([]);
  }

  const onDocumentLoadSuccess = useCallback((document) => {
    const { numPages: loadedPages } = document;
    setPdfDocument(document);
    setNumPages(loadedPages);
    setPageNumber((current)=>Math.min(Math.max(1,current),loadedPages));
    setPdfError('');
  }, []);
  function jumpToPage(event) {
    event.preventDefault();
    const input=String(pageInput ?? pageNumber), target=Number(input);
    if(!input.trim() || !Number.isInteger(target) || target<1 || target>numPages){setPageError(`Enter a page number from 1 to ${numPages}.`);return;}
    navigatePage(target);
  }
  function navigatePage(target, fromMove=false) {
    if(target===pageNumber) return;
    setContinuationPrefix(sessionPages.current[target]?.continuationPrefix || []);
    setContinuationNotation(sessionPages.current[target]?.continuationNotation || '');
    setExtractionInfo(null);setLines([]);setPageMoves([]);setEditor('');setPageInput(null);setPageError('');setForceOCR(false);setExtractionAttempt(0);setSelection(null);setHighlight(null);
    if(!fromMove && target!==pageNumber && timeline.length && !sessionPages.current[target]) {
      const reviewed=timeline;
      const tree=bookTree || (lines[selectedLine]?buildBookTree(lines,lines[selectedLine],initialFen):null);
      setPageDecision({from:pageNumber,to:target,moves:reviewed,tree});
    }
    setPageNumber(target);
  }

  function archiveGame() {
    const moves=pageDecision?.moves || timeline;
    if(moves.length) setDocumentGames(games=>[...games,{initialFen,moves,tree:pageDecision?.tree || bookTree,origins:bookOrigins,page:pageDecision?.from || pageNumber}]);
  }
  function commitMove(move) {
    const nextGame = restoreGame(initialFen, timeline.slice(0, cursor));
    try {
      const played = nextGame.move(move);
      const snapshot = gameSnapshot(nextGame);
      setTimeline(snapshot.moves); setCursor(snapshot.moves.length); setBookTree(null);setBookOrigins([]); setBranchChoices([]);
      setMoveStatus(`Played ${played.san}.`); return true;
    } catch { setMoveStatus('This move is illegal from the current position.'); return false; }
  }

  function onDrop(from, to) { return commitMove({ from, to, promotion }); }
  function seekMove(target, tree=bookTree, path=timeline, start=cursor) {
    const bounded=Math.max(0,Math.min(path.length,target));
    setBranchChoices([]);
    for(let ply=start;ply<bounded;ply++) {
      const choices=nodeAt(tree,path.slice(0,ply))?.children || [];
      if(choices.length>1) {
        setMobileTab('board');setCursor(ply); setBranchChoices(choices);
        setMoveStatus('This position has multiple continuations. Choose which variation to study.');
        return;
      }
    }
    setCursor(bounded);
    const sources=nodeAt(tree,path.slice(0,bounded))?.sources || [];
    const source=sources.find(item=>item.page===pageNumber) || sources.find(item=>item.page);
    if(source?.page && source.page!==pageNumber)navigatePage(source.page,true);
    setHighlight(source || null);
  }
  function chooseBranch(node) {
    setTimeline([...timeline.slice(0,cursor),...continuation(node)]);
    setCursor(cursor+1); setBranchChoices([]); setMoveStatus(`Following ${node.san}.`);
    replayRegion.current?.focus({preventScroll:true});
  }
  function handleReplayMoves(target=0) {
    const nextGame = new Chess(initialFen);
    for (const san of pageMoves) nextGame.move(san);
    const snapshot = gameSnapshot(nextGame);
    if(!lines[selectedLine]) return;
    const origin=`${pageNumber}:${lines[selectedLine].rootId}`;
    const belongs=bookOrigins.includes(origin) || (continuationPrefix.length>0 && lines[selectedLine].rootId===lines[0].rootId);
    if(bookTree && !belongs)archiveGame();
    const tree=mergeBookTrees(bookTree && belongs?structuredClone(bookTree):null,buildBookTree(lines,lines[selectedLine],initialFen));
    setBookOrigins(belongs?[...new Set([...bookOrigins,origin])]:[origin]);
    setBookTree(tree); setTimeline(snapshot.moves); setCursor(0); setBranchChoices([]);
    setMoveStatus(`Loaded ${snapshot.moves.length} plies. Use Left/Right arrow keys or the replay controls.`);
    if(target) seekMove(target,tree,snapshot.moves,0);
  }
  useEffect(()=>{
    function keyboard(event) {
      if(event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return;
      const target=event.target;
      if(target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="tablist"]')) return;
      if(event.key==='ArrowLeft') { event.preventDefault(); seekMove(cursor-1); }
      if(event.key==='ArrowRight' && !branchChoices.length) { event.preventDefault(); seekMove(cursor+1); }
    }
    window.addEventListener('keydown',keyboard);
    return ()=>window.removeEventListener('keydown',keyboard);
  });
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
    } catch (error) { setMoveStatus(error instanceof Error ? error.message : 'Invalid move text'); }
  }
  function applyFen(fen) {
    try { const board = new Chess(fen); if(board.fen()!==initialFen){setPageMoves([]);setLines([]);} setContinuationPrefix([]);setContinuationNotation(''); setInitialFen(board.fen()); setFenInput(board.fen()); setTimeline([]); setCursor(0); setBookTree(null);setBookOrigins([]); setBranchChoices([]); setMoveStatus('Starting position updated.'); }
    catch { setMoveStatus('Invalid FEN. Check the position and side to move.'); }
  }
  function exportPgn() {
    const url = URL.createObjectURL(new Blob([game.pgn()], { type: 'application/x-chess-pgn' }));
    const link = document.createElement('a'); link.href = url; link.download = 'book-study.pgn'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function clearPdf() {
    setMobileTab('book');
    setPdfFile(null); setDocumentHash(''); setLines([]); setEditor(''); setExtractionInfo(null); setForceOCR(false); setIsExtracting(false);
    setPdfDocument(null);
    setNumPages(0);
    setPageNumber(1);
    setPageMoves([]);
    setPdfError('');
    setBookTree(null);setBookOrigins([]);setBranchChoices([]);
  }

  function openTools() {tools.current?.showModal();}
  function changeSplit(clientX) {
    const bounds=splitLayout.current.getBoundingClientRect();
    setSplit(Math.max(38,Math.min(65,Math.round(100*(clientX-bounds.left)/bounds.width))));
  }
  async function toggleFullscreen() {
    try {
      if(document.fullscreenElement)await document.exitFullscreen();
      else await workspace.current.requestFullscreen();
      setViewError('');
    } catch {setViewError('Fullscreen is unavailable in this browser.');}
  }
  useEffect(()=>{
    const update=()=>setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange',update);return()=>document.removeEventListener('fullscreenchange',update);
  },[]);
  async function forgetSession() {
    setSessionReady(false);
    try {await deleteSession(owner+':'+documentHash);clearPdf();setSessionStatus('Local reading progress removed.');}
    catch {setSessionReady(owner+':'+documentHash);setSessionStatus('Could not remove local progress.');}
  }
  return (
    <main ref={workspace} className="reader-shell" data-reader-theme={readerTheme} style={/** @type {import('react').CSSProperties & {'--reader-split':string}} */ ({'--reader-split':split+'%'})}>

      <div className="reader-title-row">
        <div><span className="eyebrow">Read. Explore. Play.</span><h1>Interactive book reader</h1>
          <p>Read a chess book and try its moves on the board as you go.</p></div>
        {pdfFile && <div className="reader-board-actions"><button className="reader-secondary-button" type="button" onClick={clearPdf}>Choose another PDF</button>
          <button className="reader-secondary-button" type="button" disabled={!documentHash} onClick={forgetSession}>Forget local reading progress</button></div>}
      </div>

      <div className="reader-view-controls">
        <Field label="Reading theme"><select value={readerTheme} onChange={event=>setReaderTheme(event.target.value)}><option value="dark">Black and gold</option><option value="paper">Warm paper</option></select></Field>
        <Button onClick={openTools}>Extraction tools</Button>
        <Button onClick={toggleFullscreen}>{isFullscreen?'Exit fullscreen':'Fullscreen reader'}</Button>
      </div>
      {viewError && <p role="alert">{viewError}</p>}
      <div className="reader-mobile-tabs" role="tablist" aria-label="Reader workspace" onKeyDown={event=>{
        const tabs=['book','board','notes'],index=tabs.indexOf(mobileTab);let next;
        if(event.key==='ArrowRight')next=(index+1)%3;else if(event.key==='ArrowLeft')next=(index+2)%3;else if(event.key==='Home')next=0;else if(event.key==='End')next=2;else return;
        event.preventDefault();setMobileTab(tabs[next]);event.currentTarget.querySelectorAll('button')[next].focus();
      }}>{['book','board','notes'].map(tab=><Button key={tab} role="tab" id={`reader-tab-${tab}`} aria-controls={`reader-pane-${tab}`} aria-selected={mobileTab===tab} tabIndex={mobileTab===tab?0:-1} onClick={()=>setMobileTab(tab)}>{tab[0].toUpperCase()+tab.slice(1)}</Button>)}</div>
      <div className="reader-layout" ref={splitLayout}>
        <section ref={documentPanel} id="reader-pane-book" className={`reader-document panel reader-pane ${mobileTab==='book'?'is-active':''}`} aria-label="PDF document">
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
                <button className="reader-secondary-button" type="button" onClick={() => navigatePage(Math.max(1, pageNumber - 1))} disabled={pageNumber <= 1}>← Previous</button>
                <span>Page <b>{pageNumber}</b> of <b>{numPages || '…'}</b></span>
                <form className="reader-page-jump" onSubmit={jumpToPage} noValidate>
                  <label htmlFor="reader-page-number">Go to page</label>
                  <input id="reader-page-number" type="number" inputMode="numeric" min="1" max={numPages || 1} step="1" value={pageInput ?? String(pageNumber)} onChange={(event)=>setPageInput(event.target.value)} aria-invalid={Boolean(pageError)} aria-describedby={pageError?'reader-page-error':undefined} />
                  <button className="reader-secondary-button" type="submit" disabled={!numPages}>Go</button>
                </form>
                <button className="reader-secondary-button" type="button" onClick={() => navigatePage(Math.min(numPages, pageNumber + 1))} disabled={!numPages || pageNumber >= numPages}>Next →</button>
              </div>
              <div className="reader-board-actions">
                <button className="reader-secondary-button" type="button" aria-pressed={selectRegion} onClick={()=>setSelectRegion(!selectRegion)}>Select a move line</button>
                <button className="reader-secondary-button" type="button" disabled={!selection} onClick={()=>{setSelection(null);setForceOCR(false);}}>Read whole page</button>
                {selectRegion && <p>Drag a rectangle around notation. Turn this off to select PDF text and use “Read selected PDF text” below.</p>}
              </div>
              {pageDecision && <fieldset><legend>What does this page contain?</legend><p>Continue the previous game, or start a separate game or diagram position.</p>
                <button type="button" className="reader-secondary-button" onClick={()=>{setBookTree(pageDecision.tree);setTimeline(pageDecision.moves);setContinuationPrefix(pageDecision.moves);setContinuationNotation(treeNotation(pageDecision.tree,pageDecision.moves));setPageDecision(null);}}>Continue previous game</button>
                <button type="button" className="reader-secondary-button" onClick={()=>{archiveGame();setInitialFen(new Chess().fen());setFenInput(new Chess().fen());setContinuationPrefix([]);setContinuationNotation('');setTimeline([]);setCursor(0);setBookTree(null);setBookOrigins([]);setPageDecision(null);}}>Start a new game</button>
                <button type="button" className="reader-secondary-button" onClick={()=>{archiveGame();setContinuationPrefix([]);setContinuationNotation('');setTimeline([]);setCursor(0);setBookTree(null);setBookOrigins([]);setPageDecision(null);openTools();document.getElementById('reader-start-fen')?.focus();}}>Use a diagram FEN</button>
              </fieldset>}
              <p role="status">{sessionStatus}</p>
              <div className="reader-board-actions" aria-label="PDF zoom"><Button aria-label="Zoom out" onClick={()=>setZoom(value=>Math.max(.5,value-.25))} disabled={zoom<=.5}>-</Button><span>{Math.round(zoom*100)}%</span><Button aria-label="Zoom in" onClick={()=>setZoom(value=>Math.min(2,value+.25))} disabled={zoom>=2}>+</Button><Button onClick={()=>setZoom(1)}>Fit width</Button></div>
              <div className="pdf-page-stage">
                {pageError && <p id="reader-page-error" className="reader-error" role="alert">{pageError}</p>}
                <Suspense fallback={<div className="reader-placeholder">Loading PDF viewer...</div>}>
                  <PdfDocumentView file={pdfFile} onLoadSuccess={onDocumentLoadSuccess}
                    onLoadError={(error) => setPdfError(`This PDF could not be opened: ${error.message}`)}
                    pageNumber={pageNumber} width={pageWidth*zoom} selection={selection} selecting={selectRegion} onSelect={(region)=>{setSelection(region);setSelectRegion(false);setForceOCR(false);setExtractionAttempt(attempt=>attempt+1);}} highlight={highlight}
                    geometryReady={pageGeometry?.document === pdfDocument && pageGeometry.page === pageNumber && pageGeometry.width === pageWidth*zoom}
                    safe={pageGeometry?.safe} />
                </Suspense>
              </div>
            </>
          )}
          {pdfError && <p className="reader-error" role="alert">{pdfError}</p>}
        </section>

        <div className="reader-splitter" role="separator" aria-label="Resize PDF and board" aria-orientation="vertical" aria-valuemin={38} aria-valuemax={65} aria-valuenow={split} tabIndex={0}
          onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);changeSplit(event.clientX);}}
          onPointerMove={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))changeSplit(event.clientX);}}
          onKeyDown={event=>{if(event.key==='ArrowLeft' || event.key==='ArrowRight'){event.preventDefault();setSplit(value=>Math.max(38,Math.min(65,value+(event.key==='ArrowRight'?2:-2))));}}} />
        <aside id="reader-pane-board" className={`reader-side-column reader-pane ${mobileTab==='board'?'is-active':''}`}>
          <section className="reader-board-card panel">
            <div className="reader-panel-heading"><div><span className="eyebrow">Interactive board</span><h2>Try the position</h2></div><span className="reader-turn">{game.turn() === 'w' ? 'White to move' : 'Black to move'}</span></div>
            {documentGames.length>0 && <label className="reader-field">Earlier document games<select defaultValue="" onChange={event=>{
              const saved=documentGames[Number(event.target.value)];if(!saved)return;
              archiveGame();setInitialFen(saved.initialFen);setFenInput(saved.initialFen);setTimeline(saved.moves);setCursor(0);setBookTree(saved.tree);setBookOrigins(saved.origins || []);setContinuationPrefix(saved.moves);setContinuationNotation(treeNotation(saved.tree,saved.moves));setPageDecision(null);
            }}><option value="" disabled>Choose a saved game</option>{documentGames.map((saved,index)=><option key={index} value={index}>Game {index+1} · page {saved.page} · {saved.moves.length} plies</option>)}</select></label>}
            <div className="reader-board-frame">
              <ResponsiveBoard position={game.fen()} boardOrientation={orientation} onPieceDrop={onDrop} customDarkSquareStyle={{ backgroundColor: '#786347' }} customLightSquareStyle={{ backgroundColor: '#eee5d3' }} />
            </div>
            <section className="reader-replay" ref={replayRegion} tabIndex={0} aria-label="Book move replay">
              <div className="reader-panel-heading"><h3>Book moves</h3><span>{cursor} / {timeline.length} plies</span></div>
              <p className="reader-empty-state">Use ← / → to step backward or forward. Editable fields keep their normal arrow-key behavior.</p>
              {pageMoves.length>0 && <button className="reader-primary-button" type="button" onClick={()=>handleReplayMoves()}>{extractionInfo?.issue?'Load validated prefix':'Load reviewed line'}</button>}
              <div className="reader-board-actions">
                <button className="reader-secondary-button" type="button" onClick={()=>seekMove(cursor-1)} disabled={!cursor}>Previous move</button>
                <button className="reader-secondary-button" type="button" onClick={()=>seekMove(cursor+1)} disabled={cursor>=timeline.length || Boolean(branchChoices.length)}>Next move</button>
              </div>
              <ReaderMoves labels={moveLabels} cursor={cursor} loaded={Boolean(timeline.length)} tree={bookTree} path={timeline} onMove={target=>timeline.length?seekMove(target):handleReplayMoves(target)} onVariation={(ply,node)=>{setTimeline([...timeline.slice(0,ply),...continuation(node)]);setCursor(ply+1);setBranchChoices([]);}} />
              {nodeAt(bookTree,timeline.slice(0,cursor))?.comments?.map((comment,index)=><p className="reader-book-comment" key={index}>{comment}</p>)}
              {!timeline.length && !pageMoves.length && <p className="reader-empty-state">Extract or enter a line to start studying.</p>}
              {branchChoices.length>0 && <section ref={branchRegion} className="reader-branch-choice" role="dialog" aria-modal="false" aria-label="Choose a variation" onKeyDown={(event)=>{if(event.key==='Escape'){event.preventDefault();setBranchChoices([]);replayRegion.current?.focus({preventScroll:true});}}}>
                <h4>Which continuation would you like to study?</h4><p>Choose a move from this position to continue.</p>
                <div className="reader-board-actions">{branchChoices.map(node=><button key={node.uci} type="button" className="reader-secondary-button" onClick={()=>chooseBranch(node)}>{node.san} · {node.mainLine?'Main line':'Variation'}</button>)}
                  <button type="button" className="text-button" onClick={()=>{setBranchChoices([]);replayRegion.current?.focus({preventScroll:true});}}>Cancel choice</button></div>
              </section>}
            </section>
            <p className="reader-status" aria-live="polite">{moveStatus}</p>
            <details className="reader-more-controls"><summary>More board controls</summary>
            <form className="keyboard-move-form" onSubmit={(event) => {
              event.preventDefault(); const text = moveInput.trim();
              const move = /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(text) ? { from: text.slice(0,2), to: text.slice(2,4), promotion: text[4] || promotion } : text;
              if (commitMove(move)) setMoveInput('');
            }}><label htmlFor="reader-keyboard-move">Play a move (SAN or UCI)</label>
              <input id="reader-keyboard-move" value={moveInput} onChange={(event) => setMoveInput(event.target.value)} autoComplete="off" placeholder="e4 or e2e4" />
              <button className="reader-secondary-button" type="submit">Play move</button>
            </form>

            <div className="reader-board-actions">
              <button className="reader-secondary-button" onClick={() => { setTimeline(timeline.slice(0, cursor - 1)); setCursor(cursor - 1); setBookTree(null);setBookOrigins([]);setBranchChoices([]); }} disabled={!cursor}>Undo move</button>
              <button className="reader-secondary-button" onClick={() => setOrientation(orientation === 'white' ? 'black' : 'white')}>Flip board</button>
              <button className="reader-secondary-button" onClick={() => { setTimeline([]); setCursor(0);setBookTree(null);setBookOrigins([]);setBranchChoices([]); }}>Reset board</button>
              <button className="reader-secondary-button" onClick={exportPgn}>Export current PGN</button>
            </div>
            <label className="reader-field">Promote pawn to<select value={promotion} onChange={(event) => setPromotion(event.target.value)}>
              <option value="q">Queen</option><option value="r">Rook</option><option value="b">Bishop</option><option value="n">Knight</option>
            </select></label>
            </details>
          </section>

        </aside>
        <section id="reader-pane-notes" className={`reader-notes reader-pane ${mobileTab==='notes'?'is-active':''}`} aria-label="Reader notes">
          <section className="reader-moves-card">
            <div className="reader-panel-heading"><div><span className="eyebrow">Page analysis</span><h2>Moves on this page</h2></div><span className="reader-page-count">{isExtracting ? 'Reading…' : pageMoves.length}</span></div>
            <p className="reader-empty-state">Text extraction stays in your browser. OCR sends only the selected page image.</p>
            {lines.length > 0 && <label className="reader-field">Choose main line or variation<select value={selectedLine} onChange={(event) => selectLine(Number(event.target.value))}>
              {lines.map((line, index) => <option key={index} value={index}>Column {line.column} · {line.variation ? 'Variation' : 'Main line'} {index + 1} · {line.moves.length}/{line.candidates} validated plies</option>)}
            </select></label>}
            {extractionInfo?.issue && <p className="reader-error" role="alert">{extractionInfo.issue}</p>}
            {lines[selectedLine]?.anchorOptions && <fieldset><legend>Choose where this continuation starts</legend>
              <p>More than one earlier line can legally lead to this passage. Compare the printed game before choosing.</p>
              {lines[selectedLine].anchorOptions.map((option,index)=><button type="button" className="reader-secondary-button" key={index} onClick={()=>{
                const resolved=resolveLineAnchor(lines[selectedLine],option,initialFen);
                setLines(lines.map((line,i)=>i===selectedLine?resolved:line));setPageMoves(resolved.moves);setEditor(resolved.raw);
                setExtractionInfo(info=>({...info,issue:resolved.issue,confidence:resolved.confidence}));
              }}>{option.label}</button>)}
            </fieldset>}
            {pdfFile && <><label className="reader-field">Review and correct moves<textarea rows={5} value={editor} onChange={(event) => setEditor(event.target.value)} maxLength={50000} /></label>
              <div className="reader-board-actions"><button className="reader-secondary-button" onClick={correctLine} disabled={isExtracting}>Validate corrections</button>
</div></>}
            {pdfFile && <Button className="reader-open-board" variant="primary" onClick={()=>{setMobileTab('board');replayRegion.current?.focus({preventScroll:true});}}>Review on board</Button>}
            {!pdfFile ? <p className="reader-empty-state">Open a PDF to find chess moves on each page.</p> : pageMoves.length ? (
              <p className="reader-empty-state">The reviewed moves and replay controls are directly beneath the board.</p>
            ) : <p className="reader-empty-state">{isExtracting ? 'Checking the page text and scanned image…' : 'No valid move tokens found on this page.'}</p>}
          </section>
          <SavedStudies owner={state.sub || state.username || 'session'} disabled={isExtracting}
            snapshot={{fen:game.fen(),initial_fen:initialFen,moves:timeline.slice(0,cursor),opponent_name:'',context:'',color:'any'}}
            onLoad={(study)=>{if(study.initial_fen!==initialFen){setPageMoves([]);setLines([]);}setInitialFen(study.initial_fen);setFenInput(study.initial_fen);setTimeline(study.moves);setCursor(study.moves.length);setBookTree(null);setBookOrigins([]);setBranchChoices([]);setMoveInput('');setMoveStatus('Saved study opened.');}} />
        </section>
      </div>
      <dialog className="reader-tools" ref={tools} aria-labelledby="reader-tools-title" role="dialog">
        <div className="reader-tools-heading"><h2 id="reader-tools-title">Extraction tools</h2><Button onClick={()=>tools.current.close()}>Close tools</Button></div>
                    <label className="reader-field">Starting position FEN<textarea id="reader-start-fen" value={fenInput} maxLength={120} onChange={(event) => setFenInput(event.target.value)} /></label>
            <div className="reader-board-actions"><button className="reader-secondary-button" onClick={() => applyFen(fenInput)}>Apply FEN</button>
              <button className="reader-secondary-button" onClick={() => applyFen(game.fen())}>Use current board as start</button>
              <button className="reader-secondary-button" onClick={() => applyFen(new Chess().fen())}>Standard start</button></div>

                    {extractionInfo && <p className="reader-status">{extractionInfo.source}{extractionInfo.cached ? ' · cached' : ''} · Line validation: {extractionInfo.confidence}.
              {extractionInfo.ocrConfidence != null && ` OCR word confidence: ${Math.round(extractionInfo.ocrConfidence)}%.`}
              {' '}A ply is one move by White or Black. Legality does not prove the whole printed line was extracted.</p>}

                    {customSymbols.length > 0 && <fieldset className="reader-symbol-mapping">
              <legend>Recognize this book’s piece symbols</legend>
              <p>Custom PDF fonts can turn a piece into an unrelated character. Compare each symbol with the printed page and confirm its piece. A suggestion appears only when every legal interpretation of the complete line agrees on that symbol.</p>
              {customSymbols.map((symbol)=><label className="reader-field" key={symbol.key}>Extracted symbol “{symbol.glyph}” (U+{symbol.glyph.codePointAt(0).toString(16).toUpperCase()}) · Font {symbol.fontName}
                {extractionInfo.source==='PDF text' && pdfDocument && <PieceSymbolPreview document={pdfDocument} pageNumber={pageNumber} symbol={symbol} />}
                <select value={mappingDraft[symbol.key] || ''} onChange={(event)=>setMappingDraft((draft)=>({...draft,[symbol.key]:event.target.value}))}>
                  <option value="">Choose the printed piece</option>
                  <option value="N">♘ Knight (N)</option><option value="B">♗ Bishop (B)</option><option value="R">♖ Rook (R)</option><option value="Q">♕ Queen (Q)</option><option value="K">♔ King (K)</option>
                </select></label>)}
              <button type="button" className="reader-secondary-button" disabled={isExtracting} onClick={()=>{setTimeline([]);setCursor(0);setBookTree(null);setBookOrigins([]);setBranchChoices([]);setPieceMappings({...mappingDraft});}}>Apply piece symbols to this book</button>
              <p>Confirmed mappings are saved locally for this document and apply to every page. If a piece is missing from extracted text entirely, use page OCR or correct the moves.</p>
            </fieldset>}
            {extractionInfo && <details><summary>Raw extracted page text</summary>
              <label className="reader-field">Extracted text before move parsing<textarea readOnly rows={6} value={extractionInfo.blocks.map((block)=>block.text).join('\n\n')} /></label>
            </details>}

        <div className="reader-board-actions">                <button className="reader-secondary-button" onClick={() => { setForceOCR(true); setExtractionAttempt((attempt) => attempt + 1); }} disabled={isExtracting}>{selection ? 'OCR selected region' : 'Try page OCR'}</button>
                {selection && <label className="reader-field">Selected OCR layout<select value={ocrMode} onChange={event=>setOcrMode(event.target.value)}><option value="block">Paragraph / move block</option><option value="line">Single move line</option></select></label>}</div>
      </dialog>
    </main>
  );
}
