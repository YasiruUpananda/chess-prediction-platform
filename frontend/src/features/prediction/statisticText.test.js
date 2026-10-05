import test from 'node:test';
import assert from 'node:assert/strict';
import { statisticText } from './statisticText.js';
test('verified facts use SQL counts and interpret results from the player color',()=>{
  assert.equal(statisticText({type:'result',color:'black',result:'1-0',games:7}),'black: loss in 7 games');
  assert.equal(statisticText({type:'result',color:'black',result:'0-1',games:2}),'black: win in 2 games');
  assert.equal(statisticText({type:'opening',line:'e4 e5',games:18}),'e4 e5: played in 18 games');
});
