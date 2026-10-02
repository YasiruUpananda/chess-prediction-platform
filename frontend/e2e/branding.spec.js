import { test, expect } from '@playwright/test';

async function navigation(page, name) {
  const menu = page.getByRole('button',{name:/^Menu/});
  if(await menu.isVisible()) await menu.click();
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name,exact:true}).click();
}

test('shared branded navigation reaches every tool and marks the active page',async({page})=>{
  await page.route('**/api/v1/**',route=>route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:route.request().url().endsWith('/players')?{players:[{name:'Alice',games:3}]}:{studies:[]}}));
  await page.goto('/');
  const hero = page.getByRole('img',{name:/silver knight/});
  await expect(hero).toBeVisible();
  expect(await hero.evaluate(image=>image.complete && image.naturalWidth===640)).toBeTruthy();
  await navigation(page,'Prediction engine');
  await expect(page.getByRole('heading',{name:'Make your move'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Play move',exact:true})).toBeEnabled();
  await expect(page.getByRole('navigation',{name:'Main navigation',includeHidden:true}).getByRole('link',{name:'Prediction engine',includeHidden:true})).toHaveAttribute('aria-current','page');
  await page.screenshot({path:`test-results/brand-predict-${test.info().project.name}.png`,fullPage:true});
  await navigation(page,'Book reader');
  await expect(page.getByRole('heading',{name:'Interactive book reader'})).toBeVisible();
  await expect(page).toHaveTitle('Book reader | NeuroChess');
  await expect(page.getByRole('navigation',{name:'Footer navigation'})).toBeVisible();
  await expect(page.getByLabel('Choose a PDF to read')).toBeAttached();
  await expect(page.locator('main')).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
  await page.screenshot({path:`test-results/brand-reader-${test.info().project.name}.png`,fullPage:true});
});

test('skip link, mobile menu dismissal and reduced motion support keyboard use',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link',{name:'Skip to content'})).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  const menu=page.locator('.menu-toggle');
  if(await menu.isVisible()) {
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded','true');
    await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Home',exact:true}).focus();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveAttribute('aria-expanded','false');
    await expect(menu).toBeFocused();
  }
  const transition = await page.locator('.home-primary-link').first().evaluate(element=>getComputedStyle(element).transitionDuration);
  expect(transition.split(',').every(value=>Number.parseFloat(value)<=.00001)).toBeTruthy();
  await page.goto('/');
  await expect(page.getByRole('heading',{name:/See the game/})).toBeVisible();
  await expect(page.getByRole('img',{name:/silver knight/})).toBeVisible();
  await page.getByRole('img',{name:/silver knight/}).evaluate(image=>image.decode());
  await page.screenshot({path:`test-results/brand-home-${test.info().project.name}.png`,fullPage:true});
});

test('unknown routes retain navigation and a useful recovery screen',async({page})=>{
  await page.goto('/not-a-page');
  await expect(page.getByRole('heading',{name:'Page not found'})).toBeVisible();
  await expect(page.getByRole('navigation',{name:'Main navigation',includeHidden:true})).toBeAttached();
  await page.getByRole('link',{name:'Return home'}).click();
  await expect(page.getByRole('heading',{name:/See the game/})).toBeVisible();
});

test('a failed tool download preserves navigation and recovers on another route',async({page})=>{
  await page.route('**/src/Dashboard.jsx',route=>route.abort('failed'));
  await page.route('**/api/v1/studies',route=>route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:{studies:[]}}));
  await page.goto('/predict');
  await expect(page.getByRole('heading',{name:'This page could not open'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Reload page'})).toBeVisible();
  await navigation(page,'Book reader');
  await expect(page.getByRole('heading',{name:'Interactive book reader'})).toBeVisible();
});
