import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeMessages } from '../src/timeline.js';

const first = { id: 'first-call', role: 'assistant', text: '第一通电话', created: '2026-09-16T01:00:00Z', revision: 0 };
test('different calls share one chronological timeline without duplicates', () => {
  const second = { ...first, id: 'second-call', text: '第二通电话', created: '2026-09-16T02:00:00Z' };
  assert.deepEqual(mergeMessages([first], [second, first]), [first, second]);
});
test('late snapshots cannot overwrite newer streaming transcripts', () => {
  const updated = { ...first, text: '第一通电话的完整回复', revision: 3 };
  assert.deepEqual(mergeMessages([updated], [{ ...first, revision: 1 }]), [updated]);
  assert.deepEqual(mergeMessages([first], [updated]), [updated]);
});
test('delayed speech recognition is inserted before the answer', () => {
  const user = { ...first, id: 'user-voice', role: 'user', created: '2026-09-16T00:59:58Z' };
  assert.deepEqual(mergeMessages([first], [user]), [user, first]);
});
