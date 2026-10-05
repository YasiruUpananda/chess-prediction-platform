import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestJson, configureAuthentication } from './api.js';

test('deadlines include a stalled token provider and never send a request', async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; };
  try {
    await assert.rejects(requestJson('/test', { timeout: 20, getAccessToken: () => new Promise(() => {}) }), (error) => error.status === 408);
    assert.equal(requests, 0);
  } finally { globalThis.fetch = original; }
});

test('external cancellation during token acquisition prevents network work', async () => {
  const controller = new AbortController();
  const result = requestJson('/test', { signal: controller.signal, getAccessToken: () => new Promise(() => {}) });
  controller.abort();
  await assert.rejects(result, { name: 'AbortError' });
});

test('shared requests attach authentication and normalize 401 without replaying mutations', async () => {
  const original = globalThis.fetch;
  const cleanup = configureAuthentication(async () => 'test-token');
  let requests = 0;
  globalThis.fetch = async (_url, options) => {
    requests++;
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.equal(options.body, JSON.stringify({ move: 'e4' }));
    return new Response(JSON.stringify({ detail: 'expired' }), { status: 401 });
  };
  try {
    await assert.rejects(requestJson('/test', { method: 'POST', body: { move: 'e4' } }), (error) => error.status === 401 && error.message.includes('Sign in again'));
    assert.equal(requests, 1);
  } finally { cleanup(); globalThis.fetch = original; }
});
