import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readerTools} from './readerHelpers';
test('reader themes and tools have no serious accessibility violations',async({page})=>{
 await page.route('**/api/v1/studies',route=>route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:{studies:[]}}));
 await page.goto('/reader');
 for(const theme of ['dark','paper']) {
  await page.getByLabel('Reading theme').selectOption(theme);
  const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(result.violations.filter(item=>['serious','critical'].includes(item.impact))).toEqual([]);
 }
 await readerTools(page);
 const drawer=await new AxeBuilder({page}).include('.reader-tools').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
 expect(drawer.violations.filter(item=>['serious','critical'].includes(item.impact))).toEqual([]);
});
