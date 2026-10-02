import { useState } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import { useAuthContext } from '@asgardeo/auth-react';
import { API_BASE_URL, getBearerHeaders } from './api';

export default function ChessUI() {
  const [game, setGame] = useState(new Chess());
  const { getAccessToken } = useAuthContext();

  function makeAMove(move) {
    const gameCopy = new Chess(game.fen());
    try {
      const result = gameCopy.move(move);
      setGame(gameCopy);
      return { result, fen: gameCopy.fen() };
    } catch {
      return null;
    }
  }

  function onDrop(sourceSquare, targetSquare) {
    const move = makeAMove({
      from: sourceSquare,
      to: targetSquare,
      promotion: 'q', // Always promote to a queen for simplicity right now
    });

    // If the move is illegal, snap the piece back to its original square
    if (move === null || move.result === null) return false;

    void getBearerHeaders(getAccessToken)
      .then((headers) => fetch(`${API_BASE_URL}/api/v1/predict-move`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen: move.fen, opponent_username: '' }),
      }))
      .catch(console.error);
    
    return true;
  }

  return (
    <section className="standalone-board">
      <div className="standalone-board__heading">
        <div>
          <span className="eyebrow">Practice board</span>
          <h2>Explore a position</h2>
        </div>
        <span>AI prediction enabled</span>
      </div>
      <div className="standalone-board__frame">
        <Chessboard
          position={game.fen()}
          onPieceDrop={onDrop}
          customDarkSquareStyle={{ backgroundColor: '#54715b' }}
          customLightSquareStyle={{ backgroundColor: '#e7e1d1' }}
        />
      </div>
      <p>Make a legal move to send the current position for prediction.</p>
    </section>
  );
}
