import { defineConfig } from '@playwright/test';
import process from 'node:process';
import { existsSync } from 'node:fs';

const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
export default defineConfig({
  testDir:'./e2e', workers:1, timeout:30000,
  snapshotPathTemplate:'{testDir}/snapshots/{platform}/{projectName}/{arg}{ext}',
  use:{ baseURL:'http://127.0.0.1:4174', headless:true,
    launchOptions: { executablePath:process.env.BROWSER_PATH || (existsSync(edge) ? edge : undefined) } },
  projects:[{name:'desktop',use:{viewport:{width:1440,height:1000}}},{name:'mobile',use:{viewport:{width:390,height:844}}}],
  webServer:[
    {command:'node scripts/serve-production.mjs',port:4173,reuseExistingServer:!process.env.CI},
    {command:'npm run dev -- --mode browser-test --host 127.0.0.1 --port 4174 --strictPort',port:4174,reuseExistingServer:!process.env.CI},
  ],
});
