import { randomUUID, createHash } from 'node:crypto';
import { cleanText, fail, iso, validateRecord, PERSONAS, ageOn } from './domain.mjs';
import { taskCategory } from '../shared/task-categories.mjs';

export const ACTION_NAMES = [
  'confirm_records', 'confirm_repayment', 'update_record', 'trash_record', 'restore_record', 'complete_task',
  'create_debt', 'update_debt', 'pay_debt', 'void_payment', 'void_debt',
  'add_memory', 'delete_memory', 'update_profile',
];
const ACTION_FIELDS = {
  confirm_records: ['items'], confirm_repayment: ['draftId', 'draftRevision'],
  update_record: ['title', 'amount', 'kg', 'category', 'direction', 'date', 'due'],
  trash_record: [], restore_record: [], complete_task: ['completed'],
  create_debt: ['personName', 'direction', 'amount', 'date', 'dueDate', 'note'],
  update_debt: ['dueDate', 'note'], pay_debt: ['amount', 'date', 'note'],
  void_payment: ['paymentId', 'reason'], void_debt: ['reason'],
  add_memory: ['text'], delete_memory: [],
  update_profile: ['persona', 'relationship', 'proactive', 'pause', 'resume'],
};
const money = cents => `${(cents / 100).toFixed(2)}元`;
const recordText = r => {
  const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
  return `${p.date} ${p.title}${r.kind === 'expense' ? `，${p.direction === 'income' ? '收入' : '支出'}${money(p.cents)}，分类${p.category}` : r.kind === 'weight' ? `，${p.kg}千克` : `，分类${taskCategory(p.category).label}${p.due ? `，提醒时间${new Date(p.due).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}` : '，不设提醒'}`}`;
};

// Only server-owned user messages or authenticated UI confirmation reach execute().
// Models can prepare operations, never grant themselves authorization.
export function createAssistantActions({ db, debts, isCalling = () => false, now = Date.now }) {
  db.exec(`CREATE TABLE IF NOT EXISTS assistant_actions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), operation TEXT NOT NULL,
    args TEXT NOT NULL, fingerprint TEXT NOT NULL, summary TEXT NOT NULL,
    status TEXT NOT NULL, created TEXT NOT NULL, expires TEXT NOT NULL,
    presented INTEGER NOT NULL DEFAULT 0, authorization TEXT, result TEXT
  );
  CREATE INDEX IF NOT EXISTS assistant_actions_user ON assistant_actions(user_id,created);`);
  const rows = (table, userId) => db.prepare(`SELECT * FROM ${table} WHERE user_id=? ORDER BY id`).all(userId);
  const owner = userId => db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  function fingerprint(userId) {
    const u = owner(userId);
    return createHash('sha256').update(JSON.stringify([
      rows('records', userId), rows('debt_bills', userId), rows('debt_payments', userId),
      rows('debt_people', userId), rows('memories', userId),
      [u.persona, u.relationship, u.proactive, u.quiet_until],
    ])).digest('hex');
  }
  function get(userId, id) {
    const action = db.prepare('SELECT * FROM assistant_actions WHERE id=? AND user_id=?').get(id, userId);
    if (!action) fail('待确认操作不存在', 404);
    return action;
  }
  function pending(userId) {
    return db.prepare("SELECT id,operation,summary,created,expires,presented FROM assistant_actions WHERE user_id=? AND status='pending' AND expires>? ORDER BY created DESC LIMIT 1")
      .get(userId, new Date(now()).toISOString()) || null;
  }
  function cancel(userId, id) {
    get(userId, id);
    db.prepare("UPDATE assistant_actions SET status='cancelled' WHERE id=? AND user_id=? AND status='pending'").run(id, userId);
  }
  function invalidate(userId) {
    db.prepare("UPDATE assistant_actions SET status='superseded' WHERE user_id=? AND status='pending'").run(userId);
  }
  function present(userId, id) {
    db.prepare("UPDATE assistant_actions SET presented=1 WHERE id=? AND user_id=? AND status='pending'").run(id, userId);
  }
  function record(userId, id, revision) {
    const r = db.prepare('SELECT * FROM records WHERE id=? AND user_id=?').get(id, userId);
    if (!r) fail('记录不存在', 404);
    if (!Number.isInteger(revision) || r.revision !== revision) fail('记录已变化，请重新核对', 409);
    if (r.kind === 'debt_repayment' || r.source === 'debt-repayment') fail('还款需通过原欠条操作，不能单独修改关联收入', 409);
    return r;
  }
  function validPayload(kind, p) {
    const valid = validateRecord(kind, p);
    if (kind === 'expense' && valid.direction === 'income' &&
        (['债务', '收回借款', '收回欠款', '还款'].includes(valid.category) || /还款|收回.*(?:借款|欠款)/.test(valid.title))) {
      fail('收回欠款必须关联原欠条，不能仅创建或修改普通收入');
    }
    return valid;
  }
  function receiptUnique(userId, p, id) {
    if (p.receipt?.imageHash && db.prepare("SELECT id FROM records WHERE user_id=? AND id<>? AND deleted_at IS NULL AND status='confirmed' AND json_extract(payload,'$.receipt.imageHash')=?")
      .get(userId, id, p.receipt.imageHash)) fail('这张小票已入账，请勿重复保存', 409);
  }
  function mutate(userId, a, actionId) {
    const d = a.data || {};
    if (a.operation === 'confirm_records') {
      if (!Array.isArray(d.items) || !d.items.length || d.items.length > 30 || new Set(d.items.map(i => i.id)).size !== d.items.length) fail('请选择1至30条不同草稿');
      const details = d.items.map(item => {
        const r = record(userId, item.id, item.revision);
        if (r.status !== 'pending' || r.deleted_at) fail('草稿状态已变化', 409);
        const p = validPayload(r.kind, JSON.parse(r.payload));
        receiptUnique(userId, p, r.id);
        db.prepare("UPDATE records SET status='confirmed',revision=revision+1 WHERE id=? AND user_id=?").run(r.id, userId);
        return recordText(r);
      });
      return `正式保存${details.length}条记录：\n${details.join('\n')}`;
    }
    if (['update_record', 'trash_record', 'restore_record', 'complete_task'].includes(a.operation)) {
      const r = record(userId, a.id, a.revision);
      const before = recordText(r);
      if (a.operation !== 'restore_record' && r.deleted_at) fail('记录已删除，请先恢复', 409);
      if (a.operation === 'update_record') {
        if (!['pending', 'confirmed'].includes(r.status)) fail('记录不能修改', 409);
        const p = validPayload(r.kind, { ...JSON.parse(r.payload), ...d });
        if (r.status === 'confirmed') receiptUnique(userId, p, r.id);
        db.prepare('UPDATE records SET payload=?,revision=revision+1 WHERE id=? AND user_id=?').run(JSON.stringify(p), r.id, userId);
        return `修改${r.status === 'pending' ? '草稿' : '记录'}：\n原来：${before}\n改为：${recordText({ ...r, payload: p })}`;
      }
      if (a.operation === 'complete_task') {
        if (r.kind !== 'task' || r.status !== 'confirmed' || typeof d.completed !== 'boolean') fail('请选择已确认待办并指定完成状态');
        db.prepare('UPDATE records SET completed=?,revision=revision+1 WHERE id=? AND user_id=?').run(Number(d.completed), r.id, userId);
        return `${d.completed ? '完成' : '重新打开'}待办：${before}`;
      }
      const restoring = a.operation === 'restore_record';
      if (restoring && !r.deleted_at) fail('记录不在回收站', 409);
      if (restoring && r.status === 'confirmed') receiptUnique(userId, JSON.parse(r.payload), r.id);
      db.prepare('UPDATE records SET deleted_at=?,revision=revision+1 WHERE id=? AND user_id=?').run(restoring ? null : iso(), r.id, userId);
      return `${restoring ? '恢复记录' : '移入回收站（可恢复）'}：${before}`;
    }
    if (a.operation === 'create_debt') {
      const result = debts.create(userId, { ...d, requestId: actionId });
      const bill = result.bills.find(b => b.id === result.billId);
      return `新增${bill.direction === 'receivable' ? '别人欠我' : '我欠别人'}的个人欠条：${d.personName}，${money(bill.principal_cents)}，借款日${bill.loan_date}，约定还款日${bill.due_date || '未约定'}，备注${bill.note || '无'}。不自动新增收支。`;
    }
    if (['confirm_repayment', 'update_debt', 'pay_debt', 'void_payment', 'void_debt'].includes(a.operation)) {
      const state = debts.list(userId);
      const b = state.bills.find(bill => bill.id === a.id);
      if (!b || b.voided_at) fail('有效原欠条不存在', 404);
      if (!Number.isInteger(a.revision) || b.revision !== a.revision) fail('原欠条已变化，请重新核对', 409);
      const name = state.people.find(p => p.id === b.person_id).name;
      const label = `${name}，${b.loan_date}借款${money(b.principal_cents)}，备注${b.note || '无'}，欠条尾号${b.id.slice(-6)}`;
      if (a.operation === 'update_debt') {
        debts.update(userId, b.id, { dueDate: b.due_date, note: b.note, ...d, revision: b.revision });
        return `修改欠条：${label}\n约定还款日：${b.due_date || '未约定'} → ${d.dueDate === undefined ? b.due_date || '未约定' : d.dueDate || '未约定'}\n备注：${b.note || '无'} → ${d.note ?? b.note ?? '无'}。本金不变。`;
      }
      if (a.operation === 'void_debt') {
        debts.voidBill(userId, b.id, { reason: d.reason, revision: b.revision });
        return `作废欠条：${label}，原因：${d.reason}。保留作废记录，不再计入欠款余额。`;
      }
      if (a.operation === 'void_payment') {
        const p = state.payments.find(p => p.id === d.paymentId && p.bill_id === b.id);
        if (!p) fail('还款不存在', 404);
        debts.voidPayment(userId, b.id, p.id, { reason: d.reason, revision: b.revision });
        return `撤销还款：${label}，${p.date}还款${money(p.cents)}，剩余欠款${money(b.balanceCents)} → ${money(b.balanceCents + p.cents)}。${p.ledger_record_id ? '同步撤销对应收入。' : ''}原因：${d.reason}`;
      }
      let payment = { amount: d.amount, date: d.date, note: d.note, revision: b.revision, requestId: actionId };
      if (a.operation === 'confirm_repayment') {
        const draft = db.prepare("SELECT * FROM records WHERE id=? AND user_id=? AND kind='debt_repayment' AND status='pending' AND deleted_at IS NULL").get(d.draftId, userId);
        if (!draft || draft.revision !== d.draftRevision) fail('还款草稿已变化', 409);
        const p = JSON.parse(draft.payload);
        if (p.personName !== name) fail('草稿欠款人与原欠条不一致，先更正草稿');
        payment = { ...payment, amount: p.amount, date: p.date, note: p.note, requestId: draft.id, draftId: draft.id, draftRevision: draft.revision };
      }
      const result = debts.pay(userId, b.id, payment);
      const remaining = result.bills.find(item => item.id === b.id).balanceCents;
      return `记录${b.direction === 'receivable' ? '收到' : '付出'}还款：${label}\n实际还款日${payment.date}，本次${money(Math.round(Number(payment.amount) * 100))}，备注${payment.note || '无'}。\n剩余欠款${money(b.balanceCents)} → ${money(remaining)}；约定还款日${b.due_date || '未约定'}不变。${b.direction === 'receivable' ? '同时新增一笔相同金额的债务收入。' : '不自动新增支出。'}`;
    }
    if (a.operation === 'add_memory') {
      const text = cleanText(d.text, 300, '记忆');
      if (/sk-[a-z0-9_-]{12,}|Bearer\s+\S+|密码|密钥/i.test(text)) fail('不能保存认证信息');
      if (rows('memories', userId).length >= 100) fail('记忆已满，请先整理');
      db.prepare('INSERT OR IGNORE INTO memories VALUES (?,?,?,?)').run(actionId, userId, text, iso());
      return `记住：${text}`;
    }
    if (a.operation === 'delete_memory') {
      const m = db.prepare('SELECT * FROM memories WHERE id=? AND user_id=?').get(a.id, userId);
      if (!m) fail('记忆不存在', 404);
      db.prepare('DELETE FROM memories WHERE id=? AND user_id=?').run(a.id, userId);
      return `删除记忆：${m.text}。原聊天记录不变。`;
    }
    if (a.operation === 'update_profile') {
      if (!Object.keys(d).length || Object.keys(d).some(k => !['persona', 'relationship', 'proactive', 'pause', 'resume'].includes(k))) fail('不支持修改该设置');
      const u = owner(userId);
      const persona = d.persona ?? u.persona, relationship = d.relationship ?? u.relationship;
      if (!PERSONAS[persona] || !['friend', 'romance'].includes(relationship)) fail('设置无效');
      if (relationship === 'romance' && ageOn(u.birthday) < 18) fail('未成年人仅开放朋友模式', 403);
      if (isCalling(userId) && (persona !== u.persona || relationship !== u.relationship)) fail('请先结束通话再切换助手或关系模式', 409);
      for (const key of ['proactive', 'pause', 'resume']) if (d[key] !== undefined && typeof d[key] !== 'boolean') fail('设置值无效');
      if (d.pause && d.resume) fail('不能同时暂停和恢复');
      const quiet = d.pause ? new Date(a.preparedAt + 86400000).toISOString() : d.resume ? null : u.quiet_until;
      const proactive = d.proactive === undefined ? u.proactive : Number(d.proactive);
      db.prepare('UPDATE users SET persona=?,relationship=?,proactive=?,quiet_until=? WHERE id=?').run(persona, relationship, proactive, quiet, userId);
      return `更新设置：助手${PERSONAS[u.persona].label} → ${PERSONAS[persona].label}；关系${u.relationship === 'romance' ? '亲密' : '朋友'} → ${relationship === 'romance' ? '亲密' : '朋友'}；主动关心${u.proactive ? '开启' : '关闭'} → ${proactive ? '开启' : '关闭'}；暂停至${quiet || '不暂停'}。记忆和账目保留。`;
    }
    fail('不支持的操作，不会执行', 403);
  }
  function prepare(userId, input) {
    if (!input || !ACTION_NAMES.includes(input.operation)) fail('不支持的操作，禁止上传、分享或控制手机', 403);
    if (Object.keys(input).some(key => !['operation', 'id', 'revision', 'data'].includes(key)) ||
        (input.data != null && (typeof input.data !== 'object' || Array.isArray(input.data))) ||
        Object.keys(input.data || {}).some(key => !ACTION_FIELDS[input.operation].includes(key))) {
      fail('不支持的操作字段，请先核对具体需求');
    }
    const args = JSON.parse(JSON.stringify(input));
    args.preparedAt = now();
    const id = randomUUID();
    const before = fingerprint(userId);
    let summary;
    // Validate using the same mutation code, then roll back every dry-run write.
    db.exec('SAVEPOINT assistant_preview');
    try { summary = mutate(userId, args, id); }
    finally { db.exec('ROLLBACK TO assistant_preview; RELEASE assistant_preview'); }
    invalidate(userId);
    const expires = new Date(now() + 5 * 60000).toISOString();
    db.prepare("INSERT INTO assistant_actions(id,user_id,operation,args,fingerprint,summary,status,created,expires) VALUES (?,?,?,?,?,?,'pending',?,?)")
      .run(id, userId, args.operation, JSON.stringify(args), before, summary, iso(), expires);
    return { id, status: 'pending', summary, expires, message: '尚未执行。完整说明以上内容，再请用户回复“确认”或“取消”；不能替用户授权。' };
  }
  function execute(userId, id, authorization) {
    const a = get(userId, id);
    if (a.status === 'executed') return { id, status: a.status, summary: a.result };
    if (a.status !== 'pending' || a.expires <= new Date(now()).toISOString()) fail('确认已失效，请重新核对操作', 409);
    if (!a.presented) fail('操作内容还未展示完，请核对后确认', 409);
    db.exec('SAVEPOINT assistant_execute');
    try {
      if (fingerprint(userId) !== a.fingerprint) fail('数据已变化，未执行。请重新核对后确认', 409);
      const summary = mutate(userId, JSON.parse(a.args), a.id);
      db.prepare("UPDATE assistant_actions SET status='executed',authorization=?,result=? WHERE id=? AND user_id=?")
        .run(JSON.stringify(authorization), summary, id, userId);
      db.exec('RELEASE assistant_execute');
      return { id, status: 'executed', summary };
    } catch (error) {
      db.exec('ROLLBACK TO assistant_execute; RELEASE assistant_execute');
      db.prepare("UPDATE assistant_actions SET status='failed',result=? WHERE id=? AND user_id=?").run(error.message, id, userId);
      throw error;
    }
  }
  function userReply(userId, text, authorization, expectedId) {
    const a = pending(userId);
    const normalized = text.normalize('NFKC').trim()
      .replace(/[確認執]/g, char => ({ 確: '确', 認: '认', 執: '执' })[char])
      .replace(/[。！!，,\s]/g, '');
    if (/^(取消|不确认|不要执行|先别执行)$/.test(normalized)) {
      if (a) cancel(userId, a.id);
      return '已取消，未执行任何更改。';
    }
    if (!/^(确认|确认执行|确认保存)$/.test(normalized)) { invalidate(userId); return null; }
    if (!a || (expectedId !== undefined && a.id !== expectedId)) return '没有已核对且有效的待执行操作，请先说明要处理哪件事。';
    try { const result = execute(userId, a.id, authorization); return `已执行：\n${result.summary}`; }
    catch (error) { return `${error.message}。没有执行这次更改。`; }
  }
  return { prepare, pending, present, execute, cancel, invalidate, userReply };
}
