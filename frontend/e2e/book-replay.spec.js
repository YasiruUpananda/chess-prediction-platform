import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';

function fivePageFixture() {
  const text='BT /F1 14 Tf 10 160 Td (1.e4 e5 2.Nf3 Nc6) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R 6 0 R 7 0 R] /Count 5 >>',
    ...Array.from({length:5},()=> '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 8 0 R >> >> /Contents 9 0 R >>'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${text.length} >>\nstream\n${text}\nendstream`];
  let pdf='%PDF-1.4\n';const offsets=[];
  objects.forEach((object,index)=>{offsets.push(pdf.length);pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=pdf.length;
  return Buffer.from(pdf+`xref\n0 10\n0000000000 65535 f \n${offsets.map(offset=>String(offset).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 10 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
}

test('PDF page navigation stays on the selected page and supports direct jumps',async({page})=>{
  await page.route('**/api/v1/studies',route=>route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:{studies:[]}}));
  await page.goto('/reader');
  await page.getByLabel('Choose a PDF to read').setInputFiles({name:'five-pages.pdf',mimeType:'application/pdf',buffer:fivePageFixture()});
  const toolbar=page.locator('.pdf-toolbar');
  await expect(toolbar).toContainText('Page 1 of 5');
  await toolbar.getByRole('button',{name:'Next'}).click();
  await expect(toolbar).toContainText('Page 2 of 5');
  await expect(page.locator('.react-pdf__Page')).toHaveAttribute('data-page-number','2');
  await toolbar.getByRole('button',{name:'Next'}).click();
  await expect(page.locator('.react-pdf__Page')).toHaveAttribute('data-page-number','3');
  await page.getByLabel('Go to page').fill('5');
  await page.getByLabel('Go to page').press('Enter');
  await expect(page.locator('.react-pdf__Page')).toHaveAttribute('data-page-number','5');
  await expect(toolbar.getByRole('button',{name:'Next'})).toBeDisabled();
  await toolbar.getByRole('button',{name:'Previous'}).click();
  await expect(page.locator('.react-pdf__Page')).toHaveAttribute('data-page-number','4');
  await page.getByLabel('Go to page').fill('6');
  await toolbar.getByRole('button',{name:'Go',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Enter a page number from 1 to 5.');
  await expect(toolbar).toContainText('Page 4 of 5');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
});

function pdfFixture(moves='1.e4 e5 2.Nf3 Nc6') {
  const text=`BT /F1 14 Tf 10 160 Td (${moves}) Tj ET`;
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${text.length} >>\nstream\n${text}\nendstream`];
  let pdf='%PDF-1.4\n';const offsets=[];
  objects.forEach((object,index)=>{offsets.push(pdf.length);pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=pdf.length;
  return Buffer.from(pdf+`xref\n0 6\n0000000000 65535 f \n${offsets.map(offset=>String(offset).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
}

test('commentary and prose alternatives form a replayable game tree',async({page})=>{
  await page.route('**/api/v1/studies',route=>route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:{studies:[]}}));
  await page.goto('/reader');
  await page.getByLabel('Choose a PDF to read').setInputFiles({name:'commentary.pdf',mimeType:'application/pdf',buffer:pdfFixture('1.e4 e5 Commentary. 2.Nf3 Nc6 The alternative 2...Nf6 is playable.')});
  await expect(page.locator('.reader-move-chip')).toHaveCount(4);
  await expect(page.getByLabel('Choose main line or variation').locator('option')).toHaveCount(2);
  await page.getByRole('button',{name:'Load reviewed line'}).click();
  const replay=page.getByRole('region',{name:'Book move replay'});
  await replay.locator('.reader-move-chip').last().click();
  const choices=page.getByRole('dialog',{name:'Choose a variation'});
  await expect(choices.getByRole('button',{name:'Nf6 · Variation',exact:true})).toBeVisible();
  await choices.getByRole('button',{name:'Nf6 · Variation',exact:true}).click();
  await expect(replay).toContainText('4 / 4 plies');
});

test('ambiguous prose continuation asks which earlier game to use',async({page})=>{
  await page.route('**/api/v1/studies',route=>route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:{studies:[]}}));
  await page.goto('/reader');
  await page.getByLabel('Choose a PDF to read').setInputFiles({name:'ambiguous.pdf',mimeType:'application/pdf',buffer:pdfFixture('1.e4 e5 2.Nf3 Nc6 1.d4 d5 2.Nf3 Nc6 Commentary. 2...Nf6')});
  await expect(page.getByLabel('Choose main line or variation').locator('option')).toHaveCount(3);
  await page.getByLabel('Choose main line or variation').selectOption('2');
  await page.getByRole('button',{name:'Game 2: d4 d5 Nf3',exact:true}).click();
  await expect(page.getByLabel('Review and correct moves')).toHaveValue('d4 d5 Nf3 Nf6');
  await expect(page.locator('.reader-move-chip')).toHaveCount(4);
});

test('reader and board shrink after desktop-to-mobile viewport changes',async({page})=>{
  await page.route('**/api/v1/studies',route=>route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:{studies:[]}}));
  await page.setViewportSize({width:1440,height:1000});await page.goto('/reader');
  await expect(page.getByTestId('responsive-board').locator('[data-boardid]')).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await page.getByLabel('Choose a PDF to read').setInputFiles({name:'resize.pdf',mimeType:'application/pdf',buffer:pdfFixture()});
  await expect(page.locator('.reader-move-chip')).toHaveCount(4);
  await page.setViewportSize({width:1440,height:1000});
  await page.setViewportSize({width:390,height:844});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
});

test('custom font characters can be confirmed as pieces and recover all twenty plies',async({page})=>{
  await page.route('**/api/v1/studies',route=>route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:{studies:[]}}));
  await page.goto('/reader');
  const encoded='1.c4 c6 2.e4 d5 3.exd5 Xf6 4.Xc3 cxd5 5.cxd5 Xxd5 6.Xf3 e6 7.Yc4 Xc6 8.0-0 Ye7 9.d4 0-0 10.Ze1 Xf6';
  await page.getByLabel('Choose a PDF to read').setInputFiles({name:'custom-font.pdf',mimeType:'application/pdf',buffer:pdfFixture(encoded)});
  await expect(page.locator('.reader-move-chip')).toHaveCount(5);
  await expect(page.getByLabel('Extracted symbol “X”', {exact:false})).toHaveValue('N');
  await expect(page.getByLabel('Extracted symbol “Y”', {exact:false})).toHaveValue('B');
  await expect(page.getByRole('img',{name:/Printed X symbol in font/})).toBeVisible();
  await page.getByLabel('Extracted symbol “Z”', {exact:false}).selectOption('R');
  await page.getByRole('button',{name:'Apply piece symbols to this book'}).click();
  await expect(page.locator('.reader-move-chip')).toHaveCount(20);
  await page.getByRole('button',{name:'Load reviewed line'}).click();
  await page.getByRole('region',{name:'Book move replay'}).locator('.reader-move-chip').last().click();
  await expect(page.getByRole('region',{name:'Book move replay'})).toContainText('20 / 20 plies');
});

test('book replay sits under the board, pauses for nested choices and supports arrows',async({page})=>{
  await page.route('**/api/v1/studies',route=>route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:{studies:[]}}));
  await page.goto('/reader');
  await page.getByLabel('Choose a PDF to read').setInputFiles({name:'branches.pdf',mimeType:'application/pdf',buffer:pdfFixture()});
  await expect(page.locator('.reader-move-chip')).toHaveCount(4);
  const editor=page.getByLabel('Review and correct moves');
  await editor.fill('1.♙e4 (1.♙d4 d5) e5 (1...c5 (1...e6)) 2.♘f3 ♞c6');
  await page.getByRole('button',{name:'Validate corrections'}).click();
  await page.getByRole('button',{name:'Load reviewed line'}).click();
  const replay=page.getByRole('region',{name:'Book move replay'});
  await expect(replay.locator('.reader-move-chip')).toHaveCount(4);
  expect(await replay.evaluate(element=>element.previousElementSibling.classList.contains('reader-board-frame'))).toBeTruthy();
  await replay.focus();
  await page.keyboard.press('ArrowRight');
  const choice=page.getByRole('dialog',{name:'Choose a variation'});
  await expect(choice).toBeVisible();
  await expect(replay).toContainText('0 / 4 plies');
  await choice.getByRole('button',{name:'e4 · Main line',exact:true}).click();
  await expect(replay).toContainText('1 / 4 plies');
  await page.keyboard.press('ArrowRight');
  await expect(choice.getByRole('button',{name:'c5 · Variation',exact:true})).toBeVisible();
  await expect(choice.getByRole('button',{name:'e6 · Variation',exact:true})).toBeVisible();
  await choice.getByRole('button',{name:'c5 · Variation',exact:true}).click();
  await expect(replay).toContainText('2 / 2 plies');
  await page.keyboard.press('ArrowLeft');
  await expect(replay).toContainText('1 / 2 plies');
  await editor.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(replay).toContainText('1 / 2 plies');
  await replay.focus();
  await page.keyboard.press('ArrowRight');
  await choice.getByRole('button',{name:'e5 · Main line',exact:true}).click();
  await expect(replay).toContainText('2 / 4 plies');
  await page.keyboard.press('ArrowRight');
  await expect(replay).toContainText('3 / 4 plies');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
  await page.getByRole('button',{name:'Use current board as start'}).click();
  await expect(replay).toContainText('0 / 0 plies');
  await expect(page.getByRole('heading',{name:'Try the position'})).toBeVisible();
});
function twoPageStudy() {
  const texts=['1.e4 e5 2.Nf3 Nc6','3.Bb5 a6 The alternative 3...Nf6'];
  const streams=texts.map(text=>`BT /F1 14 Tf 10 160 Td (${text}) Tj ET`);
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',...streams.map(text=>`<< /Length ${text.length} >>\nstream\n${text}\nendstream`)];
  let pdf='%PDF-1.4\n';const offsets=[];
  objects.forEach((object,index)=>{offsets.push(pdf.length);pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=pdf.length;
  return Buffer.from(pdf+`xref\n0 8\n0000000000 65535 f \n${offsets.map(offset=>String(offset).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
}

test('cross-page game, printed highlights and local session survive reopening',async({page})=>{
  await page.route('**/api/v1/studies',route=>route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:{studies:[]}}));
  const file={name:'cross-page-study.pdf',mimeType:'application/pdf',buffer:twoPageStudy()};
  await page.goto('/reader');await page.getByLabel('Choose a PDF to read').setInputFiles(file);
  await expect(page.locator('.reader-move-chip')).toHaveCount(4);
  await page.getByRole('button',{name:'Load reviewed line'}).click();
  await page.locator('.reader-move-chip').last().click();
  await expect(page.locator('.pdf-source-highlight.is-move')).toBeVisible();
  const printed=await page.locator('.react-pdf__Page__textContent span').first().boundingBox();
  const marked=await page.locator('.pdf-source-highlight.is-move').boundingBox();
  expect(Math.abs(printed.y-marked.y)).toBeLessThan(15);
  await page.locator('.pdf-toolbar').getByRole('button',{name:'Next'}).click();
  await page.getByRole('button',{name:'Continue previous game'}).click();
  await expect(page.getByLabel('Review and correct moves')).toHaveValue('e4 e5 Nf3 Nc6 Bb5 a6');
  await page.getByRole('button',{name:'Load reviewed line'}).click();
  await expect(page.locator('.reader-move-chip')).toHaveCount(6);
  await page.locator('.reader-move-chip').last().click();
  await page.getByRole('dialog',{name:'Choose a variation'}).getByRole('button',{name:'Nf6 \u00B7 Variation',exact:true}).click();
  await expect(page.getByRole('region',{name:'Book move replay'})).toContainText('6 / 6 plies');
  await page.getByLabel('Review and correct moves').fill('e4 e5 Nf3 Nc6 Bb5 Nf6');
  await page.getByRole('button',{name:'Validate corrections'}).click();
  await expect.poll(()=>page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const req=indexedDB.open('neurochess-reader');req.onsuccess=()=>resolve(req.result);});
    return new Promise(resolve=>{const req=db.transaction('documents').objectStore('documents').getAll();req.onsuccess=()=>{const saved=req.result[0];db.close();resolve(saved?.pageNumber===2 && saved?.cursor===6 && saved?.pages?.[2]?.editor==='e4 e5 Nf3 Nc6 Bb5 Nf6');};});
  })).toBeTruthy();
  await page.reload();await page.getByLabel('Choose a PDF to read').setInputFiles(file);
  await expect(page.locator('.pdf-toolbar')).toContainText('Page 2 of 2');
  await expect(page.getByLabel('Review and correct moves')).toHaveValue('e4 e5 Nf3 Nc6 Bb5 Nf6');
  await expect(page.getByRole('region',{name:'Book move replay'})).toContainText('6 / 6 plies');
  await page.getByRole('button',{name:'Forget local reading progress'}).click();
  await expect(page.getByLabel('Choose a PDF to read')).toBeVisible();
  await expect.poll(()=>page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const request=indexedDB.open('neurochess-reader');request.onsuccess=()=>resolve(request.result);});
    return new Promise(resolve=>{const request=db.transaction('documents').objectStore('documents').count();request.onsuccess=()=>{db.close();resolve(request.result);};});
  })).toBe(0);
});

test('separate printed games stay separate and the earlier game remains available',async({page})=>{
  await page.route('**/api/v1/studies',route=>route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:{studies:[]}}));
  await page.goto('/reader');await page.getByLabel('Choose a PDF to read').setInputFiles({name:'separate-games.pdf',mimeType:'application/pdf',buffer:pdfFixture('1.e4 e5 2.Nf3 Nc6 1.d4 d5 2.c4 e6')});
  await expect(page.locator('.reader-move-chip')).toHaveCount(4);
  await page.getByRole('button',{name:'Load reviewed line'}).click();
  await page.getByLabel('Choose main line or variation').selectOption('1');
  await page.getByRole('button',{name:'Load reviewed line'}).click();
  await page.locator('.reader-move-chip').first().click();
  await expect(page.getByRole('dialog',{name:'Choose a variation'})).toHaveCount(0);
  await expect(page.getByLabel('Earlier document games')).toBeVisible();
  await expect(page.locator('.reader-move-chip').first()).toContainText('d4');
});

test('selected notation region is cropped before OCR and uses single-line mode',async({page})=>{
  await page.route('**/api/v1/studies',route=>route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:{studies:[]}}));
  let submitted=null;
  await page.route('**/api/v1/extract-page-image',async route=>{
    submitted=route.request().postDataBuffer().toString('latin1');
    await route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:{job_id:'region-test',status:'completed',result:{text:'1.e4 e5 2.Nf3 Nc6',text_items:[],ocr_confidence:90}}});
  });
  await page.goto('/reader');await page.getByLabel('Choose a PDF to read').setInputFiles({name:'region.pdf',mimeType:'application/pdf',buffer:pdfFixture()});
  await expect(page.locator('.reader-move-chip')).toHaveCount(4);
  await page.getByRole('button',{name:'Select a move line',exact:true}).click();
  await page.locator('.pdf-region-selector').scrollIntoViewIfNeeded();
  const bounds=await page.locator('.pdf-region-selector').boundingBox();
  await page.mouse.move(bounds.x+3,bounds.y+5);await page.mouse.down();
  await page.mouse.move(bounds.x+bounds.width*.48,bounds.y+bounds.height*.45);await page.mouse.up();
  await expect(page.locator('.pdf-source-highlight')).toBeVisible();
  await expect(page.getByRole('button',{name:'OCR selected region'})).toBeEnabled();
  await page.getByLabel('Selected OCR layout').selectOption('line');
  await page.getByRole('button',{name:'OCR selected region'}).click();
  await expect.poll(()=>submitted).not.toBeNull();
  expect(submitted).toContain('name="mode"\r\n\r\nline');
  await expect(page.locator('.reader-move-chip')).toHaveCount(4);
});
