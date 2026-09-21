import { WebSocket } from 'ws';

const base = (process.env.CPA_BASE_URL || '').replace(/\/$/, '');
const key = process.env.CPA_API_KEY;
const model = process.env.CPA_VOICE_MODEL || 'gpt-realtime-2.1';
if (!base || !key) throw new Error('Set CPA_BASE_URL and CPA_API_KEY in the environment.');
const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/realtime?model=${encodeURIComponent(model)}`, {
  headers: { Authorization: `Bearer ${key}` },
});
const report = { model, connected: false, audioBytes: 0, transcript: '', cancelled: false };
const started = Date.now();
let requested = false, cancelSent = false;
const timer = setTimeout(() => { report.error = 'Timeout'; finish(1); }, 30000);
function finish(code) {
  clearTimeout(timer);
  console.log(JSON.stringify(report, null, 2));
  socket.terminate();
  process.exitCode = code;
}
socket.on('error', error => { report.error = error.message; finish(1); });
socket.on('message', raw => {
  const event = JSON.parse(raw.toString());
  if (event.type === 'session.created') {
    report.connected = true;
    report.interruptResponse = event.session.audio?.input?.turn_detection?.interrupt_response;
    socket.send(JSON.stringify({
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions: 'Speak Mandarin Chinese. This is a short audio transport test.',
        audio: { input: { transcription: { model: 'gpt-4o-mini-transcribe', language: 'zh' } } },
      },
    }));
  } else if (event.type === 'session.updated' && !requested) {
    requested = true;
    socket.send(JSON.stringify({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '请用中文从一缓慢数到二十。' }] },
    }));
    socket.send(JSON.stringify({ type: 'response.create' }));
  } else if (['response.output_audio.delta', 'response.audio.delta'].includes(event.type)) {
    report.audioBytes += Buffer.from(event.delta, 'base64').length;
    if (!report.firstAudioMs) report.firstAudioMs = Date.now() - started;
    if (!cancelSent && report.audioBytes > 24000) {
      cancelSent = true;
      socket.send(JSON.stringify({ type: 'response.cancel' }));
    }
  } else if (['response.output_audio_transcript.delta', 'response.audio_transcript.delta'].includes(event.type)) {
    report.transcript += event.delta;
  } else if (event.type === 'response.done') {
    report.cancelled = event.response?.status === 'cancelled';
    report.status = event.response?.status;
    report.usage = event.response?.usage;
    finish(report.audioBytes > 0 ? 0 : 1);
  } else if (event.type === 'error') {
    report.error = event.error;
    finish(1);
  }
});
