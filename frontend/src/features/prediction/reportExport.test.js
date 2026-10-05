import test from 'node:test';
import assert from 'node:assert/strict';
import { reportMarkdown } from './reportExport.js';

test('report export retains claims, evidence, limitations and reproducibility metadata',()=>{
  const output=reportMarkdown({opponent:'Player',supporting_games:1,available_games:3,statistics:[{id:'sample',games:3}],
    sources:[{id:'g1',white:'Player',black:'Other',pgn:'1. e4 e5 *'}],model:'test-model',data_version:'v1',prompt_version:'p1',
    report:{profile:[{text:'Observed pattern',confidence:'supported',source_game_ids:['g1'],statistic_ids:['sample']}],
      tendencies:[],weaknesses:[],recommendations:[],limitations:['Small sample']}});
  for(const expected of ['Observed pattern','g1','sample','Small sample','1. e4 e5 *','test-model','v1','p1']) assert.ok(output.includes(expected));
});
