import test from 'node:test';
import assert from 'node:assert/strict';
import { systemMessages } from '../src/system-messages.mjs';

test('system messages use actual events, preserve dates, sort newest first and do not invent empty notifications', () => {
  assert.deepEqual(systemMessages([], null), []);
  const items = systemMessages([{ id: 'f1', category: '功能建议', content: '增加消息提醒', created: '2026-09-18T08:00:00Z' }], {
    id: 'a1', status: 'rejected', reason: '需要补充确认信息', created: '2026-09-17T08:00:00Z', reviewed_at: '2026-09-19T08:00:00Z',
  });
  assert.deepEqual(items.map(item => item.id), ['deletion:a1:rejected', 'feedback:f1', 'deletion:a1:pending']);
  assert.equal(items[0].text, '需要补充确认信息');
  assert.equal(items[1].created, '2026-09-18T08:00:00Z');
  assert.equal(systemMessages([], { id: 'a1', status: 'pending', created: '2026-09-17T08:00:00Z' }).length, 1);
});
