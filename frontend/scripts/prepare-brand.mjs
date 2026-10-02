// Preserve the supplied artwork; create only resized delivery assets.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import process from 'node:process';
const source = process.argv[2];
if (!source) throw new Error('Pass the path to the supplied PNG logo.');
const bytes = await readFile(source);
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || (existsSync(edge) ? edge : undefined) });
try {
  const page = await browser.newPage();
  await mkdir('public/brand', { recursive: true });
  for (const size of [64, 128, 640]) {
    const encoded = await page.evaluate(async ({data,size}) => {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
      canvas.getContext('2d').drawImage(image, 0, 0, size, size);
      return canvas.toDataURL('image/webp', .9).split(',')[1];
    }, {data:bytes.toString('base64'),size});
    await writeFile(`public/brand/neurochess-${size}.webp`, Buffer.from(encoded,'base64'));
  }
} finally { await browser.close(); }
