import {test,expect} from '@playwright/test';
import {Buffer} from 'node:buffer';
import {readerPane,readerTools,closeReaderTools} from './readerHelpers.js';
function fixture() {
  const text='BT /F1 14 Tf 20 1320 Td (1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 Nf6 5.O-O Be7 6.Re1 b5 7.Bb3 d6 8.c3 O-O 9.h3) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1200 1400] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${text.length} >>\nstream\n${text}\nendstream`];
  let pdf='%PDF-1.4\n';const offsets=[];objects.forEach((object,index)=>{offsets.push(pdf.length);pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});const xref=pdf.length;
  return Buffer.from(pdf+`xref\n0 6\n0000000000 65535 f \n${offsets.map(offset=>String(offset).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
}
test('reader workspace supports comfortable viewing, mobile tabs and desktop split',async({page},testInfo)=>{
  await page.route('**/api/v1/studies',route=>route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:{studies:[]}}));
  await page.goto('/reader');
  await page.getByLabel('Choose a PDF to read').setInputFiles({name:'Workspace study.pdf',mimeType:'application/pdf',buffer:fixture()});
  await expect(page.locator('.reader-move-chip')).toHaveCount(17);
  await readerPane(page,'Book');
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();
  await expect(page.getByText('125%',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Fit width',exact:true}).click();
  await expect(page.getByText('100%',{exact:true})).toBeVisible();
  await page.getByLabel('Reading theme').selectOption('paper');
  await expect(page.locator('.reader-shell')).toHaveAttribute('data-reader-theme','paper');
  await readerTools(page);await expect(page.getByLabel('Starting position FEN')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'Extraction tools',exact:true})).not.toBeVisible();
  if(testInfo.project.name==='desktop') {
    const split=page.getByRole('separator',{name:'Resize PDF and board'});
    await split.focus();await page.keyboard.press('ArrowRight');await expect(split).toHaveAttribute('aria-valuenow','58');
    const before=await page.locator('.reader-board-frame').boundingBox();
    await page.locator('.pdf-page-stage').evaluate(element=>{element.scrollTop=400;});
    const after=await page.locator('.reader-board-frame').boundingBox();
    expect(Math.abs(before.y-after.y)).toBeLessThan(2);
  } else {
    await expect(page.getByRole('tab',{name:'Book',exact:true})).toHaveAttribute('aria-selected','true');
    await page.getByRole('tab',{name:'Book',exact:true}).focus();await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab',{name:'Board',exact:true})).toHaveAttribute('aria-selected','true');
    await expect(page.locator('.reader-document')).not.toBeVisible();
  }
  await readerPane(page,'Board');await page.getByRole('button',{name:'Load reviewed line',exact:true}).click();
  await page.locator('.reader-move-chip').last().click();
  await expect(page.getByRole('button',{name:'9. h3',exact:true})).toHaveAttribute('aria-current','step');
  const active=await page.locator('.reader-move-chip.is-current').boundingBox(),list=await page.locator('.reader-move-scroll').boundingBox();
  expect(active.y+active.height).toBeLessThanOrEqual(list.y+list.height+1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
  await readerPane(page,'Book');await page.getByRole('button',{name:'Fullscreen reader',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>Boolean(document.fullscreenElement))).toBeTruthy();
  await page.getByRole('button',{name:'Exit fullscreen',exact:true}).click();
  await closeReaderTools(page);
  await expect(page.locator('.react-pdf__Page__canvas')).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('reader-workspace.png'),fullPage:true});
});
