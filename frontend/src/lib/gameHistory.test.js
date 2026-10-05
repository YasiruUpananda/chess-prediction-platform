import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { restoreGame, gameSnapshot } from './gameHistory.js';

test('restored game retains repetition and exportable PGN', () => {
  const game = restoreGame(new Chess().fen(), ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8']);
  assert.equal(game.isThreefoldRepetition(), true);
  const snapshot = gameSnapshot(game);
  assert.equal(snapshot.moves.length, 8);
  assert.match(snapshot.pgn, /Nf3/);
  assert.equal(restoreGame(new Chess().fen(), snapshot.moves).fen(), snapshot.fen);
});
