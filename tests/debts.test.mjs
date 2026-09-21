import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createDebtStore } from '../server/debts.mjs';
import { debtAmountCents, debtDate, debtTimeline, groupDebts } from '../shared/debts.mjs';

function setup(t) {
  const db = new DatabaseSync(':memory:');
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('a'),('b')");
  db.exec(`CREATE TABLE records (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
    payload TEXT NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL, created TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0, deleted_at TEXT
  )`);
  t.after(() => db.close());
  return { db, store: createDebtStore(db) };
}
const loan = (changes = {}) => ({
  personName: '张三', direction: 'receivable', amount: '1000.00',
  date: '2026-01-01', dueDate: '2026-12-31', note: '周转', requestId: randomUUID(), ...changes,
});
const payment = (revision = 0, changes = {}) => ({ amount: '200', date: '2026-01-02', note: '转账', requestId: randomUUID(), revision, ...changes });
const code = expected => error => error.status === expected;

test('debt money uses integer cents and dates cannot normalize invalid calendar dates', () => {
  assert.equal(debtAmountCents('0.29'), 29);
  assert.equal(debtAmountCents('1000000.00'), 100000000);
  for (const value of ['', '-1', '0', '1.001', '1e3', 'Infinity', '1000000.01']) assert.throws(() => debtAmountCents(value));
  assert.equal(debtDate('2024-02-29'), '2024-02-29');
  for (const value of ['2026-02-29', '2026-04-31', '2026-1-01', null]) assert.throws(() => debtDate(value));
});
test('same person groups independent bills, partial payments affect only the chosen bill, and opposite directions never offset', t => {
  const { store } = setup(t);
  const first = store.create('a', loan()).billId;
  const second = store.create('a', loan({ amount: '500' })).billId;
  const third = store.create('a', loan({ amount: '300', direction: 'payable' })).billId;
  const state = store.pay('a', first, payment());
  assert.equal(state.people.length, 1);
  assert.equal(state.bills.length, 3);
  assert.equal(state.bills.find(b => b.id === first).balanceCents, 80000);
  assert.equal(state.bills.find(b => b.id === second).balanceCents, 50000);
  assert.equal(state.bills.find(b => b.id === third).balanceCents, 30000);
  assert.equal(groupDebts(state.people, state.bills, 'receivable')[0].balanceCents, 130000);
  assert.equal(groupDebts(state.people, state.bills, 'payable')[0].balanceCents, 30000);
});
test('debt operations are account scoped, including people with the same name', t => {
  const { store } = setup(t);
  const id = store.create('a', loan()).billId;
  assert.deepEqual(store.list('b'), { people: [], bills: [], payments: [] });
  for (const action of [
    () => store.pay('b', id, payment()),
    () => store.update('b', id, { revision: 0 }),
    () => store.voidBill('b', id, { revision: 0, reason: '测试' }),
    () => store.voidPayment('b', id, randomUUID(), { revision: 0, reason: '测试' }),
  ]) assert.throws(action, code(404));
  const own = store.create('b', loan());
  assert.notEqual(own.people[0].id, store.list('a').people[0].id);
});
test('creation and repayment retry are idempotent and mismatched replay is rejected', t => {
  const { store } = setup(t);
  const body = loan();
  const id = store.create('a', body).billId;
  assert.equal(store.create('a', body).billId, id);
  assert.throws(() => store.create('a', { ...body, amount: '999' }), code(409));
  const pay = payment();
  store.pay('a', id, pay);
  const replay = store.pay('a', id, pay);
  assert.equal(replay.payments.length, 1);
  assert.equal(replay.bills[0].balanceCents, 80000);
  assert.throws(() => store.pay('a', id, { ...pay, amount: '100' }), code(409));
  assert.equal(store.list('a').bills.length, 1);
});
test('overpayment, stale revisions, future/back-before-loan dates, and payments after settlement are rejected without side effects', t => {
  const { store } = setup(t);
  assert.throws(() => store.create('a', loan({ date: '9999-01-01' })), code(400));
  assert.throws(() => store.create('a', loan({ dueDate: '2025-12-31' })), code(400));
  const id = store.create('a', loan()).billId;
  for (const body of [payment(0, { amount: 1001 }), payment(0, { date: '2025-12-31' }), payment(0, { date: '9999-01-01' }), payment(undefined, { revision: undefined })]) {
    assert.throws(() => store.pay('a', id, body));
  }
  assert.equal(store.list('a').payments.length, 0);
  store.pay('a', id, payment());
  assert.throws(() => store.pay('a', id, payment(0)), code(409));
  const result = store.pay('a', id, payment(1, { amount: 800 }));
  assert.equal(result.bills[0].state, 'settled');
  assert.equal(result.bills[0].balanceCents, 0);
  assert.throws(() => store.pay('a', id, payment(2, { amount: '.01' })));
  assert.equal(store.list('a').payments.length, 2);
});
test('chronological repayment details recalculate backdated balances and preserve voided history', t => {
  const { store } = setup(t);
  const id = store.create('a', loan()).billId;
  store.pay('a', id, payment(0, { date: '2026-01-04', amount: 100 }));
  let state = store.pay('a', id, payment(1, { date: '2026-01-02', amount: 200 }));
  let timeline = debtTimeline(state.bills[0], state.payments);
  assert.deepEqual(timeline.map(row => [row.date, row.balanceCents]), [['2026-01-02', 80000], ['2026-01-04', 70000]]);
  assert.throws(() => store.voidBill('a', id, { revision: 2, reason: '错误' }), code(400));
  state = store.voidPayment('a', id, timeline[0].id, { revision: 2, reason: '日期金额录错' });
  timeline = debtTimeline(state.bills[0], state.payments);
  assert.equal(state.bills[0].balanceCents, 90000);
  assert.equal(timeline[0].void_reason, '日期金额录错');
  assert.ok(timeline[0].voided_at);
  assert.equal(timeline[1].balanceCents, 90000);
  assert.throws(() => store.voidPayment('a', id, timeline[0].id, { revision: 3, reason: '重复' }), code(409));
});
test('voiding a bill keeps its original details but excludes its balance; edits cannot silently alter principal or ownership', t => {
  const { db, store } = setup(t);
  const id = store.create('a', loan()).billId;
  let state = store.update('a', id, { revision: 0, dueDate: '2027-01-01', note: '延期', amount: 10, personName: '另一个人', direction: 'payable' });
  assert.equal(state.bills[0].principal_cents, 100000);
  assert.equal(state.people[0].name, '张三');
  assert.equal(state.bills[0].direction, 'receivable');
  assert.equal(state.bills[0].due_date, '2027-01-01');
  state = store.voidBill('a', id, { revision: 1, reason: '重复登记' });
  assert.equal(state.bills[0].state, 'voided');
  assert.equal(state.bills[0].balanceCents, 0);
  assert.equal(groupDebts(state.people, state.bills, 'receivable').length, 0);
  assert.equal(groupDebts(state.people, state.bills, 'receivable', true)[0].bills.length, 1);
  assert.throws(() => store.pay('a', id, payment(2)), code(409));
  assert.equal(createDebtStore(db).list('a').bills[0].void_reason, '重复登记');
});

test('early received repayment creates one linked income on the actual date and preserves the agreed due date', t => {
  const { db, store } = setup(t);
  const id = store.create('a', loan()).billId;
  const body = payment(0, { amount: '500', date: '2026-09-16', note: '提前转账' });
  store.pay('a', id, body);
  const state = store.pay('a', id, body);
  assert.equal(state.bills[0].due_date, '2026-12-31');
  assert.equal(state.bills[0].balanceCents, 50000);
  assert.equal(state.payments.length, 1);
  const record = db.prepare('SELECT * FROM records').get();
  assert.equal(record.id, state.payments[0].ledger_record_id);
  assert.equal(record.user_id, 'a');
  assert.equal(record.status, 'confirmed');
  assert.deepEqual(JSON.parse(record.payload), {
    amount: 500, cents: 50000, direction: 'income', category: '收回借款', title: '张三还款',
    date: '2026-09-16', debtBillId: id, debtPaymentId: state.payments[0].id,
  });
  assert.equal(db.prepare('SELECT count(*) AS n FROM records').get().n, 1);
  assert.equal(debtTimeline(state.bills[0], state.payments)[0].balanceCents, 50000);
  const undone = store.voidPayment('a', id, state.payments[0].id, { revision: 1, reason: '误录' });
  assert.equal(undone.bills[0].due_date, '2026-12-31');
  assert.equal(undone.bills[0].balanceCents, 100000);
  assert.ok(db.prepare('SELECT deleted_at FROM records').get().deleted_at);
  store.pay('a', id, body);
  assert.equal(db.prepare('SELECT count(*) AS n FROM records WHERE deleted_at IS NULL').get().n, 0);
});

test('income insert and repayment reversal failures roll back the entire financial operation', t => {
  const { db, store } = setup(t);
  const id = store.create('a', loan()).billId;
  db.exec("CREATE TRIGGER reject_payment BEFORE INSERT ON debt_payments BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  assert.throws(() => store.pay('a', id, payment()), /test failure/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM records').get().n, 0);
  assert.equal(store.list('a').bills[0].revision, 0);
  db.exec('DROP TRIGGER reject_payment');
  const state = store.pay('a', id, payment());
  db.exec("CREATE TRIGGER reject_void BEFORE UPDATE ON debt_payments BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  assert.throws(() => store.voidPayment('a', id, state.payments[0].id, { revision: 1, reason: '测试' }), /test failure/);
  assert.equal(db.prepare('SELECT deleted_at FROM records').get().deleted_at, null);
  assert.equal(store.list('a').bills[0].balanceCents, 80000);
});

test('schema upgrade preserves historical repayments without retroactive income; payable stays unchanged', t => {
  const { db, store } = setup(t);
  const id = store.create('a', loan()).billId;
  db.exec('DROP INDEX debt_payment_ledger; ALTER TABLE debt_payments DROP COLUMN ledger_record_id');
  db.prepare('INSERT INTO debt_payments(id,user_id,bill_id,cents,date,note,created,request_id,request_hash) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(), 'a', id, 20000, '2026-01-02', '旧还款', '2026-01-02T00:00:00Z', randomUUID(), 'old');
  const migrated = createDebtStore(db);
  const before = migrated.list('a');
  assert.equal(before.bills[0].balanceCents, 80000);
  assert.equal(before.payments[0].ledger_record_id, null);
  assert.equal(db.prepare('SELECT count(*) AS n FROM records').get().n, 0);
  migrated.voidPayment('a', id, before.payments[0].id, { revision: 0, reason: '旧记录撤销' });
  const payable = migrated.create('a', loan({ direction: 'payable' })).billId;
  migrated.pay('a', payable, payment());
  assert.equal(db.prepare('SELECT count(*) AS n FROM records').get().n, 0);
});

test('assistant repayment confirmation consumes its draft atomically, is retry-safe and preserves dates and independent bills', t => {
  const { db, store } = setup(t);
  const first = store.create('a', loan()).billId;
  const second = store.create('a', loan({ amount: 800 })).billId;
  const draftId = randomUUID();
  db.prepare("INSERT INTO records(id,user_id,kind,payload,status,source,created) VALUES (?,?,'debt_repayment',?,'pending','ai',?)")
    .run(draftId, 'a', JSON.stringify({ personName: '张三', amount: 500, date: '2026-09-16' }), '2026-09-17T00:00:00Z');
  const body = payment(0, { amount: 500, date: '2026-09-16', requestId: draftId, draftId, draftRevision: 0 });
  assert.throws(() => store.pay('b', first, body), code(404));
  assert.throws(() => store.pay('a', first, { ...body, draftRevision: 1 }), code(409));
  db.exec("CREATE TRIGGER fail_draft BEFORE UPDATE ON records WHEN NEW.kind='debt_repayment' BEGIN SELECT RAISE(ABORT,'draft failed'); END");
  assert.throws(() => store.pay('a', first, body), /draft failed/);
  assert.equal(store.list('a').payments.length, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM records').get().n, 1);
  db.exec('DROP TRIGGER fail_draft');
  const state = store.pay('a', first, body);
  assert.equal(state.bills.find(item => item.id === first).balanceCents, 50000);
  assert.equal(state.bills.find(item => item.id === second).balanceCents, 80000);
  assert.equal(state.bills.find(item => item.id === first).due_date, '2026-12-31');
  assert.equal(state.payments[0].date, '2026-09-16');
  assert.equal(db.prepare('SELECT status FROM records WHERE id=?').get(draftId).status, 'confirmed');
  store.pay('a', first, body);
  assert.equal(store.list('a').payments.length, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM records WHERE kind='expense'").get().n, 1);
  assert.throws(() => store.pay('a', second, body), code(409));
});

test('assistant received-repayment drafts cannot confirm against payable bills or after rejection', t => {
  const { db, store } = setup(t);
  const payable = store.create('a', loan({ direction: 'payable' })).billId;
  const receivable = store.create('a', loan()).billId;
  const draftId = randomUUID();
  db.prepare("INSERT INTO records(id,user_id,kind,payload,status,source,created) VALUES (?,?,'debt_repayment','{}','pending','ai',?)")
    .run(draftId, 'a', '2026-01-02');
  const body = payment(0, { requestId: draftId, draftId, draftRevision: 0 });
  assert.throws(() => store.pay('a', payable, body), code(409));
  db.prepare("UPDATE records SET status='rejected' WHERE id=?").run(draftId);
  assert.throws(() => store.pay('a', receivable, body), code(409));
  assert.equal(store.list('a').payments.length, 0);
});
