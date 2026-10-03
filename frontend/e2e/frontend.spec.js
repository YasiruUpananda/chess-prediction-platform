import {readerPane,closeReaderTools,boardControls} from './readerHelpers.js';
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';

const report = {
  opponent:'Alice',context:'',color:'any',supporting_games:1,available_games:3,
  statistics:[{id:'sample',type:'sample',games:3,game_ids:['g1']}],sources:[{id:'g1',white:'Alice',black:'Bob',pgn:'1. e4 e5 *',result:'1-0',date:'2026.01.01',event:'Test',eco:'Unknown',timecontrol:'Unknown'}],
  report:{profile:[{text:'Cited profile',confidence:'supported',source_game_ids:['g1'],statistic_ids:['sample']}],tendencies:[],weaknesses:[],recommendations:[],limitations:['Small test sample']},
};
async function fixture(page,{moveDelay=0,reportDelay=0,unauthorized=false}={}) {
  const counts={players:0,moves:0,reports:0};
  await page.route('**/api/v1/**',async (route) => {
    const request=route.request();
    const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
    if(request.method()==='OPTIONS') return route.fulfill({status:204,headers});
    if(request.url().endsWith('/studies')) return route.fulfill({headers,json:{studies:[]}});
    if(request.url().endsWith('/players')) {
      counts.players++;
      return route.fulfill({headers,json:{players:[{name:'Alice',games:3},{name:'Bob',games:8}]}});
    }
    if(request.url().endsWith('/predict-move')) {
      counts.moves++;
      if(moveDelay) await new Promise((resolve)=>setTimeout(resolve,moveDelay));
      return route.fulfill({status:unauthorized?401:200,headers,json:unauthorized?{detail:'expired'}:{success:true,san_move:'e5',confidence:.3,matching_games:3,observed_games:1,candidates:[],engine:{status:'unavailable'}}}).catch(()=>{});
    }
    if(request.url().endsWith('/predict-strategy/stream')) {
      counts.reports++;
      if(reportDelay) await new Promise((resolve)=>setTimeout(resolve,reportDelay));
      return route.fulfill({headers,contentType:'application/x-ndjson',body:JSON.stringify({type:'complete',result:report})+'\n'}).catch(()=>{});
    }
    return route.fulfill({status:404,headers,json:{detail:'Unexpected test request'}});
  });
  return counts;
}
async function noOverflow(page) {
  const wide = await page.evaluate(()=>Array.from(document.querySelectorAll('*')).filter(el=>el.getBoundingClientRect().right>window.innerWidth+1).map(el=>({tag:el.tagName,cls:el.className,width:el.getBoundingClientRect().width})));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1), JSON.stringify(wide)).toBeTruthy();
}

test('production home defers auth, chess and PDF and serves compressed cached assets',async({page})=>{
  const requests=[];
  page.on('request',(request)=>{if(/\/assets\/.*\.js$/.test(request.url()))requests.push(request.url().split('/').at(-1));});
  await page.goto('http://127.0.0.1:4173/');
  await expect(page.getByRole('heading',{name:/See the game/})).toBeVisible();
  await noOverflow(page);
  const profile=JSON.parse(readFileSync('performance/bundle-current.json','utf8'));
  for(const name of requests) {
    const chunk=profile.find((item)=>item.file.endsWith(name));
    expect(chunk).toBeTruthy();
    expect(Object.keys(chunk.packages).some((dependency)=>/asgardeo|chess|pdf|redux/i.test(dependency))).toBeFalsy();
  }
  const asset=profile.find((item)=>item.entry).file;
  const headers=await page.request.get('http://127.0.0.1:4173/'+asset,{headers:{'Accept-Encoding':'gzip'}});
  expect(headers.headers()['content-encoding']).toBe('gzip');
  expect(headers.headers()['cache-control']).toContain('immutable');
  expect((await page.request.get('http://127.0.0.1:4173/')).headers()['cache-control']).toBe('no-cache');
});

test('responsive board, keyboard moves and cached player navigation',async({page})=>{
  const counts=await fixture(page);
  await page.goto('/predict');
  await expect(page.getByLabel('Opponent',{exact:true})).toHaveValue('Alice');
  const board=page.getByTestId('responsive-board');
  await expect(board).toBeVisible();
  expect((await board.boundingBox()).width).toBeLessThanOrEqual(page.viewportSize().width);
  await closeReaderTools(page);await boardControls(page);
  await page.getByLabel('Play a move (SAN or UCI)').fill('e4');
  await closeReaderTools(page);await boardControls(page);
  await page.getByLabel('Play a move (SAN or UCI)').press('Enter');
  await expect(page.getByText('e5: played in 1 of 3 matching games.')).toBeVisible();
  await page.getByRole('button',{name:'Undo turn'}).click();
  await expect(page.getByText(/Game history \/ PGN \(0 plies\)/)).toBeVisible();
  await closeReaderTools(page);await boardControls(page);
  await page.getByRole('button',{name:'Flip board'}).click();
  await noOverflow(page);
  await page.getByRole('link',{name:'Neuro Chess home'}).click();
  await page.locator('.home-actions').getByRole('link',{name:'Open prediction engine',exact:true}).click();
  await expect(page.getByLabel('Opponent',{exact:true})).toHaveValue('Alice');
  expect(counts.players).toBe(1);
});

test('obsolete move and report responses cannot restore stale results',async({page})=>{
  const counts=await fixture(page,{moveDelay:600,reportDelay:600});
  await page.goto('/predict');
  await expect(page.getByLabel('Opponent',{exact:true})).toHaveValue('Alice');
  await closeReaderTools(page);await boardControls(page);
  await page.getByLabel('Play a move (SAN or UCI)').fill('e4');
  await closeReaderTools(page);await boardControls(page);
  await page.getByLabel('Play a move (SAN or UCI)').press('Enter');
  await expect(page.getByRole('button',{name:'Play move',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Reset game'}).click();
  await page.getByRole('button',{name:'Generate RAG Strategy'}).click();
  await page.getByLabel('Opening / Context').fill('Changed context');
  await page.waitForTimeout(800);
  await expect(page.getByText('Cited profile')).toHaveCount(0);
  await expect(page.getByText('e5: played in 1 of 3 matching games.')).toHaveCount(0);
  await expect(page.getByText(/Game history \/ PGN \(0 plies\)/)).toBeVisible();
  expect(counts.moves).toBeLessThanOrEqual(1);
});

test('report tabs support keyboard navigation and context changes clear reports',async({page})=>{
  await fixture(page); await page.goto('/predict');
  await expect(page.getByLabel('Opponent',{exact:true})).toHaveValue('Alice');
  await page.getByRole('button',{name:'Generate RAG Strategy'}).click();
  await expect(page.getByText('Cited profile')).toBeVisible();
  await expect(page.getByText('Verified statistic: 3 indexed games in this sample')).toBeVisible();
  await expect(page.getByText('AI interpretation · verify against the cited evidence')).toBeVisible();
  const profile=page.getByRole('tab',{name:/Player profile/});
  await profile.focus(); await profile.press('ArrowRight');
  await expect(page.getByRole('tab',{name:/Behavioral tendencies/})).toBeFocused();
  await expect(page.getByRole('tab',{name:/Behavioral tendencies/})).toHaveAttribute('aria-selected','true');
  await page.keyboard.press('End'); await expect(page.getByRole('tab',{name:/Recommendations/})).toBeFocused();
  await page.keyboard.press('Home'); await expect(profile).toBeFocused();
  await page.getByLabel('Opponent color').selectOption('black');
  await expect(page.getByRole('tab')).toHaveCount(0);
  await noOverflow(page);
});

test('authentication failures use one recovery action',async({page})=>{
  await fixture(page,{unauthorized:true}); await page.goto('/predict');
  await expect(page.getByLabel('Opponent',{exact:true})).toHaveValue('Alice');
  await closeReaderTools(page);await boardControls(page);
  await page.getByLabel('Play a move (SAN or UCI)').fill('e4');
  await closeReaderTools(page);await boardControls(page);
  await page.getByLabel('Play a move (SAN or UCI)').press('Enter');
  await expect(page.getByRole('button',{name:'Sign in again'})).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Play move',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Sign in again'}).click();
  expect(await page.evaluate(()=>sessionStorage.getItem('neuro-chess:reconnect'))).toBe('1');
});

test('reader defers PDF tools and supports keyboard study controls',async({page})=>{
  const requested=[]; page.on('request',(request)=>requested.push(request.url()));
  await page.goto('/reader');
  await expect(page.getByRole('heading',{name:'Interactive book reader'})).toBeVisible();
  expect(requested.some((url)=>url.includes('PdfDocumentView')||url.includes('pdf.worker'))).toBeFalsy();
  await closeReaderTools(page);await boardControls(page);
  await page.getByLabel('Play a move (SAN or UCI)').fill('e4');
  await closeReaderTools(page);await boardControls(page);
  await page.getByLabel('Play a move (SAN or UCI)').press('Enter');
  await expect(page.getByText('Black to move',{exact:true})).toBeVisible();
  await closeReaderTools(page);await readerPane(page,'Board');
  await page.getByRole('button',{name:'Previous move'}).click();
  await expect(page.getByText('White to move',{exact:true})).toBeVisible();
  await closeReaderTools(page);await readerPane(page,'Board');
  await page.getByRole('button',{name:'Next move'}).click();
  await closeReaderTools(page);await boardControls(page);
  const download=page.waitForEvent('download'); await page.getByRole('button',{name:'Export current PGN'}).click();
  expect((await download).suggestedFilename()).toBe('book-study.pgn');
  await closeReaderTools(page);await boardControls(page);
  await page.getByRole('button',{name:'Flip board'}).click();
  await noOverflow(page);
});

test('selecting a PDF loads its worker and extracts the numbered line', async ({ page }) => {
  const requested=[]; page.on('request',(request)=>requested.push(request.url()));
  await page.goto('/reader');
  // Small valid PDF created here avoids external fixtures or downloads.
  const text='BT /F1 10 Tf 10 160 Td (1.c4 c6 2.e4 d5 3.exd5 Nf6 4.Nc3 cxd5) Tj 0 -20 Td (5.cxd5 Nxd5 6.Nf3 e6 7.Bc4 Nc6 8.O-O Be7) Tj 0 -20 Td (9.d4 O-O 10.Re1 Nf6) Tj ET';
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
  ];
  let pdf='%PDF-1.4\n'; const offsets=[0];
  objects.forEach((object,index)=>{offsets.push(pdf.length);pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=pdf.length;
  pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset)=>String(offset).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await page.locator('input[type=file]').setInputFiles({name:'study.pdf',mimeType:'application/pdf',buffer:Buffer.from(pdf)});
  await expect(page.locator('.react-pdf__Page canvas')).toBeVisible();
  await expect(page.locator('.reader-move-chip')).toHaveCount(20);
  await expect(page.getByLabel('Choose main line or variation')).toContainText('20/20 validated plies');
  await closeReaderTools(page);await readerPane(page,'Board');
  await page.getByRole('button',{name:'Load reviewed line'}).click();
  await expect(page.getByRole('button',{name:'Next move',exact:true})).toBeEnabled();
  expect(requested.some((url)=>url.includes('pdf.worker'))).toBeTruthy();
  await noOverflow(page);
});

