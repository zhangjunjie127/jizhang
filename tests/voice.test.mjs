import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';

test('calls share persisted history; typing and confirming records work during a call', { timeout: 20000 }, async () => {
  const upstream = createServer();
  const upstreamSockets = new WebSocketServer({ server: upstream });
  const instructions = [];
  const voices = [];
  const toolOutputs = [];
  let callNumber = 0;
  upstreamSockets.on('connection', socket => {
    const number = ++callNumber;
    socket.send(JSON.stringify({ type: 'session.created' }));
    socket.on('message', raw => {
      const event = JSON.parse(raw);
      if (event.type === 'conversation.item.create' && event.item.type === 'function_call_output') toolOutputs.push(JSON.parse(event.item.output));
      if (event.type === 'session.update') {
        instructions.push(event.session.instructions);
        if (event.session.audio?.output) voices.push(event.session.audio.output.voice);
        socket.send(JSON.stringify({ type: 'session.updated' }));
      }
      if (event.type === 'response.create') {
        socket.send(JSON.stringify({ type: 'response.created' }));
        const item = { item_id: `assistant-${number}` };
        socket.send(JSON.stringify({ ...item, type: 'response.output_audio_transcript.delta', delta: '本次回复' }));
        socket.send(JSON.stringify({ ...item, type: 'response.output_audio_transcript.delta', delta: ` ${number}` }));
        socket.send(JSON.stringify({ ...item, type: 'response.output_audio_transcript.done', transcript: `本次回复 ${number}` }));
        socket.send(JSON.stringify({ type: 'response.done', response: { status: 'completed', output: [], usage: { total_tokens: 0 } } }));
      }
    });
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const directory = mkdtempSync(join(tmpdir(), 'zaizai-voice-test-'));
  const child = spawn(process.execPath, ['server/index.mjs'], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DATA_DIR: directory, INVITE_CODE: 'voice-test',
      CPA_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1`, CPA_API_KEY: 'test-fixture-only' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let token;
  const sockets = [];
  async function api(path, body, method = 'POST') {
    const response = await fetch(`${base}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(response.status < 300, true, await response.clone().text());
    return response.json();
  }
  function waitEvent(socket, predicate) {
    return new Promise((resolve, reject) => {
      const listener = raw => {
        const event = JSON.parse(raw);
        if (event.type === 'app.error') { cleanup(); reject(new Error(event.message)); }
        else if (predicate(event)) { cleanup(); resolve(event); }
      };
      const timer = setTimeout(() => { cleanup(); reject(new Error('Voice test event timeout')); }, 5000);
      function cleanup() { clearTimeout(timer); socket.off('message', listener); }
      socket.on('message', listener);
    });
  }
  async function connect() {
    const socket = new WebSocket(base.replace('http', 'ws') + '/voice');
    sockets.push(socket);
    const ready = waitEvent(socket, event => event.type === 'app.ready');
    socket.on('open', () => socket.send(JSON.stringify({ type: 'auth', token })));
    await ready;
    return socket;
  }
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup timeout')), 6000);
      child.stdout.on('data', data => { if (data.toString().includes('Zaizai server:')) { clearTimeout(timer); resolve(); } });
      child.once('error', reject);
    });
    token = (await api('/register', { username: 'voice-test', password: 'test-password-123', name: 'Tester', birthday: '2000-01-01', invite: 'voice-test' })).token;
    const first = await connect();
    const firstReply = waitEvent(first, event => event.type === 'app.message' && event.message.revision === 2);
    first.send(JSON.stringify({ type: 'app.text', text: '第一通电话的文字输入' }));
    const reply = (await firstReply).message;
    assert.equal(reply.text, '本次回复 1');
    first.close();
    await new Promise(resolve => first.once('close', resolve));
    await api('/profile', { persona: 'blunt' }, 'PATCH');
    const second = await connect();
    assert.ok(instructions.at(-1).includes('第一通电话的文字输入'));
    assert.ok(instructions.at(-1).includes('本次回复 1'));
    const proposed = await api('/records', { kind: 'expense', payload: { amount: 12, title: '通话中记账' } });
    await api(`/records/${proposed.proposed.id}/confirm`, {});
    await api('/profile', { proactive: false }, 'PATCH');
    const secondReply = waitEvent(second, event => event.type === 'app.message' && event.message.revision === 2);
    second.send(JSON.stringify({ type: 'app.text', text: '第二通电话继续聊' }));
    await secondReply;
    const state = await api('/state', undefined, 'GET');
    assert.equal(state.messages.filter(message => message.role !== 'event').length, 4);
    assert.ok(state.messages.some(message => message.id === reply.id));
    assert.equal(state.records[0].status, 'confirmed');
    assert.deepEqual(state.messages.filter(message => message.role === 'user').map(message => message.text),
      ['第一通电话的文字输入', '第二通电话继续聊']);
    second.close();
    await new Promise(resolve => second.once('close', resolve));
    await api('/profile', { persona: 'witty' }, 'PATCH');
    const third = await connect();
    assert.deepEqual(voices, ['sage', 'ash', 'verse']);
    assert.ok(instructions.at(-1).includes('第二通电话继续聊'));
    for (const prompt of instructions) assert.ok(prompt.includes('标准普通话'));
    async function tool(name, args, callId) {
      const changed = waitEvent(third, event => event.type === 'app.records_changed');
      [...upstreamSockets.clients].at(-1).send(JSON.stringify({
        type: 'response.function_call_arguments.done', name, call_id: callId, arguments: JSON.stringify(args),
      }));
      await changed;
      return api('/state', undefined, 'GET');
    }
    const batch = await tool('propose_records', { records: [28, 6, 42].map(amount => ({ kind: 'expense', amount, title: `voice-${amount}` })) }, 'batch-1');
    assert.equal(batch.records.filter(r => r.status === 'pending').length, 3);
    const target = batch.records.find(r => r.payload.title === 'voice-28');
    const corrected = await tool('revise_pending_record', { id: target.id, revision: 0, changes: { amount: 18 } }, 'correct-1');
    assert.equal(corrected.records.find(r => r.id === target.id).payload.cents, 1800);
    assert.equal(corrected.records.find(r => r.id === target.id).status, 'pending');
    const badBatch = await tool('propose_records', { records: [{ kind: 'expense', amount: 1 }, { kind: 'expense', amount: -1 }] }, 'batch-invalid');
    assert.equal(badBatch.records.length, corrected.records.length);
    await api(`/records/${target.id}/confirm`, { revision: 1 });
    const forbidden = await tool('revise_pending_record', { id: target.id, revision: 2, changes: { amount: 99 } }, 'correct-forbidden');
    assert.equal(forbidden.records.find(r => r.id === target.id).payload.cents, 1800);
    assert.ok(toolOutputs.some(output => output.error));
    const loan = await api('/debts', { personName: '语音张三', direction: 'receivable', amount: 1000,
      date: '2026-01-01', dueDate: '2026-12-31', requestId: randomUUID() });
    const repayment = await tool('propose_debt_repayment', { personName: '语音张三', amount: 500, date: '2026-09-16' }, 'repayment-voice');
    const draft = repayment.records.find(record => record.kind === 'debt_repayment');
    assert.equal(draft.status, 'pending');
    const sameDraft = await tool('propose_debt_repayment', { personName: '语音张三', amount: 500, date: '2026-09-16' }, 'repayment-voice-repeat');
    assert.equal(sameDraft.records.filter(record => record.kind === 'debt_repayment').length, 1);
    const wrongTool = await tool('propose_record', { kind: 'expense', direction: 'income', amount: 500, category: '债务', title: '语音张三还款' }, 'repayment-wrong-tool');
    assert.equal(wrongTool.records.filter(record => record.kind === 'expense' && record.payload.title === '语音张三还款').length, 0);
    assert.equal((await api('/debts', undefined, 'GET')).payments.length, 0);
    const result = await api(`/records/${draft.id}/confirm-debt`, { billId: loan.billId, billRevision: 0, revision: 0, amount: 500, date: '2026-09-16' });
    assert.equal(result.debtState.bills[0].balanceCents, 50000);
    assert.equal(result.debtState.payments[0].date, '2026-09-16');
    assert.equal(result.records.filter(record => record.source === 'debt-repayment').length, 1);
    const replayed = waitEvent(third, event => event.type === 'response.function_call_arguments.done' && event.call_id === 'repayment-voice');
    [...upstreamSockets.clients].at(-1).send(JSON.stringify({ type: 'response.function_call_arguments.done', name: 'propose_debt_repayment',
      call_id: 'repayment-voice', arguments: JSON.stringify({ personName: '语音张三', amount: 500, date: '2026-09-16' }) }));
    await replayed;
    const duplicate = await api('/state', undefined, 'GET');
    assert.equal(duplicate.records.filter(record => record.kind === 'debt_repayment').length, 1, 'Repeated voice tool event must not create another draft');

    const edited = await tool('prepare_app_action', { operation: 'update_record', id: target.id, revision: 2,
      data: { amount: 25 } }, 'prepare-confirmed-edit');
    const authorization = edited.assistantAction;
    assert.ok(authorization);
    assert.equal(edited.records.find(r => r.id === target.id).payload.amount, 18);
    await tool('execute', { id: authorization.id, confirmed: true }, 'model-cannot-authorize');
    assert.equal((await api('/state', undefined, 'GET')).records.find(r => r.id === target.id).payload.amount, 18);
    const remote = [...upstreamSockets.clients].at(-1);
    const sendRemote = event => remote.send(JSON.stringify(event));
    const early = waitEvent(third, event => event.type === 'app.message' && event.message.role === 'event' && event.message.text.includes('没有已核对'));
    sendRemote({ type: 'input_audio_buffer.speech_started', item_id: 'early-confirm' });
    sendRemote({ type: 'input_audio_buffer.speech_stopped', item_id: 'early-confirm' });
    sendRemote({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'early-confirm', transcript: '确认。' });
    await early;
    assert.equal((await api('/state', undefined, 'GET')).records.find(r => r.id === target.id).payload.amount, 18);
    const playback = waitEvent(third, event => event.type === 'app.approval_playback');
    sendRemote({ type: 'response.created' });
    sendRemote({ type: 'response.output_audio_transcript.done', item_id: 'full-summary', transcript: authorization.summary });
    sendRemote({ type: 'response.done', response: { status: 'completed', output: [] } });
    await playback;
    const ready = waitEvent(third, event => event.type === 'app.approval_ready');
    third.send(JSON.stringify({ type: 'app.approval_heard', id: authorization.id }));
    await ready;
    const executed = waitEvent(third, event => event.type === 'app.message' && event.message.role === 'event' && event.message.text.startsWith('已执行'));
    sendRemote({ type: 'input_audio_buffer.speech_started', item_id: 'valid-confirm' });
    sendRemote({ type: 'input_audio_buffer.speech_stopped', item_id: 'valid-confirm' });
    sendRemote({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'valid-confirm', transcript: '确认执行。' });
    await executed;
    assert.equal((await api('/state', undefined, 'GET')).records.find(r => r.id === target.id).payload.amount, 25);
    sendRemote({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'valid-confirm', transcript: '确认执行。' });
    const final = await api('/state', undefined, 'GET');
    assert.equal(final.records.find(r => r.id === target.id).revision, 3);
    assert.equal(final.messages.filter(m => m.role === 'user' && m.text === '确认执行。').length, 1);
  } finally {
    for (const socket of sockets) socket.terminate();
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill(); await exited;
    for (const socket of upstreamSockets.clients) socket.terminate();
    await new Promise(resolve => upstreamSockets.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
