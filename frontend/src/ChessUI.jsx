import { useState } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';

export default function ChessUI() {
  const [game, setGame] = useState(new Chess());

  function makeAMove(move) {
    const gameCopy = new Chess(game.fen());
    try {
      const result = gameCopy.move(move);
      setGame(gameCopy);
      return { result, fen: gameCopy.fen() };
    } catch (error) {
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

    void fetch('http://localhost:8000/api/v1/predict-move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen: move.fen, opponent_username: '' }),
    }).catch(console.error);
    
    return true;
  }

  return (
    <div className="board-container" style={{ maxWidth: '600px', margin: '0 auto' }}>
      <Chessboard position={game.fen()} onPieceDrop={onDrop} />
    </div>
  );
}
