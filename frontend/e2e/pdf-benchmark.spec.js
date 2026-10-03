import {readerPane,readerTools,closeReaderTools} from './readerHelpers.js';
import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import process from 'node:process';
import {gradePdfLines} from '../src/pdfBenchmark.js';
const manifest=process.env.PDF_BENCHMARK_MANIFEST;
const cases=manifest?JSON.parse(readFileSync(manifest,'utf8')).cases:[];
test('real PDF corpus complete-line and variation-attachment benchmark',async({page},testInfo)=>{
  test.skip(!manifest,'Set PDF_BENCHMARK_MANIFEST to a local, manually labelled real-book corpus.');
  test.setTimeout(180000*Math.max(1,cases.length));
  const results=[];
  for(const sample of cases) {
    await page.goto('/reader');
    await page.evaluate(async()=>{await new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase('neurochess-reader');request.onsuccess=resolve;request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Close other reader tabs before benchmarking.'));});});
    await page.getByLabel('Choose a PDF to read').setInputFiles(sample.file);
    await expect(page.locator('.pdf-toolbar')).toContainText('Page 1 of');
    if(sample.fen) {
  await readerTools(page);
      await page.getByLabel('Starting position FEN').fill(sample.fen);
  await readerTools(page);
      await page.getByRole('button',{name:'Apply FEN',exact:true}).click();
    }
    for(const contextPage of sample.contextPages || []) {
  await closeReaderTools(page);await readerPane(page,'Book');
      if(contextPage!==1) {await page.getByLabel('Go to page').fill(String(contextPage));await page.getByLabel('Go to page').press('Enter');}
  await closeReaderTools(page);await readerPane(page,'Book');
      if(await page.getByRole('button',{name:'Continue previous game'}).isVisible())await page.getByRole('button',{name:'Continue previous game'}).click();
      await closeReaderTools(page);await readerPane(page,'Board');
      await expect(page.getByRole('button',{name:/Load reviewed line|Load validated prefix/})).toBeEnabled({timeout:180000});
      await page.getByRole('button',{name:/Load reviewed line|Load validated prefix/}).click();
    }
  await closeReaderTools(page);await readerPane(page,'Book');
    if(sample.page!==1) {await page.getByLabel('Go to page').fill(String(sample.page));await page.getByLabel('Go to page').press('Enter');}
  await closeReaderTools(page);await readerPane(page,'Book');
    if(await page.getByRole('button',{name:'Continue previous game'}).isVisible())await page.getByRole('button',{name:'Continue previous game'}).click();
    await expect(page.getByLabel('Review and correct moves')).not.toHaveValue('');
    await readerTools(page);
    for(const [glyph,piece] of Object.entries(sample.pieces || {})) await page.getByLabel(`Extracted symbol “${glyph}”`,{exact:false}).selectOption(piece);
  await readerTools(page);
    if(Object.keys(sample.pieces || {}).length) await page.getByRole('button',{name:'Apply piece symbols to this book'}).click();
    if(sample.region) {
  await closeReaderTools(page);await readerPane(page,'Book');
      await page.getByRole('button',{name:'Select a move line',exact:true}).click();
      for(const [name,value] of Object.entries(sample.region))await page.getByLabel(name,{exact:true}).fill(String(value));
      await page.getByRole('button',{name:'Read this region',exact:true}).click();
    }
    if(sample.ocr) {
  await readerTools(page);
      if(sample.region && sample.ocrMode)await page.getByLabel('Selected OCR layout').selectOption(sample.ocrMode);
      await page.getByRole('button',{name:sample.region?'OCR selected region':'Try page OCR'}).click();
    }
    await closeReaderTools(page);await readerPane(page,'Notes');
    await expect(page.getByRole('button',{name:'Validate corrections'})).toBeEnabled({timeout:180000});
    // Read the same persisted structured results used to resume a real session.
    let actual=[];
    await expect.poll(async()=>{
      const saved=await page.evaluate(async pageNumber=>{
      const db=await new Promise(resolve=>{const request=indexedDB.open('neurochess-reader');request.onsuccess=()=>resolve(request.result);});
      return new Promise(resolve=>{const request=db.transaction('documents').objectStore('documents').getAll();request.onsuccess=()=>{const value=request.result[0]?.pages?.[pageNumber];db.close();resolve(value);};});
      },sample.page);
      const ready=saved && (!sample.ocr || saved.extractionInfo.source==='Page image OCR') &&
        Object.values(sample.pieces || {}).every(piece=>Object.values(saved.pieceMappings || {}).includes(piece));
      if(ready)actual=saved.lines;
      return Boolean(ready);
    },{timeout:180000}).toBeTruthy();
    results.push({name:sample.name,tags:sample.tags,...gradePdfLines(actual,sample.expected,sample.attachments)});
  }
  const totals=results.reduce((sum,value)=>({complete:sum.complete+value.completeLines,lines:sum.lines+value.totalLines,
    attached:sum.attached+value.attachedVariations,branches:sum.branches+value.totalVariations}),{complete:0,lines:0,attached:0,branches:0});
  await testInfo.attach('pdf-benchmark.json',{body:JSON.stringify({kind:'local PDF corpus',results,
    completeLineAccuracy:totals.lines?totals.complete/totals.lines:null,
    variationAttachmentAccuracy:totals.branches?totals.attached/totals.branches:null},null,2),contentType:'application/json'});
});
