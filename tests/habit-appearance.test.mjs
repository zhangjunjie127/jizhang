import test from 'node:test';
import assert from 'node:assert/strict';
import { habitAppearance, HABIT_ICONS, PLANNER_TONES } from '../shared/planner.mjs';

test('habit appearance matches custom titles without manual choices', () => {
  for (const [title, icon, tone] of [
    ['每天阅读20分钟', 'book', 'blue'],
    ['睡前喝水', 'water', 'blue'],
    ['每天跑步三公里', 'walk', 'blue'],
    ['晚上学习英语', 'study', 'violet'],
    ['联系家人', 'heart', 'rose'],
    ['早睡', 'moon', 'violet'],
    ['自定义事项', 'target', 'blue'],
    ['', 'target', 'blue'],
  ]) {
    const result = habitAppearance(title);
    assert.deepEqual(result, { icon, tone });
    assert.ok(HABIT_ICONS.includes(result.icon));
    assert.ok(PLANNER_TONES.includes(result.tone));
  }
});
