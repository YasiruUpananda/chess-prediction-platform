import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelector, useDispatch, useStore } from 'react-redux';
import {
  setFen,
  setGameSnapshot,
  setOpponentName,
  setLoading,
  setStrategyAnalysis,
  applyMovePrediction,
  setError,
} from './store/chessSlice';
import axios from 'axios';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import { useAuthContext } from "@asgardeo/auth-react";
import { API_BASE_URL, getBearerHeaders } from './api';
import { createRequestGate } from './requestGate';
import { readReportStream } from './reportStream';
import { restoreGame, gameSnapshot, formatEvaluation } from './gameHistory';
import './App.css'; 

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
    dispatch(setLoading(false));
  }, [moveGate, strategyGate, dispatch]);
  const { state, signIn, signOut, getAccessToken } = useAuthContext();

  // --- Read Global State from Redux ---
  const { fen, opponentName, strategyAnalysis, predictedMove, loading, error, supportingGames, availableGames, initialFen, moves } = useSelector(
    (state) => state.chess
  );

  // --- Local Game & Form States ---
  const game = useMemo(() => restoreGame(initialFen, moves), [initialFen, moves]);
  const [players, setPlayers] = useState([]);
  const [playersLoading, setPlayersLoading] = useState(true);
  const [playersError, setPlayersError] = useState('');
  const [playersReload, setPlayersReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function loadPlayers() {
      try {
        const response = await axios.get(`${API_BASE_URL}/api/v1/players`, {
          headers: await getBearerHeaders(getAccessToken), signal: controller.signal, timeout: 10000,
        });
        if (controller.signal.aborted) return;
        const available = response.data.players;
        setPlayers(available);
        setPlayersError('');
        const selected = store.getState().chess.opponentName;
        if (!available.some((player) => player.name === selected)) dispatch(setOpponentName(available[0]?.name || ''));
      } catch (error) {
        if (!controller.signal.aborted) setPlayersError(error.response?.data?.detail || 'Could not load indexed players.');
      } finally {
        if (!controller.signal.aborted) setPlayersLoading(false);
      }
    }
    loadPlayers();
    return () => controller.abort();
  }, [getAccessToken, store, dispatch, playersReload]);
  const selectedPlayer = players.find((player) => player.name === opponentName);

  const [context, setContext] = useState('');
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
      const response = await axios.post(`${API_BASE_URL}/api/v1/predict-move`, {
        fen: currentFen, initial_fen: initialFen, moves: snapshot.moves,
        opponent_username: opponentName || "Opponent"
      }, { headers: await getBearerHeaders(getAccessToken), signal: request.signal, timeout: 15000 });
      const current = store.getState().chess;
      if (!moveGate.isCurrent(request) || current.fen !== currentFen || current.opponentName !== opponent || current.revision !== expectedRevision) return;
      
      const result = response.data;
      const nextGame = restoreGame(initialFen, snapshot.moves);
      if (!result.game_over) nextGame.move(result.san_move);
      const next = gameSnapshot(nextGame);
      dispatch(applyMovePrediction({ expectedFen: currentFen, expectedRevision, opponent,
        response: result, nextFen: next.fen, nextMoves: next.moves, nextPgn: next.pgn }));
      setAiSuggestion(result.game_over ? `Game over: ${result.outcome}` : result.matching_games
        ? `${result.san_move}: played in ${result.observed_games} of ${result.matching_games} matching games.`
        : `${result.san_move}: positional estimate; no matching games for this position.`);
    } catch (err) {
      if (moveGate.isCurrent(request)) setMoveError(err.response?.data?.detail || err.message);
    } finally {
      if (moveGate.isCurrent(request)) {
        moveGate.finish(request);
        setMovePending(false);
      }
    }
  }

  function onDrop(sourceSquare, targetSquare) {
    if (moveGate.busy() || !selectedPlayer || playersLoading || predictedMove?.game_over) return false;
    const gameCopy = restoreGame(initialFen, moves);
    let moveResult;
    try {
      moveResult = gameCopy.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: 'q',
      });
    } catch {
      return false; 
    }

    if (moveResult === null) return false;

    const snapshot = gameSnapshot(gameCopy);
    dispatch(setGameSnapshot({ expectedRevision: store.getState().chess.revision, ...snapshot }));
    fetchMovePrediction(snapshot, store.getState().chess.revision);
    return true;
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
      const timer = setTimeout(() => request.abort(), 85000);
      try {
        const response = await fetch(`${API_BASE_URL}/api/v1/predict-strategy/stream`, {
          method: 'POST', headers: { ...await getBearerHeaders(getAccessToken), 'Content-Type': 'application/json' },
          body: JSON.stringify({ opponent_name: opponentName, context, color: reportColor }), signal: request.signal,
        });
        await readReportStream(response, (event) => {
          if (!strategyGate.isCurrent(request) || store.getState().chess.opponentName !== opponentName) return;
          if (event.type === 'progress') setReportProgress(event.message);
          if (event.type === 'statistics') setEarlyStatistics(event.statistics);
          if (event.type === 'complete') {
            dispatch(setStrategyAnalysis(event.result));
            setReportProgress(event.result.cached ? 'Loaded cached report.' : 'Report complete.');
            setEarlyStatistics([]);
          }
        });
      } finally { clearTimeout(timer); }
    } catch (error) {
      if (strategyGate.isLatest(request)) dispatch(setError(request.signal.aborted ? 'Report deadline exceeded. Retry shortly.' : error.message || "Failed to generate prediction."));
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
            <Chessboard
              position={game.fen()}
              onPieceDrop={onDrop}
              arePiecesDraggable={!movePending && Boolean(selectedPlayer) && !playersLoading && !predictedMove?.game_over}
              boardWidth={500}
              customDarkSquareStyle={{ backgroundColor: '#54715b' }}
              customLightSquareStyle={{ backgroundColor: '#e7e1d1' }}
            />
          </div>
          {movePending && <p role="status">Waiting for the predicted reply…</p>}
          {moveError && <p role="alert">{moveError}</p>}
          <div className="board-footer">
            <span>Play a legal move to receive an opponent prediction.</span>
            <code>{fen.split(' ').slice(0, 4).join(' ')}</code>
          </div>
          <div className="board-history">
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
                    onClick={() => { setPlayersLoading(true); setPlayersReload((value) => value + 1); }}>Refresh players</button>
                </div>
                
                <div className="input-group">
                  <label>Opening / Context</label>
                  <input 
                    type="text" 
                    value={context} 
                    onChange={(e) => setContext(e.target.value)} 
                    placeholder="e.g., Plays the Sicilian Najdorf"
                  />
                </div>

                <div className="input-group"><label htmlFor="report-color">Opponent color</label>
                  <select id="report-color" value={reportColor} disabled={loading} onChange={(event) => setReportColor(event.target.value)}>
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
                            aria-controls={`${tab.id}-panel`}
                            onClick={() => setActiveReportTab(tab.id)}
                          >
                            <span>{String(index + 1).padStart(2, '0')}</span>{tab.label}
                          </button>
                        ))}
                      </div>
                      {visibleReportTab && (
                        <section
                          className="report-panel"
                          id={`${visibleReportTab.id}-panel`}
                          role="tabpanel"
                          aria-labelledby={`${visibleReportTab.id}-tab`}
                        >
                          <div className="report-panel-heading">
                            <div className="report-section-number">{String(strategyTabs.indexOf(visibleReportTab) + 1).padStart(2, '0')}</div>
                            <div><span>{visibleReportTab.kicker}</span><h4>{visibleReportTab.label}</h4></div>
                          </div>
                          <ReportContent content={visibleReportTab.content} sources={strategyAnalysis.sources} />
                        </section>
                      )}
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
