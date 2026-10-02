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

test('custom font characters can be confirmed as pieces and recover all twenty plies',async({page})=>{
  await page.route('**/api/v1/studies',route=>route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:{studies:[]}}));
  await page.goto('/reader');
  const encoded='1.c4 c6 2.e4 d5 3.exd5 Xf6 4.Xc3 cxd5 5.cxd5 Xxd5 6.Xf3 e6 7.Yc4 Xc6 8.0-0 Ye7 9.d4 0-0 10.Ze1 Xf6';
  await page.getByLabel('Choose a PDF to read').setInputFiles({name:'custom-font.pdf',mimeType:'application/pdf',buffer:pdfFixture(encoded)});
  await expect(page.locator('.reader-move-chip')).toHaveCount(5);
  await expect(page.getByLabel('Extracted symbol “X”', {exact:false})).toHaveValue('N');
  await expect(page.getByLabel('Extracted symbol “Y”', {exact:false})).toHaveValue('B');
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
