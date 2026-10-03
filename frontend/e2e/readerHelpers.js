export async function readerPane(page,name) {
  const tab=page.getByRole('tab',{name,exact:true});
  if(await tab.isVisible())await tab.click();
}
export async function readerTools(page) {
  if(!await page.getByRole('dialog',{name:'Extraction tools',exact:true}).isVisible())await page.getByRole('button',{name:'Extraction tools',exact:true}).click();
}
export async function closeReaderTools(page) {
  if(await page.getByRole('dialog',{name:'Extraction tools',exact:true}).isVisible())await page.getByRole('button',{name:'Close tools',exact:true}).click();
}
export async function boardControls(page) {
  await readerPane(page,'Board');
  const details=page.locator('.reader-more-controls');
  if(!await details.count())return;
  if(await details.getAttribute('open')===null)await details.locator('summary').click();
}
