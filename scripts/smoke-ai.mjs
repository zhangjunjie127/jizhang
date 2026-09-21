import assert from 'node:assert/strict';
const base = process.env.TEST_URL || 'http://127.0.0.1:8787';
let token;
async function api(path, body, method = 'POST') {
  const response = await fetch(`${base}/api${path}`, {
    method, signal: AbortSignal.timeout(240000),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await response.json();
  assert.equal(response.status, 200, JSON.stringify(value));
  return value;
}
assert(process.env.TEST_USERNAME && process.env.TEST_PASSWORD, 'Set TEST_USERNAME and TEST_PASSWORD.');
token = (await api('/login', { username: process.env.TEST_USERNAME, password: process.env.TEST_PASSWORD })).token;
const memory = await api('/chat', { text: '我最近在赶一个项目，加班比较多。请记住：我累的时候不喜欢被责备，你先听我说，再陪我把事情拆小。简单回一句就好。' });
console.log('MEMORY:', JSON.stringify(memory.memories.map(m => m.text)));
console.log('REPLY:', memory.messages.at(-1).text);
assert.ok(memory.memories.length > 0, 'A real memory should be saved through the tool.');
const expense = await api('/chat', { text: '帮我记一笔今天的咖啡，18 元，餐饮支出。' });
const pending = expense.records.find(r => r.kind === 'expense' && r.status === 'pending' && r.payload.cents === 1800);
assert.ok(pending, 'The AI must create a pending proposal, not a confirmed expense.');
console.log('PROPOSAL:', JSON.stringify(pending.payload));
await api('/profile', { persona: 'witty' }, 'PATCH');
const switched = await api('/chat', { text: '换你来啦。你还记得我累的时候希望你怎么对我吗？' });
console.log('SWITCHED_REPLY:', switched.messages.at(-1).text);
assert.ok(switched.memories.length > 0);
await api('/profile', { persona: 'gentle' }, 'PATCH');
console.log('Live AI smoke test passed.');
