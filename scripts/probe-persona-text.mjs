import { mkdirSync, writeFileSync } from 'node:fs';
import { PERSONAS, systemPrompt, tools } from '../server/domain.mjs';

// Synthetic conversations only; this probe never executes returned tools.
const base = process.env.CPA_BASE_URL?.replace(/\/$/, '');
const key = process.env.CPA_API_KEY;
if (!base || !key) throw new Error('Configure the backend AI credentials before running this probe.');
const model = process.env.CPA_TEXT_MODEL || 'gpt-5.5';
const inputs = [
  '我想买一个有点贵的咖啡机，预算够，但怕买回来闲置。你怎么看？',
  '今天很累，先不分析，也别催我做决定。我只想随便聊聊，回答短一点。',
];
const results = [];
for (const persona of Object.keys(PERSONAS)) {
  const history = [];
  const turns = [];
  for (const input of inputs) {
    try {
      const response = await fetch(`${base}/chat/completions`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, reasoning_effort: 'low', max_completion_tokens: 900,
          messages: [
            { role: 'system', content: systemPrompt({ persona, relationship: 'friend' }, {
              memories: [{ id: 'synthetic-memory', text: '不喜欢被叫宝贝', created: '2026-10-01' }],
              recentMessages: history,
            }) },
            { role: 'user', content: input },
          ],
          tools: tools.map(({ type, ...fn }) => ({ type, function: fn })), tool_choice: 'auto' }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const message = (await response.json()).choices?.[0]?.message;
      if (!message?.content && !message?.tool_calls?.length) throw new Error('Empty response');
      turns.push({ input, text: message.content, tools: message.tool_calls || [] });
      history.push({ role: 'user', text: input }, { role: 'assistant', text: message.content, persona });
    } catch (error) {
      turns.push({ input, error: error.message });
      break;
    }
  }
  results.push({ persona, name: PERSONAS[persona].name, turns });
  console.log(JSON.stringify(results.at(-1)));
}
mkdirSync('artifacts/personas', { recursive: true });
writeFileSync('artifacts/personas/text-report.json', JSON.stringify({
  model, created: new Date().toISOString(), synthetic: true, toolsExecuted: false,
  note: 'Samples require human review; API success does not establish personality quality or safety.',
  results,
}, null, 2));
if (results.some(r => r.turns.some(t => t.error))) process.exitCode = 1;
