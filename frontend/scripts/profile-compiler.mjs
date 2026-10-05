import { readFile, writeFile, unlink } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';

const baseline = new URL('../performance/compiler-baseline.tsx', import.meta.url);
const source = await readFile(new URL('../src/features/prediction/ReportContent.tsx', import.meta.url), 'utf8');
await writeFile(baseline, source.replace("'../../generated/api'", "'../src/generated/api'")
  .replace("'./statisticText'", "'../src/features/prediction/statisticText'")
  .replace("'use memo'", "'use no memo'"));
let server, browser;
try {
  server = await createServer({ mode: 'browser-test', server: { port: 4175, strictPort: true, host: '127.0.0.1' } });
  await server.listen();
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || (existsSync(edge) ? edge : undefined) });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:4175/performance/compiler-profile.html');
  await page.waitForFunction(() => window.compilerProfile);
  const result = await page.evaluate(() => window.compilerProfile);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close(); await server?.close(); await unlink(baseline);
}
