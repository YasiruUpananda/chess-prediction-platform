import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestGate } from './requestGate.js';
import reducer, { applyMovePrediction, setFen, setOpponentName } from './store/chessSlice.js';

test('superseded and cancelled requests cannot apply results', () => {
  const gate = createRequestGate();
  const first = gate.begin();
  assert.equal(gate.busy(), true);
  const second = gate.begin();
  assert.equal(first.signal.aborted, true);
  assert.equal(gate.isCurrent(first), false);
  gate.finish(first);
  assert.equal(gate.isCurrent(second), true);
  gate.cancel();
  assert.equal(second.signal.aborted, true);
  assert.equal(gate.busy(), false);
});

test('prediction applies atomically only to its original position and opponent', () => {
  const initial = reducer(undefined, { type: 'init' });
  const action = applyMovePrediction({ expectedFen: initial.fen, expectedRevision: initial.revision, opponent: initial.opponentName,
    nextFen: 'next-position', response: { san_move: 'e5' } });
  assert.equal(reducer(initial, action).fen, 'next-position');
  const moved = reducer(initial, setFen('new-position'));
  assert.deepEqual(reducer(moved, action), moved);
  const changed = reducer(initial, setOpponentName('Another opponent'));
  assert.deepEqual(reducer(changed, action), changed);
  const reset = reducer(initial, setFen(initial.fen));
  assert.deepEqual(reducer(reset, action), reset);
});
