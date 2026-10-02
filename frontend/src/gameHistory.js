import { Chess } from 'chess.js';

export function restoreGame(initialFen, moves = []) {
  const game = new Chess(initialFen);
  for (const uci of moves) game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  return game;
}

export function gameSnapshot(game) {
  return { fen: game.fen(), pgn: game.pgn(),
    moves: game.history({ verbose: true }).map((move) => move.from + move.to + (move.promotion || '')) };
}

export function formatEvaluation(line) {
  if (!line) return 'Evaluation unavailable';
  if (line.mate_white !== null && line.mate_white !== undefined) {
    return `${line.mate_white >= 0 ? 'White' : 'Black'} mates in ${Math.abs(line.mate_white)}`;
  }
  const pawns = line.score_white_cp / 100;
  if (Math.abs(pawns) < 0.3) return `Approximately equal (${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)})`;
  return `${pawns > 0 ? 'White' : 'Black'} advantage (${pawns > 0 ? '+' : ''}${pawns.toFixed(2)})`;
}
