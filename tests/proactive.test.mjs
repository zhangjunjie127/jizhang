import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mayCheckIn, checkInCandidates, parseCheckIn, createCheckInRunner } from '../server/proactive.mjs';

const time = value => Date.parse(`2026-09-17T${value}:00+08:00`);
const stamp = value => new Date(time(value)).toISOString();
const baseState = () => ({
  user: { id: 'u', proactive: 1, quiet_until: null, last_checkin: null },
  records: [], memories: [],
  messages: [{ role: 'user', text: '今天有点忙', created: stamp('08:00') }],
});
const sent = (hour, topic = hour) => ({ status: 'sent', topic, created: stamp(hour) });
const task = (due, overrides = {}) => ({
  id: 'task1', kind: 'task', status: 'confirmed', completed: 0,
  payload: { title: '整理材料', due }, ...overrides,
});

test('check-in gate enforces quiet hours, pause, frequency, daily maximum and unanswered messages', () => {
  const state = baseState();
  assert.equal(mayCheckIn(state, [], time('10:00')), true);
  for (const hour of ['07:59', '21:00', '23:00']) assert.equal(mayCheckIn(state, [], time(hour)), false);
  assert.equal(mayCheckIn({ ...state, user: { ...state.user, proactive: 0 } }, [], time('10:00')), false);
  assert.equal(mayCheckIn({ ...state, user: { ...state.user, quiet_until: stamp('20:00') } }, [], time('10:00')), false);
  assert.equal(mayCheckIn(state, [sent('09:00')], time('12:00')), false);
  state.messages.push({ role: 'user', created: stamp('09:30') });
  assert.equal(mayCheckIn(state, [sent('09:00')], time('11:59')), false);
  assert.equal(mayCheckIn(state, [sent('09:00')], time('12:00')), true);
  state.messages.push({ role: 'user', created: stamp('16:00') });
  assert.equal(mayCheckIn(state, [sent('09:00'), sent('12:00'), sent('15:00')], time('19:00')), false);
  assert.equal(mayCheckIn(state, [], time('16:30')), false);
  assert.equal(mayCheckIn(state, [{ status: 'failed', created: stamp('18:50') }], time('19:00')), false);
});

test('candidates include due tasks, missing ledger and unplanned matters without treating drafts as missing', () => {
  const state = baseState();
  state.records.push(task(stamp('19:30')));
  const candidates = checkInCandidates(state, [], time('19:00'));
  assert.deepEqual(candidates.map(item => item.kind), ['task-upcoming', 'missing-ledger', 'unplanned']);
  assert.equal(checkInCandidates(state, [sent('10:00', candidates[0].id)], time('19:00')).some(item => item.kind === 'task-upcoming'), false);
  state.records.push({ kind: 'expense', status: 'pending', payload: { date: '2026-09-17' } });
  assert.equal(checkInCandidates(state, [], time('19:00')).some(item => item.kind === 'missing-ledger'), false);
  state.records[0].completed = 1;
  assert.equal(checkInCandidates(state, [], time('19:00')).some(item => item.kind.startsWith('task-')), false);
  state.records = [task('2026-08-01T10:00:00+08:00')];
  assert.equal(checkInCandidates(state, [], time('10:00')).length, 0);
});

test('AI decision fails closed for malformed JSON, fabricated topics and tool-like output', () => {
  assert.equal(parseCheckIn('{"action":"skip"}', []), null);
  assert.throws(() => parseCheckIn('hello', []));
  assert.throws(() => parseCheckIn('{"action":"send","topic":"fake","text":"hello"}', []));
  assert.throws(() => parseCheckIn('{"action":"propose_record"}', []));
});

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users (id TEXT PRIMARY KEY, proactive INTEGER, quiet_until TEXT, last_checkin TEXT)');
  db.prepare('INSERT INTO users VALUES (?,1,NULL,NULL)').run('u');
  t.after(() => db.close());
  const state = baseState();
  state.records.push(task(stamp('09:00')));
  let clock = time('10:00'), busy = false, calls = 0;
  let generator = async candidates => JSON.stringify({ action: 'send', topic: candidates[0].id, text: '材料这件事现在怎么样了？' });
  const options = {
    db,
    now: () => clock,
    isBusy: () => busy,
    snapshot: user => structuredClone({ ...state, user }),
    generate: async (_user, _state, candidates) => { calls++; return generator(candidates); },
    appendMessage: (_id, role, text, created) => {
      const item = { id: `m${state.messages.length}`, role, text, created };
      state.messages.push(item);
      return item;
    },
  };
  return {
    db, state, options, run: createCheckInRunner(options),
    logs: () => db.prepare('SELECT * FROM checkins ORDER BY created,id').all(),
    setGenerator: fn => { generator = fn; },
    setBusy: value => { busy = value; },
    setTime: value => { clock = time(value); },
    calls: () => calls,
  };
}

test('runner persists topic/quota across recreation and never modifies records', async t => {
  const f = fixture(t);
  const records = structuredClone(f.state.records);
  await f.run({ id: 'u' });
  assert.equal(f.logs()[0].status, 'sent');
  assert.equal(f.state.messages.at(-1).role, 'assistant');
  assert.deepEqual(f.state.records, records);
  f.setTime('14:00');
  f.state.messages.push({ role: 'user', created: stamp('12:00'), text: '弄好了' });
  await createCheckInRunner(f.options)({ id: 'u' });
  assert.equal(f.calls(), 1, 'Same task is not re-asked even after runner restart');
});

test('overlapping ticks generate at most once', async t => {
  const f = fixture(t);
  let resolve;
  f.setGenerator(candidates => new Promise(done => { resolve = () => done(JSON.stringify({ action: 'send', topic: candidates[0].id, text: '进展怎样？' })); }));
  const first = f.run({ id: 'u' });
  await f.run({ id: 'u' });
  assert.equal(f.calls(), 1);
  resolve();
  await first;
  assert.equal(f.logs().filter(item => item.status === 'sent').length, 1);
});

test('new conversation, edits, calls or disabled proactive mode during generation cancel delivery', async t => {
  for (const change of ['chat', 'record', 'call', 'disable']) {
    await t.test(change, async t => {
      const f = fixture(t);
      f.setGenerator(async candidates => {
        if (change === 'chat') f.state.messages.push({ role: 'user', text: '别问了', created: stamp('10:00') });
        if (change === 'record') f.state.records[0].completed = 1;
        if (change === 'call') f.setBusy(true);
        if (change === 'disable') f.db.exec('UPDATE users SET proactive=0');
        return JSON.stringify({ action: 'send', topic: candidates[0].id, text: '进展怎样？' });
      });
      await f.run({ id: 'u' });
      assert.equal(f.logs()[0].status, 'skipped');
      assert.equal(f.state.messages.some(item => item.role === 'assistant'), false);
    });
  }
});

test('model skip or errors never persist a synthetic message or consume a sent quota', async t => {
  for (const result of ['{"action":"skip"}', 'not json']) {
    await t.test(result, async t => {
      const f = fixture(t);
      f.setGenerator(async () => result);
      await f.run({ id: 'u' });
      assert.equal(f.logs().filter(item => item.status === 'sent').length, 0);
      assert.equal(f.state.messages.length, 1);
    });
  }
});
