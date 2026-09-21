import { randomUUID, createHash } from 'node:crypto';
import { cleanText, fail, iso, validateRecord } from './domain.mjs';
import { debtAmountCents, debtDate, debtSummary, debtToday } from '../shared/debts.mjs';

export function createDebtStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS debt_people (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, created TEXT NOT NULL, UNIQUE(user_id,name), UNIQUE(id,user_id)
    );
    CREATE TABLE IF NOT EXISTS debt_bills (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      person_id TEXT NOT NULL, direction TEXT NOT NULL CHECK(direction IN ('receivable','payable')),
      principal_cents INTEGER NOT NULL CHECK(principal_cents>0 AND principal_cents<=100000000),
      loan_date TEXT NOT NULL, due_date TEXT, note TEXT NOT NULL, created TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT, voided_at TEXT, void_reason TEXT,
      request_id TEXT NOT NULL, request_hash TEXT NOT NULL, UNIQUE(user_id,request_id), UNIQUE(id,user_id),
      FOREIGN KEY(person_id,user_id) REFERENCES debt_people(id,user_id)
    );
    CREATE TABLE IF NOT EXISTS debt_payments (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bill_id TEXT NOT NULL, cents INTEGER NOT NULL CHECK(cents>0 AND cents<=100000000),
      date TEXT NOT NULL, note TEXT NOT NULL, created TEXT NOT NULL,
      voided_at TEXT, void_reason TEXT, request_id TEXT NOT NULL, request_hash TEXT NOT NULL,
      UNIQUE(user_id,request_id), FOREIGN KEY(bill_id,user_id) REFERENCES debt_bills(id,user_id)
    );
    CREATE INDEX IF NOT EXISTS debt_bills_user ON debt_bills(user_id,person_id);
    CREATE INDEX IF NOT EXISTS debt_payments_bill ON debt_payments(user_id,bill_id);
  `);
  if (!db.prepare('PRAGMA table_info(debt_payments)').all().some(column => column.name === 'ledger_record_id')) {
    db.exec('ALTER TABLE debt_payments ADD COLUMN ledger_record_id TEXT REFERENCES records(id)');
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS debt_payment_ledger ON debt_payments(ledger_record_id) WHERE ledger_record_id IS NOT NULL');
  const optionalText = (value, label = '备注') => value == null || value === '' ? '' : cleanText(value, 300, label);
  const validate = fn => {
    try { return fn(); } catch (error) { if (error.status) throw error; fail(error.message); }
  };
  const requestKey = value => {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value)) fail('请求标识无效');
    return value;
  };
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  function atomic(fn) {
    db.exec('SAVEPOINT debt_write');
    try { const result = fn(); db.exec('RELEASE debt_write'); return result; }
    catch (error) { db.exec('ROLLBACK TO debt_write; RELEASE debt_write'); throw error; }
  }
  function list(userId) {
    const people = db.prepare('SELECT * FROM debt_people WHERE user_id=? ORDER BY name').all(userId);
    const payments = db.prepare('SELECT * FROM debt_payments WHERE user_id=? ORDER BY date,created,id').all(userId)
      .map(({ request_hash, request_id, ...payment }) => payment);
    const bills = db.prepare('SELECT * FROM debt_bills WHERE user_id=? ORDER BY loan_date DESC,created DESC,id').all(userId)
      .map(({ request_hash, request_id, ...bill }) => ({ ...bill, ...debtSummary(bill, payments) }));
    return { people, bills, payments };
  }
  function getBill(userId, id) {
    const bill = db.prepare('SELECT * FROM debt_bills WHERE id=? AND user_id=?').get(id, userId);
    if (!bill) fail('借款账单不存在', 404);
    return bill;
  }
  function editable(bill, revision) {
    if (bill.voided_at) fail('账单已作废，不能继续操作', 409);
    if (!Number.isInteger(revision) || bill.revision !== revision) fail('账单已更新，请刷新后重新核对', 409);
  }
  function dueDate(value, loanDate) {
    if (!value) return null;
    const date = validate(() => debtDate(value, '约定还款日'));
    if (date < loanDate) fail('约定还款日不能早于借款日期');
    return date;
  }
  function create(userId, body) {
    const requestId = requestKey(body?.requestId);
    const name = cleanText(body.personName, 40, '对方姓名');
    if (!['receivable', 'payable'].includes(body.direction)) fail('请选择借出或借入');
    const cents = validate(() => debtAmountCents(body.amount));
    const date = validate(() => debtDate(body.date, '借款日期'));
    if (date > debtToday()) fail('借款日期不能晚于今天');
    const due = dueDate(body.dueDate, date);
    const note = optionalText(body.note);
    const fingerprint = hash([name, body.direction, cents, date, due, note]);
    return atomic(() => {
      const prior = db.prepare('SELECT id,request_hash FROM debt_bills WHERE user_id=? AND request_id=?').get(userId, requestId);
      if (prior) {
        if (prior.request_hash !== fingerprint) fail('该请求已保存其他内容，请重新打开新增借款', 409);
        return { ...list(userId), billId: prior.id };
      }
      let person = db.prepare('SELECT * FROM debt_people WHERE user_id=? AND name=?').get(userId, name);
      if (!person) {
        person = { id: randomUUID() };
        db.prepare('INSERT INTO debt_people(id,user_id,name,created) VALUES (?,?,?,?)').run(person.id, userId, name, iso());
      }
      const id = randomUUID();
      db.prepare(`INSERT INTO debt_bills(id,user_id,person_id,direction,principal_cents,loan_date,due_date,note,created,request_id,request_hash)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, userId, person.id, body.direction, cents, date, due, note, iso(), requestId, fingerprint);
      return { ...list(userId), billId: id };
    });
  }
  function update(userId, id, body) {
    return atomic(() => {
      const bill = getBill(userId, id);
      editable(bill, body?.revision);
      const due = dueDate(body.dueDate, bill.loan_date);
      const note = optionalText(body.note);
      db.prepare('UPDATE debt_bills SET due_date=?,note=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?')
        .run(due, note, iso(), id, userId);
      return list(userId);
    });
  }
  function pay(userId, id, body) {
    const requestId = requestKey(body?.requestId);
    const cents = validate(() => debtAmountCents(body.amount));
    const date = validate(() => debtDate(body.date, '还款日期'));
    const note = optionalText(body.note);
    const fingerprint = hash([id, cents, date, note]);
    return atomic(() => {
      const bill = getBill(userId, id);
      let draft;
      if (body.draftId) {
        draft = db.prepare('SELECT * FROM records WHERE id=? AND user_id=?').get(body.draftId, userId);
        if (!draft || draft.kind !== 'debt_repayment') fail('还款草稿不存在', 404);
        if (requestId !== draft.id || bill.direction !== 'receivable') fail('还款草稿只能关联别人欠我的原欠条', 409);
      }
      const prior = db.prepare('SELECT request_hash FROM debt_payments WHERE user_id=? AND request_id=?').get(userId, requestId);
      if (prior) {
        if (prior.request_hash !== fingerprint) fail('该请求已保存其他还款，请重新打开还款窗口', 409);
        return list(userId);
      }
      if (draft && (draft.status !== 'pending' || draft.deleted_at || !Number.isInteger(body.draftRevision) || draft.revision !== body.draftRevision)) {
        fail('还款草稿已变化，请刷新后重新核对', 409);
      }
      editable(bill, body.revision);
      if (date < bill.loan_date || date > debtToday()) fail('还款日期需在借款日至今天之间');
      const payments = db.prepare('SELECT * FROM debt_payments WHERE user_id=? AND bill_id=?').all(userId, id);
      if (cents > debtSummary(bill, payments).balanceCents) fail('还款金额不能超过这张账单的剩余欠款');
      const paymentId = randomUUID();
      let ledgerId = null;
      if (bill.direction === 'receivable') {
        ledgerId = randomUUID();
        const person = db.prepare('SELECT name FROM debt_people WHERE id=? AND user_id=?').get(bill.person_id, userId);
        const payload = {
          ...validateRecord('expense', { amount: (cents / 100).toFixed(2), direction: 'income', category: '收回借款', title: `${person.name}还款`, date }),
          debtBillId: id, debtPaymentId: paymentId,
        };
        db.prepare("INSERT INTO records(id,user_id,kind,payload,status,source,created) VALUES (?,?,'expense',?,'confirmed','debt-repayment',?)")
          .run(ledgerId, userId, JSON.stringify(payload), iso());
      }
      db.prepare('INSERT INTO debt_payments(id,user_id,bill_id,cents,date,note,created,request_id,request_hash,ledger_record_id) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(paymentId, userId, id, cents, date, note, iso(), requestId, fingerprint, ledgerId);
      db.prepare('UPDATE debt_bills SET revision=revision+1,updated_at=? WHERE id=? AND user_id=?').run(iso(), id, userId);
      if (draft) {
        const person = db.prepare('SELECT name FROM debt_people WHERE id=? AND user_id=?').get(bill.person_id, userId);
        db.prepare("UPDATE records SET status='confirmed',payload=?,revision=revision+1 WHERE id=? AND user_id=?")
          .run(JSON.stringify({ ...validateRecord('debt_repayment', { personName: person.name, amount: cents / 100, date, note }),
            debtBillId: id, debtPaymentId: paymentId }), draft.id, userId);
      }
      return list(userId);
    });
  }
  function voidPayment(userId, id, paymentId, body) {
    return atomic(() => {
      const bill = getBill(userId, id);
      editable(bill, body.revision);
      const payment = db.prepare('SELECT * FROM debt_payments WHERE id=? AND user_id=? AND bill_id=?').get(paymentId, userId, id);
      if (!payment) fail('还款记录不存在', 404);
      if (payment.voided_at) fail('这笔还款已撤销，请刷新', 409);
      const reason = cleanText(body.reason, 300, '撤销原因');
      if (payment.ledger_record_id) {
        db.prepare('UPDATE records SET deleted_at=?,revision=revision+1 WHERE id=? AND user_id=?')
          .run(iso(), payment.ledger_record_id, userId);
      }
      db.prepare('UPDATE debt_payments SET voided_at=?,void_reason=? WHERE id=? AND user_id=?').run(iso(), reason, paymentId, userId);
      db.prepare("UPDATE records SET status='rejected',revision=revision+1 WHERE user_id=? AND kind='debt_repayment' AND json_extract(payload,'$.debtPaymentId')=?")
        .run(userId, paymentId);
      db.prepare('UPDATE debt_bills SET revision=revision+1,updated_at=? WHERE id=? AND user_id=?').run(iso(), id, userId);
      return list(userId);
    });
  }
  function voidBill(userId, id, body) {
    return atomic(() => {
      const bill = getBill(userId, id);
      editable(bill, body.revision);
      if (db.prepare('SELECT id FROM debt_payments WHERE user_id=? AND bill_id=? AND voided_at IS NULL').get(userId, id)) fail('请先核对并撤销还款记录，再作废账单');
      const reason = cleanText(body.reason, 300, '作废原因');
      db.prepare('UPDATE debt_bills SET voided_at=?,void_reason=?,revision=revision+1 WHERE id=? AND user_id=?').run(iso(), reason, id, userId);
      return list(userId);
    });
  }
  return { list, create, update, pay, voidPayment, voidBill };
}
