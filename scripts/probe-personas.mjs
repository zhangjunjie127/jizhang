import { mkdirSync, writeFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { PERSONAS, systemPrompt } from '../server/domain.mjs';

const base = (process.env.CPA_BASE_URL || '').replace(/\/$/, '');
const key = process.env.CPA_API_KEY;
const model = process.env.CPA_VOICE_MODEL || 'gpt-realtime-2.1';
if (!base || !key) throw new Error('Set CPA_BASE_URL and CPA_API_KEY.');
const input = '我今天又拖着没整理房间，不过心情还不错。你用自己的风格催我动一下，两三句话就好。';
mkdirSync('artifacts/personas', { recursive: true });

function sample(persona, config) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/realtime?model=${encodeURIComponent(model)}`,
      { headers: { Authorization: `Bearer ${key}` } });
    const chunks = [];
    let transcript = '', acceptedVoice, requested = false, finished = false;
    const timer = setTimeout(() => finish(new Error('Voice sample timed out')), 45000);
    function finish(error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.terminate();
      if (error) { reject(error); return; }
      const pcm = Buffer.concat(chunks);
      const header = Buffer.alloc(44);
      header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4);
      header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16);
      header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
      header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28);
      header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
      header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
      const file = `artifacts/personas/${persona}.wav`;
      writeFileSync(file, Buffer.concat([header, pcm]));
      resolve({ persona, voice: config.voice, acceptedVoice, audioBytes: pcm.length, transcript, file });
    }
    const send = event => socket.send(JSON.stringify(event));
    socket.on('error', finish);
    socket.on('close', () => { if (!finished) finish(new Error('Upstream closed before completion')); });
    socket.on('message', raw => {
      try {
        const event = JSON.parse(raw);
        if (event.type === 'session.created') {
          send({ type: 'session.update', session: {
            type: 'realtime', instructions: systemPrompt({ persona, relationship: 'friend' }, {}),
            output_modalities: ['audio'], max_output_tokens: 1800,
            audio: { output: { voice: config.voice, format: { type: 'audio/pcm', rate: 24000 } } },
          } });
        } else if (event.type === 'session.updated' && !requested) {
          requested = true;
          acceptedVoice = event.session?.audio?.output?.voice;
          if (acceptedVoice !== config.voice) throw new Error(`Voice mismatch: ${acceptedVoice}`);
          send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: input }] } });
          send({ type: 'response.create' });
        } else if (['response.output_audio.delta', 'response.audio.delta'].includes(event.type)) {
          chunks.push(Buffer.from(event.delta, 'base64'));
        } else if (['response.output_audio_transcript.delta', 'response.audio_transcript.delta'].includes(event.type)) {
          transcript += event.delta;
        } else if (event.type === 'response.done') {
          finish(event.response?.status === 'completed' && chunks.length && transcript ? undefined : new Error(`Incomplete sample: ${event.response?.status} ${JSON.stringify(event.response?.status_details)}`));
        } else if (event.type === 'error') {
          finish(new Error(event.error?.message || 'Upstream error'));
        }
      } catch (error) { finish(error); }
    });
  });
}

const results = [];
for (const [persona, config] of Object.entries(PERSONAS)) {
  const result = await sample(persona, config);
  results.push(result);
  console.log(JSON.stringify(result));
}
writeFileSync('artifacts/personas/report.json', JSON.stringify({
  model, input, created: new Date().toISOString(), perceptuallyVerified: false, results,
}, null, 2));
