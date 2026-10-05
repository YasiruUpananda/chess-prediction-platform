import test from 'node:test';
import assert from 'node:assert/strict';
import {Chess} from 'chess.js';
import {textBlocks,parseTextBlocks,regionBlocks,symbolKey,resolveLineAnchor} from './chessPdf.js';
import {buildBookTree,mergeBookTrees,nodeAt,treeNotation} from './bookReplay.js';
const fen=new Chess().fen();
const item=(str,x,y,fontName='g_d0_f1')=>({str,fontName,transform:[12,0,0,12,x,y],width:str.length*7,height:12,hasEOL:true});
test('document geometry survives region filtering and font keys survive reopen',()=>{
  const blocks=textBlocks([item('1.e4 e5',10,100),item('1.d4 d5',200,100)],400,15);
  const selected=regionBlocks(blocks,{x:0,y:90,width:110,height:30});
  assert.equal(selected[0].items[0].page,15);
  assert.equal(selected[0].items[0].fontSize,12);
  assert.equal(selected[0].items[0].rawText,'1.e4 e5');
  assert.deepEqual(parseTextBlocks(selected,fen)[0].moves,['e4','e5']);
  assert.equal(symbolKey('g_d0_f1','X'),symbolKey('g_d99_f1','X'));
  assert.notEqual(symbolKey('g_d0_f1','X'),symbolKey('g_d0_f2','X'));
});
test('next-page prose can anchor to earlier variations and ambiguous positions require confirmation',()=>{
  const first=parseTextBlocks(textBlocks([item('1.e4 e5 2.Nf3 (2.Bc4 Nf6) Nc6',10,100)],600,1),fen);
  const tree=buildBookTree(first,first[0],fen);
  const next=parseTextBlocks(textBlocks([item('The alternative 3.d3',10,100)],600,2),fen,{},treeNotation(tree));
  const unresolved=next.find(line=>line.anchorOptions);
  assert.equal(unresolved.anchorOptions.length,2);
  const branch=unresolved.anchorOptions.find(option=>option.prefix.includes('Bc4'));
  const resolved=resolveLineAnchor(unresolved,branch,fen);
  assert.deepEqual(resolved.moves,['e4','e5','Bc4','Nf6','d3']);
});
test('cross-page continuations retain earlier branches, parent positions and comments',()=>{
  const first=parseTextBlocks(textBlocks([item('1.e4 e5 {Central play} 2.Nf3 (2.Bc4 Nc6) Nc6',10,100)],600,1),fen);
  const next=parseTextBlocks(textBlocks([item('3.Bb5 a6 The alternative 3...Nf6',10,100)],600,2),fen,{},'1.e4 e5 2.Nf3 Nc6');
  const tree=mergeBookTrees(buildBookTree(first,first[0],fen),buildBookTree(next,next[0],fen));
  assert.equal(tree.children[0].parentFen,fen);
  assert.ok(tree.children[0].children[0].comments.includes('Central play'));
  assert.deepEqual(nodeAt(tree,['e2e4','e7e5']).children.map(node=>node.san).sort(),['Bc4','Nf3']);
  assert.deepEqual(nodeAt(tree,['e2e4','e7e5','g1f3','b8c6','f1b5']).children.map(node=>node.san).sort(),['Nf6','a6']);
  assert.equal(tree.children[0].sources[0].page,1);
});
