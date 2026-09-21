import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REMINDER_CHANNEL_ID, withReminderChannel } from '../src/reminder-notifications.mjs';

test('all reminder kinds use the existing shared system channel without per-item sound overrides', () => {
  const records = [
    { id: 1, title: 'Task', channelId: 'old-task', sound: 'custom.wav', schedule: { at: new Date('2026-09-21') } },
    { id: 2, title: 'Habit', extra: { habitId: 'h' } },
    { id: 3, title: 'Future reminder', channelId: 'other' },
  ];
  const result = withReminderChannel(records);
  for (const [index, item] of result.entries()) {
    assert.equal(item.channelId, 'default');
    assert.equal(item.id, records[index].id);
    assert.equal(item.title, records[index].title);
    assert.equal('sound' in item, false);
  }
  assert.equal(result[0].schedule, records[0].schedule);
  assert.equal(result[1].extra, records[1].extra);
  assert.equal(records[0].channelId, 'old-task');
  assert.equal(records[0].sound, 'custom.wav');
  assert.deepEqual(withReminderChannel([]), []);
});

test('native settings target the same channel and never delete it or change the device-wide ringtone', () => {
  const source = readFileSync(new URL('../android/app/src/main/java/cn/zaizai/companion/ReminderSoundPlugin.java', import.meta.url), 'utf8');
  assert(source.includes(`CHANNEL_ID = "${REMINDER_CHANNEL_ID}"`));
  assert(source.includes('Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS'));
  assert(source.includes('Settings.EXTRA_CHANNEL_ID'));
  assert(!source.includes('deleteNotificationChannel'));
  assert(!source.includes('setActualDefaultRingtoneUri'));
});
