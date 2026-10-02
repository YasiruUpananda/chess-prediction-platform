import { Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import ReportContent from '../src/ReportContent';
import Baseline from './compiler-baseline';

// A stress fixture isolates rendering from API latency. No real games or users.
const sources = [{ id: 'game' }];
const results: Record<string, { updates: number; totalDurationMs: number }> = {};
for (const count of [4, 200]) {
const content = Array.from({ length: count }, (_, i) => ({ text: `Evidence ${i}`,
  confidence: 'supported' as const, source_game_ids: ['game'], statistic_ids: ['sample'] }));
for (const [name, Component] of [['baseline', Baseline], ['compiled', ReportContent]] as const) {
  const root = createRoot(document.getElementById(name)!);
  let duration = 0;
  const record = (_id: string, phase: string, actualDuration: number) => {
    if (phase === 'update') duration += actualDuration;
  };
  for (let i = 0; i <= 100; i++) {
    flushSync(() => root.render(<Profiler id={name} onRender={record}>
      <Component content={content} sources={sources} />
    </Profiler>));
  }
  results[`${name}-${count}-claims`] = { updates: 100, totalDurationMs: Math.round(duration * 100) / 100 };
  root.unmount();
}
}
Object.assign(window, { compilerProfile: results });
