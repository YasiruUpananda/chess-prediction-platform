import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { parseChessText } from './chessPdf.js';
import { buildBookTree, nodeAt, continuation, bookMoveLabels } from './bookReplay.js';

test('replay keeps nested branches at their actual positions and separate games apart',()=>{
  const lines=parseChessText('1.e4 (1.d4 d5) e5 (1...c5 (1...e6)) 2.♘f3 ♞c6\n1.c4 e5');
  const tree=buildBookTree(lines,lines[0],new Chess().fen());
  assert.deepEqual(tree.children.map(node=>node.san),['e4','d4']);
  const afterE4=nodeAt(tree,['e2e4']);
  assert.deepEqual(afterE4.children.map(node=>node.san),['e5','c5','e6']);
  assert.deepEqual(continuation(tree.children[0]),['e2e4','e7e5','g1f3','b8c6']);
  assert.deepEqual(continuation(tree.children[1]),['d2d4','d7d5']);
  assert.equal(nodeAt(tree,['c2c4']),null);
});

test('both colors of every figurine normalize including variation selectors',()=>{
  const line=parseChessText('1.♙e4 ♟e5 2.♘️f3 ♞c6 3.♗b5 ♝c5 4.O-O ♛e7 5.♖e1 ♚f8')[0];
  assert.equal(line.moves.length,10);
  assert.equal(line.issue,'');
  assert.equal(line.moves.at(-1),'Kf8');
});

test('move labels respect a black-to-move midgame starting FEN',()=>{
  const board=new Chess();board.move('e4');
  assert.deepEqual(bookMoveLabels(board.fen(),['e5','Nf3']),['1... e5','2. Nf3']);
});

test('numbered book variations can precede the main reply without losing their anchor',()=>{
  const lines=parseChessText('1.e4 (1...♟c5) e5 2.♘f3 (2...♞f6) ♞c6');
  assert.deepEqual(lines[0].moves,['e4','e5','Nf3','Nc6']);
  assert.deepEqual(lines[1].moves,['e4','c5']);
  assert.deepEqual(lines[2].moves,['e4','e5','Nf3','Nf6']);
  const tree=buildBookTree(lines,lines[0],new Chess().fen());
  assert.deepEqual(nodeAt(tree,['e2e4']).children.map(node=>node.san),['e5','c5']);
});
