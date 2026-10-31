import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PERSONAS, systemPrompt } from '../server/domain.mjs';
import { GREETING_INSTRUCTIONS, repeatsGreeting } from '../server/greetings.mjs';
import { parseCheckIn } from '../server/proactive.mjs';

const base = process.env.CPA_BASE_URL?.replace(/\/$/, '');
const key = process.env.CPA_API_KEY;
assert.ok(base && key, 'Configure backend AI credentials.');
const results = [];
for (const persona of Object.keys(PERSONAS)) {
  const history = [];
  for (const mode of ['first-day', 'next-day', 'opt-out']) {
    const context = {
      memories: [{ text: '不喜欢被催促，不喜欢被叫宝贝' }],
      recentMessages: mode === 'opt-out' ? [{ role: 'user', text: '不要主动问候我，也不要打扰。' }] : [],
    };
    const candidates = [{ id: `greeting:synthetic-${mode}`, kind: 'daily-greeting' }];
    try {
      const response = await fetch(`${base}/chat/completions`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.CPA_TEXT_MODEL || 'gpt-5.5', reasoning_effort: 'low', max_completion_tokens: 600,
          messages: [
            { role: 'system', content: systemPrompt({ persona, relationship: 'friend' }, context) },
            { role: 'system', content: GREETING_INSTRUCTIONS },
            { role: 'user', content: JSON.stringify({ candidates, previousGreetings: history }) },
          ],
        }),
      });
      assert.ok(response.ok, `HTTP ${response.status}`);
      const reply = await response.json();
      const decision = parseCheckIn(reply.choices?.[0]?.message?.content, candidates);
      if (mode === 'opt-out') assert.equal(decision, null, 'Explicit opt-out must skip');
      else {
        assert.ok(decision, 'Synthetic eligible scenario should greet');
        assert.ok(decision.text.length <= 80);
        assert.equal(repeatsGreeting(decision.text, history), false, 'Must avoid earlier greeting');
        history.push({ text: decision.text });
      }
      results.push({ persona, mode, text: decision?.text || null, ok: true });
    } catch (error) { results.push({ persona, mode, ok: false, error: error.message }); }
    console.log(JSON.stringify(results.at(-1)));
  }
}
mkdirSync('artifacts/greetings', { recursive: true });
writeFileSync('artifacts/greetings/live-report.json', JSON.stringify({
  created: new Date().toISOString(), synthetic: true, results,
  note: 'Bounded live samples, not proof of universal compliance or semantic uniqueness.',
}, null, 2));
if (results.some(item => !item.ok)) process.exitCode = 1;
