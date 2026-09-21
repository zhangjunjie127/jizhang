import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterLedger, summarizeLedger, ledgerCsv, billPeriods } from '../shared/ledger.mjs';

const record = (id, amount, options = {}) => ({
  id, kind: 'expense', status: 'confirmed', created: `2026-09-16T01:00:0${id}Z`,
  payload: { title: '午饭', category: '餐饮', date: '2026-09-16', cents: amount, direction: 'expense', ...options },
});
const records = [
  record('1', 2810), record('2', 600, { title: '地铁', category: '交通' }),
  record('3', 500000, { title: '工资', category: '工资', direction: 'income' }),
  record('4', 4200, { date: '2026-08-31' }),
  { ...record('5', 99999), status: 'pending' },
  { ...record('6', 99999), deleted_at: '2026-09-16' },
  { ...record('7', 99999), status: 'rejected' },
];

test('ledger filters share deterministic cents-based totals, exclude drafts and trash', () => {
  const month = filterLedger(records, { month: '2026-09' });
  assert.deepEqual(month.map(r => r.id), ['3', '2', '1']);
  assert.deepEqual(summarizeLedger(month), { expense: 3410, income: 500000, net: 496590,
    categories: [{ name: '餐饮', cents: 2810 }, { name: '交通', cents: 600 }] });
  assert.equal(filterLedger(records, { query: '28.10' })[0].id, '1');
  assert.equal(filterLedger(records, { category: '交通', direction: 'expense' }).length, 1);
  assert.equal(filterLedger(records, { query: '不存在' }).length, 0);
  assert.equal(summarizeLedger(filterLedger(records, { month: '2026-10' })).expense, 0);
  assert.equal(summarizeLedger(filterLedger(records, { month: '2026' })).expense, 7610);
  assert.equal(filterLedger(records, { month: '2025' }).length, 0);
});

test('CSV has BOM, exact amounts, escaped fields, no formulas, and excludes pending data', () => {
  const csv = ledgerCsv([...records, record('8', 1, { title: '=HYPERLINK("bad")\n一,二', category: ' @SUM(1)' })]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"28.10"'));
  assert.ok(csv.includes(`"'=HYPERLINK(""bad"")\n一,二"`));
  assert.ok(csv.includes(`"' @SUM(1)"`));
  assert.ok(!csv.includes('999.99'));
  assert.equal(ledgerCsv([]).split('\r\n').length, 2);
});

test('exact date filtering excludes other days and combines with category and month', () => {
  assert.deepEqual(filterLedger(records, { date: '2026-08-31' }).map(r => r.id), ['4']);
  assert.deepEqual(filterLedger(records, { date: '2026-09-16', category: '交通' }).map(r => r.id), ['2']);
  assert.deepEqual(filterLedger(records, { month: '2026-09', date: '2026-08-31' }), []);
  assert.deepEqual(filterLedger(records, { date: '2026-09-17' }), []);
});

test('bill reports use natural-year/month totals and exclude pending, rejected, deleted and non-ledger records', () => {
  const data = [...records,
    record('8', 12345, { date: '2023-12-31', direction: 'income' }),
    record('9', 250, { date: '2024-01-01' }),
    { ...record('a', 90000), kind: 'weight' },
  ];
  const reports = billPeriods(data, '2026-09-17');
  assert.deepEqual(reports.years.map(item => item.period), ['2026', '2024', '2023']);
  assert.deepEqual(reports.months.map(item => item.period), ['2026-09', '2026-08', '2024-01', '2023-12']);
  assert.deepEqual(reports.years[0], { period: '2026', income: 500000, expense: 7610, net: 492390, count: 4 });
  assert.deepEqual(reports.total, { period: '', income: 512345, expense: 7860, net: 504485, count: 6 });
  for (const annual of reports.years) {
    const months = reports.months.filter(item => item.period.startsWith(annual.period));
    assert.equal(months.reduce((sum, item) => sum + item.income, 0), annual.income);
    assert.equal(months.reduce((sum, item) => sum + item.expense, 0), annual.expense);
  }
});

test('empty statements include current year and month; negative balances and million amounts stay exact in cents', () => {
  const empty = billPeriods([], '2026-09-17');
  assert.deepEqual(empty.years, [{ period: '2026', income: 0, expense: 0, net: 0, count: 0 }]);
  assert.deepEqual(empty.months, [{ period: '2026-09', income: 0, expense: 0, net: 0, count: 0 }]);
  const large = billPeriods([record('1', 100000000), record('2', 29)], '2026-09-17');
  assert.equal(large.total.net, -100000029);
  assert.equal(large.years[0].net, large.months[0].net);
});

test('legacy repayment income is displayed, filtered and exported as debt without changing source records', () => {
  const repayment = record('1', 50000, { category: '收回借款', direction: 'income' });
  const income = record('2', 10000, { category: '债务', direction: 'income' });
  assert.equal(filterLedger([repayment, income], { category: '债务', direction: 'income' }).length, 2);
  assert.equal(filterLedger([repayment], { query: '债务' }).length, 1);
  assert.ok(ledgerCsv([repayment]).includes('"债务"'));
  assert.equal(repayment.payload.category, '收回借款');
  assert.equal(billPeriods([repayment, income], '2026-09-17').total.income, 60000);
});
