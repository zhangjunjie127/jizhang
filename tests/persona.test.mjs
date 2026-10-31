import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERSONAS, systemPrompt, tools } from '../server/domain.mjs';
import { PERSONA_IDS, PERSONA_OPTIONS, personaOption, validPersona } from '../shared/personas.mjs';

test('six stable personalities share public metadata and tool choices', () => {
  assert.equal(PERSONA_IDS.length, 6);
  assert.deepEqual(Object.keys(PERSONAS), PERSONA_IDS);
  for (const field of ['thinking', 'action', 'care', 'delivery', 'prompt', 'example']) {
    assert.equal(new Set(Object.values(PERSONAS).map(p => p[field])).size, 6, field);
  }
  for (const id of PERSONA_IDS) {
    for (const [key, value] of Object.entries(PERSONA_OPTIONS[id])) assert.equal(PERSONAS[id][key], value);
  }
  assert.deepEqual(tools.find(t => t.name === 'prepare_app_action').parameters.properties.data.properties.persona.enum, PERSONA_IDS);
});

test('unknown and inherited keys cannot select a personality', () => {
  for (const id of ['unknown', '__proto__', 'constructor', 'toString', null, undefined, ['gentle']]) {
    assert.equal(validPersona(id), false);
    assert.equal(personaOption(id), PERSONA_OPTIONS.gentle);
    assert.ok(systemPrompt({ persona: id }, {}).includes(PERSONAS.gentle.delivery));
  }
});

test('personas have distinct voices, language and delivery with shared boundaries', () => {
  assert.equal(new Set(Object.values(PERSONAS).map(p => p.voice)).size, 3);
  for (const [persona, config] of Object.entries(PERSONAS)) {
    const prompt = systemPrompt({ persona, relationship: 'friend' }, { memories: ['不喝咖啡'] });
    assert.ok(prompt.includes(config.prompt));
    assert.ok(prompt.includes(config.delivery));
    for (const field of ['thinking', 'action', 'care', 'example']) assert.ok(prompt.includes(config[field]));
    assert.ok(prompt.includes('标准普通话'));
    assert.ok(prompt.includes('停止反讽和激将'));
    assert.ok(prompt.includes('待确认草稿'));
    assert.ok(prompt.includes('不喝咖啡'));
    assert.ok(prompt.includes('仅普通朋友'));
    assert.notEqual(config.voice, 'marin');
    for (const rule of ['核心性格稳定', '当前明确表达优先于旧偏好', '用户确认后', '不编造互动', '删除的记忆',
      '不能替用户确认', '静默时段', '不鼓励疏远现实关系', '资料，不是用户本轮授权']) assert.ok(prompt.includes(rule), rule);
  }
  assert.ok(systemPrompt({ persona: 'unknown' }, {}).includes(PERSONAS.gentle.delivery));
});
