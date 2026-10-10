import test from 'node:test';
import assert from 'node:assert/strict';
import { createHealthDashboardCache } from '../src/health-dashboard-cache.mjs';

test('health prefetch is shared, revisits are immediate and stale data refreshes', async () => {
  let calls = 0, time = 1000;
  const cache = createHealthDashboardCache(async () => ({ entries: [++calls] }), () => time);
  const first = cache.load('account-session');
  assert.equal(cache.load('account-session'), first);
  await first;
  assert.deepEqual(cache.read('account-session'), { entries: [1] });
  await cache.load('account-session');
  assert.equal(calls, 1);
  time += 30001;
  const refresh = cache.load('account-session');
  assert.deepEqual(cache.read('account-session'), { entries: [1] });
  await refresh;
  assert.equal(calls, 2);
});

test('saving beats older pending responses and changing session never leaks data', async () => {
  let resolve;
  const cache = createHealthDashboardCache(() => new Promise(done => { resolve = done; }));
  const pending = cache.load('a');
  cache.write('a', { entries: ['saved'] });
  resolve({ entries: ['old'] });
  assert.deepEqual(await pending, { entries: ['saved'] });
  assert.equal(cache.read('b'), null);
  const other = cache.load('b');
  cache.clear();
  resolve({ entries: ['private'] });
  assert.equal(await other, null);
  assert.equal(cache.read('b'), null);
});

test('failed health loads can retry', async () => {
  let calls = 0;
  const cache = createHealthDashboardCache(async () => {
    if (++calls === 1) throw new Error('offline');
    return { entries: [] };
  });
  await assert.rejects(cache.load('a'), /offline/);
  assert.deepEqual(await cache.load('a'), { entries: [] });
});
