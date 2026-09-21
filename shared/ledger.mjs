export const ledgerCategory = payload => payload.direction === 'income' && payload.category === '收回借款' ? '债务' : payload.category;

export function filterLedger(records, { month = '', date = '', query = '', category = '', direction = '' } = {}) {
  const needle = query.trim().toLocaleLowerCase();
  return records.filter(r => r.kind === 'expense' && r.status === 'confirmed' && !r.deleted_at &&
    (!month || r.payload.date.startsWith(`${month}-`)) &&
    (!date || r.payload.date === date) &&
    (!category || r.payload.category === category || ledgerCategory(r.payload) === category) &&
    (!direction || r.payload.direction === direction) &&
    (!needle || `${r.payload.title} ${r.payload.category} ${ledgerCategory(r.payload)} ${r.payload.date} ${(r.payload.cents / 100).toFixed(2)}`.toLocaleLowerCase().includes(needle)))
    .sort((a, b) => b.payload.date.localeCompare(a.payload.date) || b.created.localeCompare(a.created) || a.id.localeCompare(b.id));
}

export function billPeriods(records, today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })) {
  const years = new Map(), months = new Map();
  const empty = period => ({ period, income: 0, expense: 0, net: 0, count: 0 });
  years.set(today.slice(0, 4), empty(today.slice(0, 4)));
  months.set(today.slice(0, 7), empty(today.slice(0, 7)));
  const total = empty('');
  for (const { payload } of filterLedger(records)) {
    for (const [map, period] of [[years, payload.date.slice(0, 4)], [months, payload.date.slice(0, 7)]]) {
      if (!map.has(period)) map.set(period, empty(period));
      const summary = map.get(period);
      summary[payload.direction === 'income' ? 'income' : 'expense'] += payload.cents;
      summary.net = summary.income - summary.expense;
      summary.count++;
    }
    total[payload.direction === 'income' ? 'income' : 'expense'] += payload.cents;
    total.count++;
  }
  total.net = total.income - total.expense;
  const descending = map => [...map.values()].sort((a, b) => b.period.localeCompare(a.period));
  return { years: descending(years), months: descending(months), total };
}

export function summarizeLedger(records) {
  let expense = 0, income = 0;
  const categories = new Map();
  for (const record of filterLedger(records)) {
    const p = record.payload;
    if (p.direction === 'income') income += p.cents;
    else {
      expense += p.cents;
      categories.set(p.category, (categories.get(p.category) || 0) + p.cents);
    }
  }
  return { expense, income, net: income - expense,
    categories: [...categories].map(([name, cents]) => ({ name, cents })).sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name)) };
}

export function ledgerPeriodDays(records, month, today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })) {
  if (month) {
    // The period prefix can be YYYY (annual bill) or YYYY-MM (monthly bill).
    if (month.length === 4) {
      const start = Date.parse(`${month}-01-01`);
      const end = month === today.slice(0, 4) ? Date.parse(today) + 86400000 : Date.parse(`${Number(month) + 1}-01-01`);
      return Math.max(1, Math.round((end - start) / 86400000));
    }
    if (month === today.slice(0, 7)) return Number(today.slice(8));
    const [year, number] = month.split('-').map(Number);
    return new Date(Date.UTC(year, number, 0)).getUTCDate();
  }
  const dates = filterLedger(records).map(r => r.payload.date).sort();
  if (!dates.length) return 1;
  const end = dates.at(-1) > today ? dates.at(-1) : today;
  return Math.max(1, Math.round((Date.parse(end) - Date.parse(dates[0])) / 86400000) + 1);
}

export function ledgerCsv(records) {
  // Quote all fields and neutralize spreadsheet formulas in user-controlled text.
  const cell = value => {
    let text = String(value ?? '');
    if (/^[\s\uFEFF]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rows = [['日期', '收支', '金额（元）', '分类', '备注', '记录ID']];
  for (const record of filterLedger(records)) {
    const p = record.payload;
    rows.push([p.date, p.direction === 'income' ? '收入' : '支出', (p.cents / 100).toFixed(2), ledgerCategory(p), p.title, record.id]);
  }
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
