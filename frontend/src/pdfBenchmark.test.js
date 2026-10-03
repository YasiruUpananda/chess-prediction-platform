import test from 'node:test';
import assert from 'node:assert/strict';
import {gradePdfLines} from './pdfBenchmark.js';
test('benchmark penalizes legal truncation and wrong variation parent',()=>{
  const expected=[['e4','e5','Nf3','Nc6'],['e4','e5','Nf3','Nf6']];
  const actual=[{moves:['e4','e5'],rootId:0},{moves:expected[1],rootId:1,variation:true}];
  const grade=gradePdfLines(actual,expected,[{line:1,parent:0,prefix:['e4','e5','Nf3']}]);
  assert.equal(grade.completeLineAccuracy,.5);assert.equal(grade.variationAttachmentAccuracy,0);
});
