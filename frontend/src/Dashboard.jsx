import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import {
  setFen,
  setOpponentName,
  setLoading,
  setStrategyAnalysis,
  setPredictedMove,
  setError,
} from './store/chessSlice';
import axios from 'axios';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import { useAuthContext } from "@asgardeo/auth-react";
import { API_BASE_URL, getBearerHeaders } from './api';
import './App.css'; 

const reportSections = [
  { id: 'profile', label: 'Player profile', kicker: 'Opponent snapshot', match: null },
  { id: 'tendencies', label: 'Behavioral tendencies', kicker: 'Pattern recognition', match: /AI-Driven Behavioral Tendencies/i },
  { id: 'weaknesses', label: 'Exploitable weaknesses', kicker: 'Pressure points', match: /Exploitable Weaknesses|Structural Vulnerabilities/i },
  { id: 'predictions', label: 'Strategic predictions', kicker: 'What to expect', match: /Strategic Predictions/i },
  { id: 'countermeasures', label: 'Countermeasures', kicker: 'The playbook', match: /Recommended Countermeasures|The Playbook/i },
];

function getReportTabs(report) {
  const lines = report.split('\n');
  const sectionStarts = reportSections.slice(1).map((section) => ({
    ...section,
    line: lines.findIndex((line) => section.match.test(line)),
  })).filter((section) => section.line !== -1);

  const profileEnd = sectionStarts[0]?.line ?? lines.length;
  const tabs = [{ ...reportSections[0], content: lines.slice(0, profileEnd).join('\n').trim() }]
    .filter((section) => section.content);

  sectionStarts.forEach((section, index) => {
    const nextStart = sectionStarts[index + 1]?.line ?? lines.length;
    tabs.push({ ...section, content: lines.slice(section.line + 1, nextStart).join('\n').trim() });
  });

  return tabs.length ? tabs : [{ ...reportSections[0], content: report }];
}

function cleanReportLine(line) {
  return line
    .replace(/^\s{0,3}#{1,6}\s*/, '')
    .replace(/^\s*\d+\.\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim();
}

function ReportContent({ content }) {
  // Some reports include a text decision tree. Keep it as one preformatted block
  // so the generated branches remain aligned instead of becoming separate paragraphs.
  const isDecisionTree = /[│├┤┬┴┌┐└┘─┼]/.test(content)
    || content.split('\n').filter((line) => line.includes('|')).length >= 2;

  if (isDecisionTree) {
    const diagram = content
      .split('\n')
      .filter((line) => !/^\s*```/.test(line))
      .map((line) => line
        .replace(/^\s{0,3}#{1,6}\s*/, '')
        .replace(/^\s*\d+\.\s*/, '')
        .replace(/\*\*/g, '')
        .replace(/`/g, ''))
      .join('\n')
      .trim();

    return <pre className="report-diagram">{diagram}</pre>;
  }

  return (
    <div className="report-content">
      {content.split('\n').map((line, index) => {
        const trimmed = line.trim();
        const text = cleanReportLine(line);
        if (!text || /^```/.test(trimmed)) return null;
        if (/^---+$/.test(text)) return <div className="report-divider" key={index} />;
        if (/^\[.+\]$/.test(text)) return <h5 key={index}>{text.slice(1, -1)}</h5>;
        if (/^#{1,6}\s/.test(trimmed)) return <h5 key={index}>{text}</h5>;
        if (/^[*+-]\s+/.test(trimmed)) return <p className="report-bullet" key={index}>{text.replace(/^[*+-]\s*/, '')}</p>;
        return <p key={index}>{text}</p>;
      })}
    </div>
  );
}

export default function App() {
  const dispatch = useDispatch();
  const { state, signIn, signOut, getAccessToken } = useAuthContext();

  // --- Read Global State from Redux ---
  const { fen, opponentName, strategyAnalysis, predictedMove, loading, error, supportingGames, availableGames } = useSelector(
    (state) => state.chess
  );

  // --- Local Game & Form States ---
  const game = useMemo(() => {
    try {
      return new Chess(fen);
    } catch {
      return new Chess();
    }
  }, [fen]);
  const [context, setContext] = useState('');
  const [aiSuggestion, setAiSuggestion] = useState('');
  const [activeReportTab, setActiveReportTab] = useState('profile');
  const strategyTabs = strategyAnalysis ? getReportTabs(strategyAnalysis) : [];
  const visibleReportTab = strategyTabs.find((tab) => tab.id === activeReportTab) || strategyTabs[0];

  // --- Chessboard Logic ---
  async function fetchMovePrediction(currentFen) {
    dispatch(setLoading(true));
    try {
      const response = await axios.post(`${API_BASE_URL}/api/v1/predict-move`, {
        fen: currentFen,
        opponent_username: opponentName || "Opponent"
      }, { headers: await getBearerHeaders(getAccessToken) });
      
      dispatch(setPredictedMove(response.data));
      const aiMove = response.data.san_move;
      const cacheNote = response.data.cached ? ' (Cached via Redis)' : '';
      const source = response.data.prediction_source === 'opponent_history' ? 'opponent game history' : 'position heuristic';
      setAiSuggestion(`Suggested: ${aiMove} (${response.data.suggested_move}) - Relative preference: ${Math.round(response.data.confidence * 100)}% - Source: ${source}${cacheNote}`);
      
      // Automatically execute the AI's counter-move on the board
      const nextGame = new Chess(currentFen);
      try {
        nextGame.move(aiMove);
        dispatch(setFen(nextGame.fen()));
      } catch (error) {
        console.error("Failed to apply AI move:", error);
      }
    } catch (err) {
      console.error("Move prediction error:", err);
      dispatch(setError(err.response?.data?.detail || err.message));
    }
  }

  function onDrop(sourceSquare, targetSquare) {
    const gameCopy = new Chess(game.fen());
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

    dispatch(setFen(gameCopy.fen()));
    fetchMovePrediction(gameCopy.fen());
    return true;
  }

  // --- Form Submission Logic (RAG Strategy) ---
  const handleGeneratePrediction = async (e) => {
    e.preventDefault();
    dispatch(setLoading(true));
    
    try {
      const response = await axios.post(`${API_BASE_URL}/api/v1/predict-strategy`, {
        opponent_name: opponentName || "Magnus Carlsen",
        context: context
      }, { headers: await getBearerHeaders(getAccessToken) });
      dispatch(setStrategyAnalysis(response.data));
    } catch (error) {
      console.error("Prediction Error:", error);
      dispatch(setError(error.response?.data?.detail || "Failed to generate prediction."));
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
              boardWidth={500}
              customDarkSquareStyle={{ backgroundColor: '#54715b' }}
              customLightSquareStyle={{ backgroundColor: '#e7e1d1' }}
            />
          </div>
          <div className="board-footer">
            <span>Play a legal move to receive an opponent prediction.</span>
            <code>{fen.split(' ').slice(0, 4).join(' ')}</code>
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
                  <label>Opponent Name</label>
                  <input 
                    type="text" 
                    value={opponentName} 
                    onChange={(e) => dispatch(setOpponentName(e.target.value))} 
                    placeholder="e.g., Magnus Carlsen"
                  />
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

                <button type="submit" disabled={loading} className="primary-button">
                  <span>{loading ? 'Analyzing...' : 'Generate RAG Strategy'}</span>
                  {!loading && <span aria-hidden="true">→</span>}
                </button>
              </form>

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
                    <div className="move-result-grid">
                      <div><span>Suggested move</span><strong>{predictedMove.san_move}</strong></div>
                      <div><span>Relative preference</span><strong>{Math.round(predictedMove.confidence * 100)}%</strong></div>
                      <p className="move-source-note">Source: {predictedMove.prediction_source === 'opponent_history' ? 'matching games from this opponent' : 'a basic positional heuristic'}. This percentage ranks available moves; it is not a win probability.</p>
                      <div className="confidence-track"><i style={{ width: `${Math.round(predictedMove.confidence * 100)}%` }} /></div>
                    </div>
                  )}
                  {strategyAnalysis && (
                    <div className="strategy-result strategy-report">
                      <p>Based on {supportingGames} supporting games from {availableGames} indexed games for this opponent.</p>
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
                          <ReportContent content={visibleReportTab.content} />
                        </section>
                      )}
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
