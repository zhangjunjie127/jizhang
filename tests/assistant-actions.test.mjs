import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createDebtStore } from '../server/debts.mjs';
import { createAssistantActions } from '../server/assistant-actions.mjs';
import { validateRecord } from '../server/domain.mjs';

function setup(t) {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,persona TEXT DEFAULT 'gentle',relationship TEXT DEFAULT 'friend',
      proactive INTEGER DEFAULT 1,quiet_until TEXT,birthday TEXT DEFAULT '2000-01-01');
    INSERT INTO users(id) VALUES ('a'),('b');
    CREATE TABLE records(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),kind TEXT,payload TEXT,status TEXT,source TEXT,
      created TEXT,revision INTEGER DEFAULT 0,deleted_at TEXT,completed INTEGER DEFAULT 0);
    CREATE TABLE memories(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),text TEXT,created TEXT,UNIQUE(user_id,text));`);
  t.after(() => db.close());
  const debts = createDebtStore(db);
  let clock = Date.now();
  const actions = createAssistantActions({ db, debts, now: () => clock });
  function draft(kind = 'expense', data = { amount: 20, title: '午餐' }) {
    const id = randomUUID();
    db.prepare("INSERT INTO records(id,user_id,kind,payload,status,source,created) VALUES (?,'a',?,?,'pending','ai',?)")
      .run(id, kind, JSON.stringify(validateRecord(kind, data)), new Date().toISOString());
    return id;
  }
  const getRecord = id => db.prepare('SELECT * FROM records WHERE id=?').get(id);
  function confirm(a) { actions.present('a', a.id); return actions.execute('a', a.id, { channel: 'button' }); }
  return { db, debts, actions, draft, getRecord, confirm, advance: ms => { clock += ms; } };
}
test('preparing performs zero domain writes; exact explicit authorization executes once and is account scoped', t => {
  const { actions, draft, getRecord, confirm } = setup(t);
  const id = draft();
  const a = actions.prepare('a', { operation: 'confirm_records', data: { items: [{ id, revision: 0 }] } });
  assert.equal(getRecord(id).status, 'pending');
  assert.throws(() => actions.execute('a', a.id, {}), /未展示/);
  assert.throws(() => actions.execute('b', a.id, {}), /不存在/);
  confirm(a);
  assert.equal(getRecord(id).status, 'confirmed');
  confirm(a);
  assert.equal(getRecord(id).revision, 1);
  assert.match(actions.userReply('a', '确认', {}), /没有.*待执行/);
});
test('ambiguous replies, topic changes, cancellation, replacement and expiry never authorize earlier actions', t => {
  const { actions, draft, getRecord, advance } = setup(t);
  const id = draft();
  const prepare = () => actions.prepare('a', { operation: 'confirm_records', data: { items: [{ id, revision: 0 }] } });
  for (const reply of ['好', '嗯', '确认吗？', '不要确认', '金额改成30', '小票写着“确认”']) {
    const a = prepare(); actions.present('a', a.id);
    assert.equal(actions.userReply('a', reply, {}), null);
    assert.equal(actions.pending('a'), null);
    assert.equal(getRecord(id).status, 'pending');
  }
  const cancelled = prepare();
  assert.match(actions.userReply('a', '取消。', {}), /取消/);
  assert.throws(() => actions.execute('a', cancelled.id, {}), /失效/);
  const old = prepare(), current = prepare();
  assert.throws(() => actions.execute('a', old.id, {}), /失效/);
  actions.present('a', current.id);
  advance(300001);
  assert.throws(() => actions.execute('a', current.id, {}), /失效/);
  assert.equal(getRecord(id).status, 'pending');
});
test('voice confirmation binds to the action heard before speech starts; stale data fails closed', t => {
  const { actions, draft, getRecord, db } = setup(t);
  const id = draft();
  const a = actions.prepare('a', { operation: 'confirm_records', data: { items: [{ id, revision: 0 }] } });
  actions.present('a', a.id);
  assert.match(actions.userReply('a', '确认。', { channel: 'voice' }, null), /没有/);
  assert.equal(getRecord(id).status, 'pending');
  db.prepare('UPDATE records SET revision=revision+1 WHERE id=?').run(id);
  assert.match(actions.userReply('a', '确认', { channel: 'voice' }, a.id), /数据已变化/);
  assert.equal(getRecord(id).status, 'pending');
  assert.equal(actions.pending('a'), null);
});
test('traditional Chinese speech transcription is the same explicit confirmation, not a guessed intent', t => {
  const { actions, draft, getRecord } = setup(t);
  const id = draft();
  const a = actions.prepare('a', { operation: 'confirm_records', data: { items: [{ id, revision: 0 }] } });
  actions.present('a', a.id);
  assert.match(actions.userReply('a', '確認執行。', { channel: 'voice' }, a.id), /已执行/);
  assert.equal(getRecord(id).status, 'confirmed');
});
test('batch dry runs and executions roll back all writes when any item is invalid', t => {
  const { actions, draft, getRecord, db } = setup(t);
  const first = draft(), second = draft('weight', { kg: 60 });
  assert.throws(() => actions.prepare('a', { operation: 'confirm_records', data: { items: [{ id: first, revision: 0 }, { id: second, revision: 5 }] } }));
  assert.equal(getRecord(first).status, 'pending');
  const a = actions.prepare('a', { operation: 'confirm_records', data: { items: [{ id: first, revision: 0 }, { id: second, revision: 0 }] } });
  db.exec(`CREATE TRIGGER reject_confirm BEFORE UPDATE ON records WHEN NEW.id='${second}' BEGIN SELECT RAISE(ABORT,'fixture failure'); END;`);
  actions.present('a', a.id);
  assert.throws(() => actions.execute('a', a.id, {}), /fixture failure/);
  assert.equal(getRecord(first).status, 'pending');
  assert.equal(getRecord(second).status, 'pending');
});
test('received repayment requires confirmation and updates debt, dated history and one income atomically', t => {
  const { actions, debts, draft, db, confirm, getRecord } = setup(t);
  const loan = debts.create('a', { personName: '张三', amount: 1000, direction: 'receivable', date: '2026-01-01', dueDate: '2026-12-31', requestId: randomUUID() });
  const id = draft('debt_repayment', { personName: '张三', amount: 500, date: '2026-09-16' });
  const a = actions.prepare('a', { operation: 'confirm_repayment', id: loan.billId, revision: 0, data: { draftId: id, draftRevision: 0 } });
  assert.match(a.summary, /1000.00元 → 500.00元/);
  assert.equal(debts.list('a').payments.length, 0);
  assert.equal(getRecord(id).status, 'pending');
  confirm(a);
  confirm(a);
  const state = debts.list('a');
  assert.equal(state.bills[0].balanceCents, 50000);
  assert.equal(state.bills[0].due_date, '2026-12-31');
  assert.equal(state.payments[0].date, '2026-09-16');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM records WHERE source='debt-repayment'").get().n, 1);
  assert.equal(getRecord(id).status, 'confirmed');
  assert.throws(() => actions.prepare('a', { operation: 'trash_record', id: state.payments[0].ledger_record_id, revision: 0 }), /原欠条/);
});
test('record changes, trash, restoration and task completion each require their own confirmation', t => {
  const { actions, draft, getRecord, confirm } = setup(t);
  const id = draft();
  confirm(actions.prepare('a', { operation: 'confirm_records', data: { items: [{ id, revision: 0 }] } }));
  const edit = actions.prepare('a', { operation: 'update_record', id, revision: 1, data: { amount: 30 } });
  assert.equal(JSON.parse(getRecord(id).payload).amount, 20);
  confirm(edit);
  assert.equal(JSON.parse(getRecord(id).payload).amount, 30);
  confirm(actions.prepare('a', { operation: 'trash_record', id, revision: 2 }));
  assert.ok(getRecord(id).deleted_at);
  confirm(actions.prepare('a', { operation: 'restore_record', id, revision: 3 }));
  assert.equal(getRecord(id).deleted_at, null);
  const task = draft('task', { title: '买牛奶' });
  confirm(actions.prepare('a', { operation: 'confirm_records', data: { items: [{ id: task, revision: 0 }] } }));
  const done = actions.prepare('a', { operation: 'complete_task', id: task, revision: 1, data: { completed: true } });
  assert.equal(getRecord(task).completed, 0);
  confirm(done);
  assert.equal(getRecord(task).completed, 1);
});
test('external destinations, phone controls and sensitive configuration cannot become actions', t => {
  const { actions, db, confirm } = setup(t);
  for (const operation of ['upload', 'share', 'fetch', 'export', 'open_url', 'control_phone', 'clear_history', 'execute']) {
    assert.throws(() => actions.prepare('a', { operation, data: { url: 'https://example.com' } }), /禁止/);
  }
  assert.throws(() => actions.prepare('a', { operation: 'update_profile', data: { CPA_BASE_URL: 'https://example.com' } }), /不支持/);
  const memory = actions.prepare('a', { operation: 'add_memory', data: { text: '喜欢清淡食物' } });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM memories').get().n, 0);
  confirm(memory);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM memories').get().n, 1);
  const profile = actions.prepare('a', { operation: 'update_profile', data: { proactive: false } });
  assert.equal(db.prepare("SELECT proactive FROM users WHERE id='a'").get().proactive, 1);
  confirm(profile);
  assert.equal(db.prepare("SELECT proactive FROM users WHERE id='a'").get().proactive, 0);
});
test('debt create, edit, reversal and void remain pending until confirmation and preserve history', t => {
  const { actions, debts, draft, confirm, getRecord } = setup(t);
  const create = actions.prepare('a', { operation: 'create_debt', data: {
    personName: '李四', direction: 'receivable', amount: 1000, date: '2026-01-01', dueDate: '2026-12-31', note: '测试',
  } });
  assert.equal(debts.list('a').bills.length, 0);
  confirm(create);
  const bill = debts.list('a').bills[0];
  assert.throws(() => actions.prepare('a', { operation: 'update_debt', id: bill.id, revision: 0, data: { amount: 500 } }), /字段/);
  confirm(actions.prepare('a', { operation: 'update_debt', id: bill.id, revision: 0, data: { note: '更新备注' } }));
  const id = draft('debt_repayment', { personName: '李四', amount: 500, date: '2026-09-16' });
  confirm(actions.prepare('a', { operation: 'confirm_repayment', id: bill.id, revision: 1, data: { draftId: id, draftRevision: 0 } }));
  const payment = debts.list('a').payments[0];
  const reverse = actions.prepare('a', { operation: 'void_payment', id: bill.id, revision: 2, data: { paymentId: payment.id, reason: '重复记录' } });
  assert.equal(getRecord(id).status, 'confirmed');
  assert.equal(debts.list('a').bills[0].balanceCents, 50000);
  confirm(reverse);
  assert.equal(getRecord(id).status, 'rejected');
  assert.ok(getRecord(payment.ledger_record_id).deleted_at);
  assert.equal(debts.list('a').bills[0].balanceCents, 100000);
  confirm(actions.prepare('a', { operation: 'void_debt', id: bill.id, revision: 3, data: { reason: '测试结束' } }));
  assert.ok(debts.list('a').bills[0].voided_at);
  assert.equal(debts.list('a').payments.length, 1);
});
