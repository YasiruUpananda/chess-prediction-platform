import React, { useState, useEffect } from 'react';
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
import './App.css'; 

export default function App() {
  const dispatch = useDispatch();
  const { state, signIn, signOut } = useAuthContext();

  // --- Read Global State from Redux ---
  const { fen, opponentName, strategyAnalysis, predictedMove, loading, error } = useSelector(
    (state) => state.chess
  );

  // --- Local Game & Form States ---
  const [game, setGame] = useState(new Chess());
  const [context, setContext] = useState('');
  const [aiSuggestion, setAiSuggestion] = useState('');

  // Synchronize Redux fen state with local Chess instance if needed
  useEffect(() => {
    try {
      if (game.fen() !== fen) {
        setGame(new Chess(fen));
      }
    } catch (e) {
      console.error("Invalid FEN sync:", e);
    }
  }, [fen]);

  // --- Chessboard Logic ---
  async function fetchMovePrediction(currentFen) {
    dispatch(setLoading(true));
    try {
      const response = await axios.post('http://localhost:8000/api/v1/predict-move', {
        fen: currentFen,
        opponent_username: opponentName || "Opponent"
      });
      
      dispatch(setPredictedMove(response.data));
      const aiMove = response.data.san_move;
      const cacheNote = response.data.cached ? ' (Cached via Redis)' : '';
      setAiSuggestion(`AI Move: ${aiMove} (${response.data.suggested_move}) - Confidence: ${response.data.confidence * 100}%${cacheNote}`);
      
      // Automatically execute the AI's counter-move on the board
      setGame((currentGame) => {
        const gameCopy = new Chess(currentGame.fen());
        try {
          gameCopy.move(aiMove);
          dispatch(setFen(gameCopy.fen()));
          return gameCopy;
        } catch (e) {
          console.error("Failed to apply AI move:", e);
          return currentGame;
        }
      });
    } catch (err) {
      console.error("Move prediction error:", err);
      dispatch(setError(err.response?.data?.detail || err.message));
    }
  }

  function onDrop(sourceSquare, targetSquare) {
    const gameCopy = new Chess(game.fen());
    let moveResult = null;
    
    try {
      moveResult = gameCopy.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: 'q',
      });
    } catch (error) {
      return false; 
    }

    if (moveResult === null) return false;

    setGame(gameCopy);
    dispatch(setFen(gameCopy.fen()));
    fetchMovePrediction(gameCopy.fen());
    return true;
  }

  // --- Form Submission Logic (RAG Strategy) ---
  const handleGeneratePrediction = async (e) => {
    e.preventDefault();
    dispatch(setLoading(true));
    
    try {
      const response = await axios.post('http://localhost:8000/api/v1/predict-strategy', {
        opponent_name: opponentName || "Magnus Carlsen",
        context: context
      });
      dispatch(setStrategyAnalysis(response.data.strategy_analysis));
    } catch (error) {
      console.error("Prediction Error:", error);
      dispatch(setError(error.response?.data?.detail || "Failed to generate prediction."));
    }
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <h1 style={styles.header}>Chess Prediction Engine</h1>
      <p style={styles.subheader}>Enterprise Microservices Stack: PyTorch, Redis, RabbitMQ & RAG AI</p>

      {/* Main Two-Column Layout */}
      <div style={styles.layout}>
        
        {/* Left Column: Chessboard */}
        <div style={styles.boardColumn}>
          <Chessboard 
            position={game.fen()} 
            onPieceDrop={onDrop} 
            boardWidth={500} 
            customDarkSquareStyle={{ backgroundColor: '#779556' }} 
            customLightSquareStyle={{ backgroundColor: '#ebecd0' }} 
          />
          {aiSuggestion && (
            <div style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: '#0f3460', borderRadius: '4px', textAlign: 'center' }}>
              <strong>{aiSuggestion}</strong>
            </div>
          )}
        </div>

        {/* Right Column: Prediction Form & Results */}
        <div style={styles.formColumn}>
          {state.isAuthenticated ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#16213e', padding: '1rem', borderRadius: '8px' }}>
                <span>Welcome, <b>{state.username || 'User'}</b></span>
                <button onClick={() => signOut()} style={{...styles.button, marginTop: 0, backgroundColor: '#555', width: 'auto', padding: '0.5rem 1rem'}}>
                  Logout
                </button>
              </div>
              
              <form onSubmit={handleGeneratePrediction} style={styles.form}>
                <div style={styles.inputGroup}>
                  <label>Opponent Name</label>
                  <input 
                    type="text" 
                    value={opponentName} 
                    onChange={(e) => dispatch(setOpponentName(e.target.value))} 
                    placeholder="e.g., Magnus Carlsen"
                    style={styles.input}
                  />
                </div>
                
                <div style={styles.inputGroup}>
                  <label>Opening / Context</label>
                  <input 
                    type="text" 
                    value={context} 
                    onChange={(e) => setContext(e.target.value)} 
                    placeholder="e.g., Plays the Sicilian Najdorf"
                    style={styles.input}
                  />
                </div>

                <button type="submit" disabled={loading} style={styles.button}>
                  {loading ? 'Analyzing...' : 'Generate RAG Strategy'}
                </button>
              </form>

              {/* Error Display */}
              {error && (
                <div style={{ backgroundColor: '#4a1515', padding: '1rem', borderRadius: '8px', color: '#ff8080' }}>
                  <strong>Error:</strong> {error}
                </div>
              )}

              {/* Results Box */}
              {strategyAnalysis && (
                <div style={styles.resultBox}>
                  <h3>AI Strategy Analysis (pgvector RAG)</h3>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{strategyAnalysis}</p>
                </div>
              )}
            </>
          ) : (
            <div style={styles.form}>
               <h3 style={{textAlign: 'center', margin: '0 0 1rem 0'}}>Sign in to analyze opponents</h3>
               <button onClick={() => signIn()} style={styles.button}>
                 Login with Asgardeo
               </button>
            </div>
          )}
        </div>
        
      </div>
    </div>
  );
}

// --- Inline Styles ---
const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#1a1a2e',
    color: '#e6e6e6',
    fontFamily: 'sans-serif',
    padding: '2rem',
  },
  header: {
    textAlign: 'center',
    fontSize: '2.5rem',
    margin: '0 0 0.5rem 0',
  },
  subheader: {
    textAlign: 'center',
    color: '#a0a0b5',
    marginBottom: '3rem',
  },
  layout: {
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: '4rem',
    flexWrap: 'wrap',
    maxWidth: '1200px',
    margin: '0 auto',
  },
  boardColumn: {
    flex: '1',
    minWidth: '300px',
    maxWidth: '500px',
  },
  formColumn: {
    flex: '1',
    minWidth: '300px',
    maxWidth: '500px',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    backgroundColor: '#16213e',
    padding: '2rem',
    borderRadius: '8px',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  input: {
    padding: '0.75rem',
    borderRadius: '4px',
    border: '1px solid #0f3460',
    backgroundColor: '#1a1a2e',
    color: 'white',
    fontSize: '1rem',
  },
  button: {
    padding: '0.75rem',
    marginTop: '1rem',
    borderRadius: '4px',
    border: 'none',
    backgroundColor: '#e94560',
    color: 'white',
    fontSize: '1rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  resultBox: {
    backgroundColor: '#0f3460',
    padding: '1.5rem',
    borderRadius: '8px',
    lineHeight: '1.6',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
  }
};