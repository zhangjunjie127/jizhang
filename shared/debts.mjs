export const debtToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });

export function debtAmountCents(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('金额最多保留两位小数');
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 100000000) throw new Error('金额需大于 0 且不超过 100 万元');
  return cents;
}

export function debtDate(value, label = '日期') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error(`${label}无效`);
  return value;
}

export function debtSummary(bill, payments) {
  const paidCents = payments.filter(payment => payment.bill_id === bill.id && !payment.voided_at)
    .reduce((sum, payment) => sum + payment.cents, 0);
  const balanceCents = bill.voided_at ? 0 : bill.principal_cents - paidCents;
  return { paidCents, balanceCents, state: bill.voided_at ? 'voided' : balanceCents === 0 ? 'settled' : 'open' };
}

export function debtTimeline(bill, payments) {
  let balanceCents = bill.principal_cents;
  return payments.filter(payment => payment.bill_id === bill.id)
    .sort((a, b) => a.date.localeCompare(b.date) || a.created.localeCompare(b.created) || a.id.localeCompare(b.id))
    .map(payment => {
      if (!payment.voided_at) balanceCents -= payment.cents;
      return { ...payment, balanceCents };
    });
}

export function groupDebts(people, bills, direction, includeVoided = false) {
  return people.map(person => {
    const items = bills.filter(bill => bill.person_id === person.id && bill.direction === direction && (includeVoided || !bill.voided_at));
    return { ...person, bills: items, balanceCents: items.reduce((sum, bill) => sum + bill.balanceCents, 0) };
  }).filter(person => person.bills.length)
    .sort((a, b) => b.balanceCents - a.balanceCents || a.name.localeCompare(b.name, 'zh-CN'));
}
