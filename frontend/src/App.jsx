import { useState } from 'react';
import axios from 'axios';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import { useAuthContext } from "@asgardeo/auth-react";
import './App.css'; 

export default function App() {
  // --- Auth State ---
  const { state, signIn, signOut } = useAuthContext();

  // --- Chess Game State ---
  const [game, setGame] = useState(new Chess());

  // --- Prediction Form State ---
  const [opponentName, setOpponentName] = useState('');
  const [context, setContext] = useState('');
  const [prediction, setPrediction] = useState('');
  const [loading, setLoading] = useState(false);

  // --- Chessboard Logic ---
  function makeAMove(move) {
    const gameCopy = new Chess(game.fen());
    try {
      const result = gameCopy.move(move);
      setGame(gameCopy);
      return result;
    } catch (error) {
      return null;
    }
  }

  function onDrop(sourceSquare, targetSquare) {
    const move = makeAMove({
      from: sourceSquare,
      to: targetSquare,
      promotion: 'q',
    });
    
    if (move === null) return false;
    return true;
  }

  // --- Form Submission Logic ---
  const handleGeneratePrediction = async (e) => {
    e.preventDefault();
    setLoading(true);
    setPrediction('');
    
    try {
      const response = await axios.post('http://localhost:8000/api/v1/predict-strategy', {
        opponent_name: opponentName,
        context: context
      });
      setPrediction(response.data.strategy_analysis);
    } catch (error) {
      console.error("Prediction Error:", error);
      setPrediction("Failed to generate prediction. Check console for details.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <h1 style={styles.header}>Chess Prediction Engine</h1>
      <p style={styles.subheader}>AI-powered opponent strategy analysis</p>

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
        </div>

        {/* Right Column: Prediction Form & Results */}
        <div style={styles.formColumn}>
          {state.isAuthenticated ? (
            <>
              <button onClick={() => signOut()} style={{...styles.button, backgroundColor: '#555', alignSelf: 'flex-end'}}>
                Logout
              </button>
              
              <form onSubmit={handleGeneratePrediction} style={styles.form}>
                <div style={styles.inputGroup}>
                  <label>Opponent Name</label>
                  <input 
                    type="text" 
                    value={opponentName} 
                    onChange={(e) => setOpponentName(e.target.value)} 
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
                  {loading ? 'Analyzing...' : 'Generate Prediction'}
                </button>
              </form>

              {/* Results Box */}
              {prediction && (
                <div style={styles.resultBox}>
                  <h3>Strategy Analysis</h3>
                  <p>{prediction}</p>
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
    gap: '2rem',
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