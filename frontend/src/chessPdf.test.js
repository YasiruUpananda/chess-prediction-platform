import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { parseChessText, extractSanMoves, textBlocks, customPieceSymbols, suggestPieceMappings, applyPieceMappings } from './chessPdf.js';
import { restoreGame, gameSnapshot } from './gameHistory.js';

const bookLine='1.c4 c6 2.e4 d5 3.exd5 ♘f6 4.♘c3 cxd5 5.cxd5 ♘xd5 6.♘f3 e6 7.♗c4 ♘c6 8.0-0 ♗e7 9.d4 0-0 10.♖e1 ♘f6';
test('custom book fonts are mapped consistently and recover the complete 20-ply line',()=>{
  const encoded=bookLine.replaceAll('♘','\uE123').replaceAll('♗','¤').replaceAll('♖','§');
  assert.deepEqual(customPieceSymbols(encoded),['\uE123','¤','§']);
  const retained=parseChessText(encoded)[0];
  assert.equal(retained.moves.length,5);
  const mapping=suggestPieceMappings(retained.raw);
  // Both Qe1 and Re1 are legal: never invent the rook's identity.
  assert.deepEqual(mapping,{'\uE123':'N','¤':'B'});
  mapping['§']='R';
  const repaired=parseChessText(encoded,undefined,false,mapping)[0];
  assert.equal(repaired.moves.length,20);
  assert.equal(repaired.issue,'');
  assert.equal(parseChessText(encoded.replaceAll('\uE123','\uE123 '),undefined,false,mapping)[0].moves.length,20);
  assert.equal(applyPieceMappings('¤ ordinary prose ¤f6',{'¤':'N'}),'¤ ordinary prose Nf6');
});

test('ambiguous piece identities require manual confirmation',()=>{
  // Both the queen and bishop can legally go to e2 after e4 e5.
  assert.deepEqual(suggestPieceMappings('e4 e5 ¤e2'),{});
  assert.deepEqual(parseChessText('1.e4 e5 2.¤e2',undefined,false,{'¤':'B'})[0].moves,['e4','e5','Be2']);
  assert.deepEqual(customPieceSymbols('1.exd5 Nf6 2.Nc3 cxd5'),[]);
});
test('the supplied book line retains all ten white and black moves',()=>{
  const line=parseChessText(bookLine)[0];
  assert.equal(line.moves.length,20);
  assert.equal(line.candidates,20);
  assert.equal(line.issue,'');
  assert.equal(line.moves.at(-1),'Nf6');
  assert.equal(parseChessText(bookLine.replace('exd5 ♘f6','exd5♘f6'))[0].moves.length,20);
  assert.equal(parseChessText(bookLine.replaceAll('♘','♘ '))[0].moves.length,20);
});

test('unknown PDF font glyphs cannot turn a truncated prefix into high confidence',()=>{
  for(const glyph of ['¤','\uFFFD','\uE123','§','X']) {
    const line=parseChessText(bookLine.replace('♘f6',`${glyph}${glyph==='X'?'':' '}f6`))[0];
    assert.equal(line.moves.length,5);
    assert.equal(line.candidates,20);
    assert.equal(line.confidence,'low');
    assert.match(line.issue,/Unrecognized PDF piece symbol/);
    assert.match(line.raw,/Re1 Nf6$/);
  }
});

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
