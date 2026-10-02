import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';

function pdfFixture() {
  const text='BT /F1 14 Tf 10 160 Td (1.e4 e5 2.Nf3 Nc6) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${text.length} >>\nstream\n${text}\nendstream`];
  let pdf='%PDF-1.4\n';const offsets=[];
  objects.forEach((object,index)=>{offsets.push(pdf.length);pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=pdf.length;
  return Buffer.from(pdf+`xref\n0 6\n0000000000 65535 f \n${offsets.map(offset=>String(offset).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
}

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
