import test from 'node:test';
import assert from 'node:assert/strict';
import { readReportStream } from './reportStream.js';

function response(parts) {
  return new Response(new ReadableStream({ start(controller) {
    for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
    controller.close();
  } }));
}

test('stream handles split frames and delivers statistics before report', async () => {
  const events = [];
  await readReportStream(response(['{"type":"stat', 'istics"}\n{"type":"complete","result":{}}\n']), (event) => events.push(event.type));
  assert.deepEqual(events, ['statistics', 'complete']);
});

test('stream errors and premature termination do not look like completed reports', async () => {
  await assert.rejects(readReportStream(response(['{"type":"error","detail":"Insufficient evidence"}\n']), () => {}), /Insufficient evidence/);
  await assert.rejects(readReportStream(response(['{"type":"progress"}\n']), () => {}), /before completion/);
});
