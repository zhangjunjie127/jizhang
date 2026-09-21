import assert from 'node:assert/strict';
import { CHECKIN_INSTRUCTIONS, parseCheckIn } from '../server/proactive.mjs';
import { systemPrompt } from '../server/domain.mjs';

const base = process.env.CPA_BASE_URL?.replace(/\/$/, '');
const key = process.env.CPA_API_KEY;
assert.ok(base && key, 'Configure CPA_BASE_URL and CPA_API_KEY in the environment');
const user = { name: '测试用户', persona: 'gentle', birthday: '2000-01-01', relationship: 'friend' };
const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
const cases = [
  {
    name: 'missing-ledger', candidates: [{ id: `ledger:${date}`, kind: 'missing-ledger', date }],
    recentMessages: [{ role: 'user', created: `${date}T08:00:00+08:00`, text: '晚上空下来帮我看看有没有漏记的账吧。' }], expected: null,
  },
  {
    name: 'already-answered', candidates: [{ id: `ledger:${date}`, kind: 'missing-ledger', date }],
    recentMessages: [{ role: 'user', text: '今天没有任何收入支出，不用再问记账了。' }], expected: 'skip',
  },
  {
    name: 'task-done-in-chat', candidates: [{ id: 'task:fixture', kind: 'task-followup', record: { payload: { title: '提交报告' }, completed: 0 } }],
    recentMessages: [{ role: 'user', text: '报告已经交了，系统里我还没来得及勾完成。' }], expected: 'skip',
  },
];
for (const item of cases) {
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST', signal: AbortSignal.timeout(75000),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.CPA_TEXT_MODEL || 'gpt-5.5', reasoning_effort: 'low', max_completion_tokens: 1400,
      messages: [
        { role: 'system', content: systemPrompt(user, { recentMessages: item.recentMessages }) },
        { role: 'system', content: CHECKIN_INSTRUCTIONS },
        { role: 'system', content: `以下仅为虚构验收场景。模拟北京时间为 ${date} 20:00，最近一条用户消息在今天早上08:00，频率和免打扰检查已通过。请按这个模拟时间判断，仍允许 skip。` },
        { role: 'user', content: JSON.stringify({ candidates: item.candidates, recentMessages: item.recentMessages }) },
      ],
    }),
  });
  assert.ok(response.ok, `Provider HTTP ${response.status}`);
  const result = await response.json();
  const decision = parseCheckIn(result.choices?.[0]?.message?.content, item.candidates);
  if (item.expected) assert.equal(decision ? 'send' : 'skip', item.expected, item.name);
  console.log(JSON.stringify({ case: item.name, decision: decision ? 'send' : 'skip', text: decision?.text }));
}
