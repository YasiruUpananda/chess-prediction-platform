import test from 'node:test';
import assert from 'node:assert/strict';
import {Chess} from 'chess.js';
import {textBlocks,parseTextBlocks,symbolKey} from './chessPdf.js';
import {buildBookTree,addStudyMove,bookMainPath,exportBookPgn} from './bookReplay.js';
const fen=new Chess().fen();
test('mapped custom pieces retain their printed token identity',()=>{
 const item={str:'1. Xf3',fontName:'g_d7_f1',width:60,height:10,transform:[1,0,0,10,20,100]};
 const line=parseTextBlocks(textBlocks([item],600,15),fen,{[symbolKey(item.fontName,'X')]:'N'})[0];
 assert.deepEqual(line.moves,['Nf3']);assert.equal(line.moveSources[0].page,15);assert.ok(line.moveSources[0].tokenId);
});
test('a separately printed figurine and destination share a source highlight',()=>{
 const items=[{str:'1.',fontName:'g_d1_f0',width:8,height:10,transform:[1,0,0,10,10,100]},
 {str:'X',fontName:'g_d1_f1',width:10,height:10,transform:[1,0,0,10,20,100]},
 {str:'f3',fontName:'g_d1_f0',width:14,height:10,transform:[1,0,0,10,30,100]}];
 const line=parseTextBlocks(textBlocks(items,600,15),fen,{[symbolKey('g_d1_f1','X')]:'N'})[0];
 assert.deepEqual(line.moves,['Nf3']);assert.equal(line.moveSources[0].tokenIds.length,2);
});
test('exploration and full PGN export preserve printed alternatives and comments',()=>{
 const lines=parseTextBlocks([{column:1,text:'1.e4 {Central play} e5 2.Nf3 (2.Bc4 Nc6) Nc6'}],fen);
 const tree=buildBookTree(lines,lines[0],fen);
 const explored=addStudyMove(tree,fen,[], 'd4');
 assert.equal(tree.children.length,1);assert.equal(explored.tree.children.length,2);
 assert.deepEqual(bookMainPath(explored.tree),['e2e4','e7e5','g1f3','b8c6']);
 const pgn=exportBookPgn(explored.tree,fen);
 assert.match(pgn,/Central play/);assert.match(pgn,/Bc4/);assert.match(pgn,/\(1\. d4/);
});
