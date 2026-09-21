import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERSONAS, systemPrompt } from '../server/domain.mjs';

test('personas have distinct voices, language and delivery with shared boundaries', () => {
  assert.equal(new Set(Object.values(PERSONAS).map(p => p.voice)).size, 3);
  for (const [persona, config] of Object.entries(PERSONAS)) {
    const prompt = systemPrompt({ persona, relationship: 'friend' }, { memories: ['不喝咖啡'] });
    assert.ok(prompt.includes(config.prompt));
    assert.ok(prompt.includes(config.delivery));
    assert.ok(prompt.includes('标准普通话'));
    assert.ok(prompt.includes('停止反讽和激将'));
    assert.ok(prompt.includes('待确认草稿'));
    assert.ok(prompt.includes('不喝咖啡'));
    assert.ok(prompt.includes('仅普通朋友'));
    assert.notEqual(config.voice, 'marin');
  }
  assert.ok(systemPrompt({ persona: 'unknown' }, {}).includes(PERSONAS.gentle.delivery));
});
