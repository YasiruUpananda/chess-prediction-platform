import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Expand nested tests ourselves so Windows and POSIX shells discover the same suite.
const root = fileURLToPath(new URL('../src/', import.meta.url));
const files = readdirSync(root, { recursive: true })
  .filter(file => file.endsWith('.test.js'))
  .sort()
  .map(file => resolve(root, file));
if (!files.length) throw new Error('No frontend unit tests found');
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
