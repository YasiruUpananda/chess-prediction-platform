import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelector, useDispatch, useStore } from 'react-redux';
import {
  setFen,
  setGameSnapshot,
  setOpponentName,
  setLoading,
  clearStrategy,
  setStrategyAnalysis,
  applyMovePrediction,
  setError,
} from './store/chessSlice';
import ResponsiveBoard from './ResponsiveBoard';
import { Chess } from 'chess.js';
import { useSession } from './sessionContext';
import { requestJson, authenticatedRequest, friendlyError } from './api';
import { useGetPlayersQuery } from './store/chessApi';
import { createRequestGate } from './requestGate';
import { readReportStream } from './reportStream';
import { restoreGame, gameSnapshot, formatEvaluation } from './gameHistory';
import './App.css'; 

const EMPTY_PLAYERS = [];
const reportSections = [
  { id: 'profile', label: 'Player profile', kicker: 'Opponent snapshot' },
  { id: 'tendencies', label: 'Behavioral tendencies', kicker: 'Observed patterns' },
  { id: 'weaknesses', label: 'Potential weaknesses', kicker: 'Tentative inferences' },
  { id: 'recommendations', label: 'Recommendations', kicker: 'Preparation ideas' },
];

function Statistics({ statistics }) {
  return <details className="report-statistics" open><summary>Verified game statistics</summary>
    <ul>{statistics.map((stat) => <li key={stat.id} id={`stat-${stat.id}`}>
      {stat.type === 'sample' ? `${stat.games} indexed games in this sample` :
        stat.type === 'result' ? `${stat.color}: result ${stat.result} in ${stat.games} games` :
        stat.type === 'opening' ? `${stat.line}: ${stat.games} games` :
        `Recurring position: ${stat.games} games (${stat.position_key})`}
      <details><summary>Source game references</summary>{stat.game_ids?.map((id) => <code key={id}>{id}<br /></code>)}</details>
    </li>)}</ul>
  </details>;
}

function ReportContent({ content, sources }) {
  return <div className="report-content">{content.length ? content.map((claim, index) => <article key={index}>
    <p>{claim.text}</p><small>{claim.confidence === 'tentative' ? 'Tentative inference' : 'Evidence supported'}</small>
    <p>{claim.source_game_ids.map((id) => <a key={id} href={`#game-${id}`}>Game {sources.findIndex((source) => source.id === id) + 1} </a>)}
      {claim.statistic_ids.map((id) => <a key={id} href={`#stat-${id}`}>Statistic {id} </a>)}</p>
  </article>) : <p>Insufficient evidence for claims in this section.</p>}</div>;
}

export default function App() {
  const dispatch = useDispatch();
  const store = useStore();
  const moveGate = useMemo(() => createRequestGate(), []);
  const strategyGate = useMemo(() => createRequestGate(), []);
  const [movePending, setMovePending] = useState(false);
  const [moveError, setMoveError] = useState('');
  const [reportProgress, setReportProgress] = useState('');
  const [earlyStatistics, setEarlyStatistics] = useState([]);
  const [reportColor, setReportColor] = useState('any');
  useEffect(() => () => {
    moveGate.cancel();
    strategyGate.cancel();
    dispatch(clearStrategy());
  }, [moveGate, strategyGate, dispatch]);
  const { state, signIn, signOut, getAccessToken } = useSession();

  // --- Read Global State from Redux ---
  const { fen, opponentName, strategyAnalysis, predictedMove, loading, error, supportingGames, availableGames, initialFen, moves } = useSelector(
    (state) => state.chess
  );

  // --- Local Game & Form States ---
  const game = useMemo(() => restoreGame(initialFen, moves), [initialFen, moves]);
  const playersQuery = useGetPlayersQuery(state.username || 'session', { refetchOnMountOrArgChange: 60 });
  const players = playersQuery.data || EMPTY_PLAYERS;
  const playersLoading = playersQuery.isFetching;
  const playersError = playersQuery.error?.error || '';
  useEffect(() => {
    if (!playersQuery.data) return;
    const selected = store.getState().chess.opponentName;
    if (!players.some((player) => player.name === selected)) dispatch(setOpponentName(players[0]?.name || ''));
  }, [players, playersQuery.data, dispatch, store]);
  const selectedPlayer = players.find((player) => player.name === opponentName);

  const [context, setContext] = useState('');
  const [moveInput, setMoveInput] = useState('');
  const [promotion, setPromotion] = useState('q');
  const [orientation, setOrientation] = useState('white');
  const [aiSuggestion, setAiSuggestion] = useState('');
  const [activeReportTab, setActiveReportTab] = useState('profile');
  const strategyTabs = strategyAnalysis?.report ? reportSections.map((section) => ({ ...section, content: strategyAnalysis.report[section.id] })) : [];
  const visibleReportTab = strategyTabs.find((tab) => tab.id === activeReportTab) || strategyTabs[0];

  // --- Chessboard Logic ---
  async function fetchMovePrediction(snapshot, expectedRevision) {
    const currentFen = snapshot.fen;
    const request = moveGate.begin();
    const opponent = opponentName;
    setMovePending(true);
    setMoveError('');
    try {
      const result = await requestJson('/api/v1/predict-move', {
        method: 'POST', body: { fen: currentFen, initial_fen: initialFen, moves: snapshot.moves, opponent_username: opponent },
        getAccessToken, signal: request.signal, timeout: 15000,
      });
      const current = store.getState().chess;
      if (!moveGate.isCurrent(request) || current.fen !== currentFen || current.opponentName !== opponent || current.revision !== expectedRevision) return;
      
      const nextGame = restoreGame(initialFen, snapshot.moves);
      if (!result.game_over) nextGame.move(result.san_move);
      const next = gameSnapshot(nextGame);
      dispatch(applyMovePrediction({ expectedFen: currentFen, expectedRevision, opponent,
        response: result, nextFen: next.fen, nextMoves: next.moves, nextPgn: next.pgn }));
      setAiSuggestion(result.game_over ? `Game over: ${result.outcome}` : result.matching_games
        ? `${result.san_move}: played in ${result.observed_games} of ${result.matching_games} matching games.`
        : `${result.san_move}: positional estimate; no matching games for this position.`);
    } catch (err) {
      if (moveGate.isCurrent(request)) setMoveError(friendlyError(err));
    } finally {
      if (moveGate.isCurrent(request)) {
        moveGate.finish(request);
        setMovePending(false);
      }
    }
  }

  function playMove(move) {
    if (moveGate.busy() || !selectedPlayer || playersLoading || predictedMove?.game_over) return false;
    const gameCopy = restoreGame(initialFen, moves);
    let moveResult;
    try {
      moveResult = gameCopy.move(move);
    } catch {
      setMoveError('Enter a legal move for this position, such as Nf3 or g1f3.');
      return false;
    }

    if (moveResult === null) return false;

    const snapshot = gameSnapshot(gameCopy);
    setAiSuggestion('');
    dispatch(setGameSnapshot({ expectedRevision: store.getState().chess.revision, ...snapshot }));
    fetchMovePrediction(snapshot, store.getState().chess.revision);
    return true;
  }

  function onDrop(from, to) { return playMove({ from, to, promotion }); }
  function submitMove(event) {
    event.preventDefault();
    const text = moveInput.trim();
    const move = /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(text)
      ? { from: text.slice(0,2), to: text.slice(2,4), promotion: text[4] || promotion } : text;
    if (playMove(move)) setMoveInput('');
  }
  function invalidateStrategy() {
    strategyGate.cancel(); dispatch(clearStrategy()); setEarlyStatistics([]); setReportProgress('');
  }
  function tabKey(event, index) {
    const count = strategyTabs.length;
    const next = event.key === 'ArrowRight' ? (index + 1) % count : event.key === 'ArrowLeft' ? (index + count - 1) % count
      : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : null;
    if (next === null) return;
    event.preventDefault(); setActiveReportTab(strategyTabs[next].id);
    event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next].focus();
  }

  // --- Form Submission Logic (RAG Strategy) ---
  const handleGeneratePrediction = async (e) => {
    e.preventDefault();
    if (!selectedPlayer) return;
    const request = strategyGate.begin();
    dispatch(setLoading(true));
    
    try {
      setReportProgress('Checking indexed game evidence...');
      setEarlyStatistics([]);
      await authenticatedRequest('/api/v1/predict-strategy/stream', {
        method: 'POST', body: { opponent_name: opponentName, context, color: reportColor },
        getAccessToken, signal: request.signal, timeout: 85000,
      }, (response) => readReportStream(response, (event) => {
        if (!strategyGate.isCurrent(request) || store.getState().chess.opponentName !== opponentName) return;
        if (event.type === 'progress') setReportProgress(event.message);
        if (event.type === 'statistics') setEarlyStatistics(event.statistics);
        if (event.type === 'complete') {
          dispatch(setStrategyAnalysis(event.result));
          setReportProgress(event.result.cached ? 'Loaded cached report.' : 'Report complete.');
          setEarlyStatistics([]);
        }
      }));
    } catch (error) {
      if (strategyGate.isLatest(request)) dispatch(setError(friendlyError(error)));
    } finally {
      if (strategyGate.isLatest(request)) dispatch(setLoading(false));
      strategyGate.finish(request);
    }
  };

  return (
    <div className="app-shell">
      <header className="site-header">
        <Link className="brand" to="/" aria-label="Neuro Chess home" style={{ textDecoration: 'none' }}>
          <span className="brand-mark">♞</span>
          <span>
            <strong>Neuro Chess</strong>
            <small>Opponent intelligence</small>
          </span>
        </Link>
        <div className="header-copy">
          <span className="eyebrow">AI-powered analysis</span>
          <p>Predict the position. Prepare the plan.</p>
        </div>
      </header>

      <main className="dashboard" id="top">
        <section className="board-panel panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Live board</span>
              <h1>Make your move</h1>
            </div>
            <span className="live-indicator"><i /> Analysis ready</span>
          </div>
          <div className="board-frame">
            <ResponsiveBoard
              position={game.fen()} boardOrientation={orientation}
              onPieceDrop={onDrop}
              arePiecesDraggable={!movePending && Boolean(selectedPlayer) && !playersLoading && !predictedMove?.game_over}
              customDarkSquareStyle={{ backgroundColor: '#54715b' }}
              customLightSquareStyle={{ backgroundColor: '#e7e1d1' }}
            />
          </div>
          <form className="keyboard-move-form" onSubmit={submitMove}>
            <label htmlFor="dashboard-move">Play a move (SAN or UCI)</label>
            <input id="dashboard-move" value={moveInput} onChange={(event) => setMoveInput(event.target.value)} placeholder="e4 or e2e4" autoComplete="off" />
            <label htmlFor="dashboard-promotion">Promotion</label>
            <select id="dashboard-promotion" value={promotion} onChange={(event) => setPromotion(event.target.value)}>
              <option value="q">Queen</option><option value="r">Rook</option><option value="b">Bishop</option><option value="n">Knight</option>
            </select>
            <button type="submit" className="reader-secondary-button" disabled={movePending || !selectedPlayer || playersLoading || predictedMove?.game_over}>Play move</button>
          </form>
          {movePending && <p role="status">Waiting for the predicted reply…</p>}
          {moveError && <p role="alert">{moveError}</p>}
          <div className="board-footer">
            <span>Play a legal move to receive an opponent prediction.</span>
            <code>{fen.split(' ').slice(0, 4).join(' ')}</code>
          </div>
          <div className="board-history">
            <button type="button" className="reader-secondary-button" onClick={() => setOrientation(orientation === 'white' ? 'black' : 'white')}>Flip board</button>
            <button type="button" className="reader-secondary-button" disabled={!moves.length} onClick={() => {
              moveGate.cancel(); setMovePending(false); setMoveError(''); setAiSuggestion('');
              const remaining = moves.slice(0, Math.max(0, moves.length - (moves.length % 2 || 2)));
              dispatch(setGameSnapshot({ expectedRevision: store.getState().chess.revision, ...gameSnapshot(restoreGame(initialFen, remaining)) }));
            }}>Undo turn</button>
            <button type="button" className="reader-secondary-button" onClick={() => {
              moveGate.cancel(); setMovePending(false); setMoveError(''); setAiSuggestion('');
              dispatch(setFen(new Chess().fen()));
            }}>Reset game</button>
            <details><summary>Game history / PGN ({moves.length} plies)</summary>
              <textarea aria-label="Game PGN" readOnly value={game.pgn()} rows={5} />
            </details>
          </div>
          {aiSuggestion && (
            <div className="move-suggestion" aria-live="polite">
              <span className="suggestion-icon">✦</span>
              <div>
                <span className="eyebrow">Predicted response</span>
                <strong>{aiSuggestion}</strong>
              </div>
            </div>
          )}
        </section>

        <section className="analysis-column">
          <div className="analysis-intro">
            <span className="eyebrow">Your preparation room</span>
            <h2>Understand your opponent before the next move.</h2>
          </div>
          {state.isAuthenticated ? (
            <>
              <div className="user-bar panel">
                <div className="avatar">{(state.username || 'U').charAt(0).toUpperCase()}</div>
                <span>Welcome back, <b>{state.username || 'User'}</b></span>
                <button onClick={() => signOut()} className="text-button">
                  Logout
                </button>
              </div>
              
              <form onSubmit={handleGeneratePrediction} className="analysis-form panel">
                <div className="form-heading">
                  <span className="eyebrow">Strategy search</span>
                  <h3>Generate a game plan</h3>
                </div>
                <div className="input-group">
                  <label htmlFor="opponent-player">Opponent</label>
                  <select id="opponent-player" value={selectedPlayer ? opponentName : ''}
                    disabled={playersLoading || !players.length}
                    onChange={(e) => {
                      moveGate.cancel(); strategyGate.cancel();
                      setMovePending(false); setMoveError(''); setAiSuggestion('');
                      dispatch(setLoading(false)); dispatch(setOpponentName(e.target.value));
                      setEarlyStatistics([]); setReportProgress('');
                    }}>
                    <option value="" disabled>{playersLoading ? 'Loading players…' : 'Choose an indexed player'}</option>
                    {players.map((player) => <option key={player.name} value={player.name}>{player.name} · {player.games} games</option>)}
                  </select>
                  {selectedPlayer && <small>{selectedPlayer.games} indexed games available.</small>}
                  {!playersLoading && !players.length && !playersError && <p>No indexed players yet. Ingest a PGN dataset to begin.</p>}
                  {playersError && <p role="alert">{playersError}</p>}
                  <button type="button" className="text-button" disabled={playersLoading || movePending}
                    onClick={() => playersQuery.refetch()}>Refresh players</button>
                </div>
                
                <div className="input-group">
                  <label htmlFor="strategy-context">Opening / Context</label>
                  <input 
                    id="strategy-context" type="text" maxLength={2000}
                    value={context} 
                    onChange={(e) => { invalidateStrategy(); setContext(e.target.value); }}
                    placeholder="e.g., Plays the Sicilian Najdorf"
                  />
                </div>

                <div className="input-group"><label htmlFor="report-color">Opponent color</label>
                  <select id="report-color" value={reportColor} onChange={(event) => { invalidateStrategy(); setReportColor(event.target.value); }}>
                    <option value="any">Both colors</option><option value="white">White</option><option value="black">Black</option>
                  </select>
                </div>
                <button type="submit" disabled={loading || playersLoading || !selectedPlayer} className="primary-button">
                  <span>{loading ? 'Analyzing...' : 'Generate RAG Strategy'}</span>
                  {!loading && <span aria-hidden="true">→</span>}
                </button>
              </form>

              {loading && <p role="status" aria-live="polite">{reportProgress}</p>}
              {earlyStatistics.length > 0 && <Statistics statistics={earlyStatistics} />}
              {error && (
                <div className="error-message" role="alert">
                  <span>!</span><div><strong>Unable to complete the request</strong>{error}</div>
                </div>
              )}

              {(strategyAnalysis || predictedMove) && (
                <div className="results-panel panel">
                  <div className="results-heading">
                    <div>
                      <span className="eyebrow">AI findings</span>
                      <h3>Opponent report</h3>
                    </div>
                    {predictedMove?.cached && <span className="cache-badge">Cached</span>}
                  </div>
                  {predictedMove && (
                    <div className="prediction-comparison">
                      {predictedMove.game_over ? <p>Game over: {predictedMove.outcome}</p> : <>
                        <section><h4>Likely opponent response</h4>
                          <strong>{predictedMove.san_move}</strong>
                          <p>{predictedMove.matching_games
                            ? `Played in ${predictedMove.observed_games} of ${predictedMove.matching_games} matching games.`
                            : 'No matching games. This is a positional estimate.'}</p>
                          <p>Smoothed move estimate: {Math.round(predictedMove.confidence * 100)}%.
                            {predictedMove.matching_games > 0 && ` Historical evidence weight: ${Math.round(predictedMove.history_weight * 100)}%.`}</p>
                          <small>This estimate is not a win probability and has not been calibrated for this player.</small>
                          <ul>{predictedMove.candidates?.map((candidate) => <li key={candidate.uci}>
                            {candidate.san} · {(candidate.probability * 100).toFixed(1)}% · {candidate.observed_games} observed games
                          </li>)}</ul>
                        </section>
                        <section><h4>Strongest engine move</h4>
                          {predictedMove.engine?.status === 'available' ? <>
                            <strong>{predictedMove.engine.best.san}</strong>
                            <p>{formatEvaluation(predictedMove.engine.best)}</p>
                            <p>After the predicted response: {formatEvaluation(predictedMove.engine.predicted_move)}</p>
                            <ul>{predictedMove.engine.alternatives.map((line) => <li key={line.uci}>{line.san} · {formatEvaluation(line)}</li>)}</ul>
                            <small>{predictedMove.engine.name} · evaluations from White’s perspective · bounded search</small>
                          </> : <p>{predictedMove.engine?.status === 'busy' ? 'Engine is busy. Try the next position shortly.' : 'Engine evaluation is unavailable. The opponent estimate remains available.'}</p>}
                        </section>
                      </>}
                      {predictedMove.draw_claim_available && <p>A draw can be claimed from this position.</p>}
                    </div>
                  )}
                  {strategyAnalysis && (
                    <div className="strategy-result strategy-report">
                      <p>Opponent color: {strategyAnalysis.color}. {strategyAnalysis.context && `Context: ${strategyAnalysis.context}`}</p>
                      <p>Based on {supportingGames} supporting games from {availableGames} indexed games for this opponent. {strategyAnalysis.cached && "Cached report."}</p>
                      <Statistics statistics={strategyAnalysis.statistics} />
                      <div className="report-topline">
                        <span className="result-label">Strategic analysis</span>
                        <span className="report-count">{strategyTabs.length} sections</span>
                      </div>
                      <div className="report-tabs" role="tablist" aria-label="Opponent report categories">
                        {strategyTabs.map((tab, index) => (
                          <button
                            key={tab.id}
                            id={`${tab.id}-tab`}
                            className={visibleReportTab?.id === tab.id ? 'report-tab is-active' : 'report-tab'}
                            type="button"
                            role="tab"
                            aria-selected={visibleReportTab?.id === tab.id}
                            tabIndex={visibleReportTab?.id === tab.id ? 0 : -1}
                            onKeyDown={(event) => tabKey(event, index)}
                            aria-controls={`${tab.id}-panel`}
                            onClick={() => setActiveReportTab(tab.id)}
                          >
                            <span>{String(index + 1).padStart(2, '0')}</span>{tab.label}
                          </button>
                        ))}
                      </div>
                      {strategyTabs.map((tab, index) => (
                        <section
                          key={tab.id}
                          hidden={visibleReportTab?.id !== tab.id}
                          className="report-panel"
                          id={`${tab.id}-panel`}
                          role="tabpanel" tabIndex={0}
                          aria-labelledby={`${tab.id}-tab`}
                        >
                          <div className="report-panel-heading">
                            <div className="report-section-number">{String(index + 1).padStart(2, '0')}</div>
                            <div><span>{tab.kicker}</span><h4>{tab.label}</h4></div>
                          </div>
                          {visibleReportTab?.id === tab.id && <ReportContent content={tab.content} sources={strategyAnalysis.sources} />}
                        </section>
                      ))}
                      <h4>Evidence limitations</h4><ul>{strategyAnalysis.report.limitations.map((text, index) => <li key={index}>{text}</li>)}</ul>
                      <h4>Supporting games</h4>{strategyAnalysis.sources.map((source, index) => <details key={source.id} id={`game-${source.id}`}>
                        <summary>Game {index + 1}: {source.white} vs {source.black} ? {source.result} ? {source.date}</summary>
                        <p>{source.event} ? ECO: {source.eco} ? Time control: {source.timecontrol}</p>
                        <pre className="report-diagram">{source.pgn}</pre><small>Reference: {source.id}</small>
                      </details>)}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="sign-in-card panel">
               <span className="lock-icon">♙</span>
               <span className="eyebrow">Members only</span>
               <h3>Sign in to analyze opponents</h3>
               <p>Access personalized strategy reports based on your opponent and the current position.</p>
               <button onClick={() => signIn()} className="primary-button">
                 Login with Asgardeo
               </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
