import test from 'node:test';
import assert from 'node:assert/strict';
import { HABIT_TEMPLATES, HABIT_TEMPLATE_CATEGORIES, habitTemplateFields } from '../shared/habit-templates.mjs';
import { HABIT_ICONS, PLANNER_TONES } from '../shared/planner.mjs';
test('all six preset categories contain complete, independent editable settings', () => {
  assert.equal(HABIT_TEMPLATES.length, 50);
  assert.equal(new Set(HABIT_TEMPLATES.map(item => item.title)).size, 50);
  for (const category of HABIT_TEMPLATE_CATEGORIES) assert.ok(HABIT_TEMPLATES.filter(item => item.category === category).length >= 8);
  for (const item of HABIT_TEMPLATES) {
    const fields = habitTemplateFields(item);
    assert.ok(HABIT_ICONS.includes(fields.icon));
    assert.ok(PLANNER_TONES.includes(fields.tone));
    assert.ok(fields.weekdays.length);
    assert.ok(fields.reminders.every(time => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)));
    fields.weekdays.length = 0;
    assert.ok(item.weekdays.length);
    assert.equal(fields.startDate, undefined);
    assert.equal(fields.note, undefined);
  }
});
