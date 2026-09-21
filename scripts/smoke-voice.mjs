import { WebSocket } from 'ws';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const cpa = (process.env.CPA_BASE_URL || '').replace(/\/$/, '');
const key = process.env.CPA_API_KEY;
const app = process.env.TEST_URL || 'http://127.0.0.1:8787';
if (!cpa || !key) throw new Error('Set CPA credentials in the environment.');
assert(process.env.TEST_USERNAME && process.env.TEST_PASSWORD, 'Set TEST_USERNAME and TEST_PASSWORD.');
const login = await fetch(`${app}/api/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: process.env.TEST_USERNAME, password: process.env.TEST_PASSWORD }),
}).then(r => r.json());
assert.ok(login.token);

const sample = await new Promise((resolve, reject) => {
  const ws = new WebSocket(`${cpa.replace(/^http/, 'ws')}/realtime?model=gpt-realtime-2.1`, { headers: { Authorization: `Bearer ${key}` } });
  const chunks = [];
  const timer = setTimeout(() => { ws.terminate(); reject(new Error('Sample generation timed out')); }, 30000);
  ws.on('error', reject);
  ws.on('message', raw => {
    const event = JSON.parse(raw.toString());
    if (event.type === 'session.created') ws.send(JSON.stringify({
      type: 'response.create',
      response: { instructions: '请只用自然中文念出这句话，不回答，不加任何字：你好，我今天有点累，想听你说两句。', output_modalities: ['audio'] },
    }));
    if (['response.output_audio.delta', 'response.audio.delta'].includes(event.type)) chunks.push(Buffer.from(event.delta, 'base64'));
    if (event.type === 'error') { clearTimeout(timer); ws.terminate(); reject(new Error(JSON.stringify(event.error))); }
    if (event.type === 'response.done') { clearTimeout(timer); ws.close(); resolve(Buffer.concat(chunks)); }
  });
});
assert.ok(sample.length > 0);
const silence = Buffer.alloc(24000 * 2);
const audio = Buffer.concat([silence, sample, silence]);
mkdirSync('artifacts', { recursive: true });
const header = Buffer.alloc(44);
header.write('RIFF'); header.writeUInt32LE(audio.length + 36, 4); header.write('WAVEfmt ', 8);
header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28); header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(audio.length, 40);
writeFileSync('artifacts/synthetic-input.wav', Buffer.concat([header, audio]));

const result = await new Promise((resolve, reject) => {
  const ws = new WebSocket(`${app.replace(/^http/, 'ws')}/voice`);
  const report = { ready: false, inputTranscript: '', outputTranscript: '', outputBytes: 0 };
  let feeder, offset = 0;
  const finish = (error) => { clearTimeout(timer); clearInterval(feeder); ws.close(); error ? reject(error) : resolve(report); };
  const timer = setTimeout(() => finish(new Error(`App voice timeout: ${JSON.stringify(report)}`)), 45000);
  ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: login.token })));
  ws.on('error', finish);
  ws.on('message', raw => {
    const event = JSON.parse(raw.toString());
    if (event.type === 'app.ready') {
      report.ready = true;
      feeder = setInterval(() => {
        if (offset >= audio.length) { clearInterval(feeder); return; }
        const chunk = audio.subarray(offset, offset + 4800);
        offset += chunk.length;
        ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: chunk.toString('base64') }));
      }, 100);
    }
    if (event.type === 'conversation.item.input_audio_transcription.completed') report.inputTranscript = event.transcript;
    if (['response.output_audio.delta', 'response.audio.delta'].includes(event.type)) report.outputBytes += Buffer.from(event.delta, 'base64').length;
    if (['response.output_audio_transcript.delta', 'response.audio_transcript.delta'].includes(event.type)) report.outputTranscript += event.delta;
    if (event.type === 'app.error' || event.type === 'error') finish(new Error(JSON.stringify(event)));
    if (event.type === 'response.done' && report.outputBytes && report.inputTranscript) finish();
  });
});
console.log(JSON.stringify(result, null, 2));
assert.ok(result.ready && result.inputTranscript && result.outputBytes > 0);
