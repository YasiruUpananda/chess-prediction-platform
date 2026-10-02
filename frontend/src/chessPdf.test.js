import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { parseChessText, extractSanMoves, textBlocks } from './chessPdf.js';
import { restoreGame, gameSnapshot } from './gameHistory.js';

test('numbered main line excludes nested variations, comments and annotations', () => {
  assert.deepEqual(extractSanMoves('1. e4 e5 2. Nf3 Nc6'), ['e4','e5','Nf3','Nc6']);
  assert.deepEqual(extractSanMoves('1.e4 (1.d4 d5) e5 2.Nf3'), ['e4','e5','Nf3']);
  const lines = parseChessText('1.e4 {square d5} e5 (1...c5 (1...e6)) 2.Nf3 $1 Nc6?!');
  assert.deepEqual(lines[0].moves, ['e4','e5','Nf3','Nc6']);
  assert.deepEqual(lines[1].moves, ['e4','c5']);
  assert.deepEqual(lines[2].moves, ['e4','e6']);
});

test('prose squares are ignored and multiple numbered lines stay separate', () => {
  assert.deepEqual(extractSanMoves('See diagram e4 and square d5.'), []);
  const lines = parseChessText('1. e4 e5\nSee square d5.\n1. d4 d5');
  assert.equal(lines.length,2);
  assert.deepEqual(lines[1].moves,['d4','d5']);
  assert.equal(parseChessText('1. e4 e5 1. d4 d5').length,2);
  assert.deepEqual(extractSanMoves('1. e4 e5 1-0 d4'),['e4','e5']);
  assert.equal(parseChessText('1. e4 (1. d4 d5')[0].confidence,'low');
});

test('midgame numbers validate against supplied FEN and illegal text remains editable', () => {
  const board = new Chess(); board.move('e4');
  assert.deepEqual(extractSanMoves('1...e5 2.Nf3',board.fen()),['e5','Nf3']);
  const wrong = parseChessText('1...e5 2.Nf3')[0];
  assert.equal(wrong.confidence,'low'); assert.match(wrong.issue,/starting position/);
  assert.equal(wrong.raw,'e5 Nf3');
  assert.deepEqual(parseChessText('e4 e5 Nf3',undefined,true)[0].moves,['e4','e5','Nf3']);
});

test('coordinates distinguish columns without mixing alternate games', () => {
  const items = [];
  for (let i=0;i<3;i++) {
    items.push({str:['1.e4','e5','2.Nf3'][i],width:35,height:10,transform:[1,0,0,10,20,200-i*12]});
    items.push({str:['1.d4','d5','2.c4'][i],width:35,height:10,transform:[1,0,0,10,320,200-i*12]});
  }
  const blocks=textBlocks(items,600);
  assert.equal(blocks.length,2);
  assert.deepEqual(extractSanMoves(blocks[0].text),['e4','e5','Nf3']);
  assert.deepEqual(extractSanMoves(blocks[1].text),['d4','d5','c4']);
  assert.equal(blocks[0].items[0].x,20);
});

test('custom roots and underpromotion survive replay and PGN export', () => {
  const fen='7k/P7/8/8/8/8/8/7K w - - 0 1';
  const game=restoreGame(fen,['a7a8n']);
  assert.equal(game.get('a8').type,'n');
  assert.match(game.pgn(),/FEN/);
  const snapshot=gameSnapshot(game);
  assert.equal(restoreGame(fen,snapshot.moves).fen(),game.fen());
});
