import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceCall } from '../src/voice.js';

test('voice approval acknowledgment waits for playback to drain and never follows an interruption', () => {
  const events = [];
  const call = new VoiceCall({ onEvent() {}, onState() {}, onError() {} });
  call.send = event => events.push(event);
  call.receive({ type: 'response.created' });
  call.sources.add({});
  call.receive({ type: 'app.approval_playback', id: 'first' });
  call.receive({ type: 'response.done' });
  assert.equal(events.length, 0);
  call.sources.clear();
  call.approvalHeard();
  assert.deepEqual(events, [{ type: 'app.approval_heard', id: 'first' }]);
  call.approvalHeard();
  assert.equal(events.length, 1);
  call.receive({ type: 'response.created' });
  call.receive({ type: 'app.approval_playback', id: 'interrupted' });
  call.interrupt(false);
  call.receive({ type: 'response.done' });
  assert.equal(events.length, 1);
});
