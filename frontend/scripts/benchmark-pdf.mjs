import {readFileSync} from 'node:fs';
import {Chess} from 'chess.js';
import {parseChessText,parseTextBlocks,textBlocks} from '../src/features/reader/chessPdf.js';
import {gradePdfLines} from '../src/features/reader/pdfBenchmark.js';
const corpus=JSON.parse(readFileSync(new URL('../benchmarks/pdf/fixtures.json',import.meta.url),'utf8'));
const cases=corpus.cases.map(sample=>({name:sample.name,...gradePdfLines(
  sample.items?parseTextBlocks(textBlocks(sample.items,sample.pageWidth,1),new Chess().fen()):
  parseChessText((sample.prefix || '')+' '+sample.text,new Chess().fen(),false,sample.mappings),sample.expected,sample.attachments)}));
const totals=cases.reduce((total,result)=>({complete:total.complete+result.completeLines,lines:total.lines+result.totalLines,
  attached:total.attached+result.attachedVariations,variations:total.variations+result.totalVariations}),{complete:0,lines:0,attached:0,variations:0});
console.log(JSON.stringify({kind:corpus.kind,cases,completeLineAccuracy:totals.complete/totals.lines,
  variationAttachmentAccuracy:totals.attached/totals.variations},null,2));
if(totals.complete!==totals.lines || totals.attached!==totals.variations) process.exitCode=1;
