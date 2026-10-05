import {test,expect} from '@playwright/test';
import {readerTools} from './readerHelpers';
test('reader workspace and tools match approved visual baselines',async({page})=>{
 await page.route('**/api/v1/studies',route=>route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:{studies:[]}}));
 await page.goto('/reader');
 await expect(page.getByRole('heading',{name:'Interactive book reader'})).toBeVisible();
 await expect(page.locator('.reader-shell')).toHaveScreenshot('reader-dark.png',{animations:'disabled',maxDiffPixelRatio:.01});
 await page.getByLabel('Reading theme').selectOption('paper');
 await expect(page.locator('.reader-shell')).toHaveScreenshot('reader-paper.png',{animations:'disabled',maxDiffPixelRatio:.01});
 await readerTools(page);
 await expect(page.getByRole('dialog',{name:'Extraction tools',exact:true})).toHaveScreenshot('reader-tools.png',{animations:'disabled',maxDiffPixelRatio:.01});
});
