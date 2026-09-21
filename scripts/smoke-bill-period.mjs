import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
const year = today.slice(0, 4), month = today.slice(0, 7);
const oldYear = String(Number(year) - 3);
const record = (id, date, cents, direction = 'expense', extra = {}) => ({
  id, kind: 'expense', status: 'confirmed', created: `${date}T00:00:00Z`,
  payload: { title: `账单测试${id}`, category: direction === 'income' ? '工资' : '午餐', date, cents, amount: cents / 100, direction }, ...extra,
});
let records = [
  record('1', today, 2850), record('2', today, 500000, 'income'),
  record('3', `${oldYear}-12-31`, 1094396), record('4', `${oldYear}-12-31`, 26000, 'income'),
  record('pending', today, 99999, 'income', { status: 'pending' }),
  record('deleted', today, 99999, 'income', { deleted_at: today }),
];
let debts = { people: [], bills: [], payments: [] };
const state = () => ({
  user: { id: 'period-test', name: '测试', username: 'test', persona: 'gentle', relationship: 'friend', adult: true },
  memories: [], messages: [], records,
});
mkdirSync('artifacts', { recursive: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/state', route => route.fulfill({ json: state() }));
  await page.route('**/api/debts', route => route.fulfill({ json: debts }));
  await page.addInitScript(() => localStorage.setItem('zaizai-token', 'browser-fixture-only'));
  async function fits() {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const overflow = await page.locator('.bill-table .bill-money, .bill-summary .bill-money').evaluateAll(values => values.filter(value => {
      const cell = value.closest('td') || value.parentElement;
      return value.getBoundingClientRect().width > cell.clientWidth + 1 || getComputedStyle(value).whiteSpace !== 'nowrap';
    }).map(value => value.textContent));
    assert.deepEqual(overflow, [], 'Amounts must fit on one line');
    const alignment = await page.locator('.bill-table').evaluateAll(tables => tables.every(table => {
      const headers = [...table.querySelectorAll('thead th')];
      return [...table.querySelectorAll('tbody tr')].every(row => {
        if (row.querySelector('.bill-table-empty')) return true;
        return [1, 2, 3].every(index => {
          const range = document.createRange();
          range.selectNodeContents(headers[index]);
          const title = range.getBoundingClientRect();
          const amount = row.children[index].querySelector('.bill-money').getBoundingClientRect();
          return Math.abs(title.x + title.width / 2 - amount.x - amount.width / 2) < 1;
        });
      });
    }));
    assert.equal(alignment, true, 'Column titles and amounts share a centered vertical axis');
  }
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173');
    await page.getByTestId('ledger-expense').waitFor();
    assert.equal(await page.getByRole('textbox', { name: '搜索账目' }).count(), 0);
    assert.equal(await page.locator('.mobile-nav').getByRole('button', { name: '助手', exact: true }).count(), 0);
    assert.equal(await page.locator('.module-actions .assistant-entry').count(), 0);
    await page.getByRole('button', { name: '展开助手', exact: true }).click({ position: { x: 12, y: 32 } });
    await page.getByRole('textbox', { name: '发送给助手的消息' }).waitFor();
    await page.locator('.mobile-nav').getByRole('button', { name: '我的', exact: true }).click();
    await page.locator('.mine-statistics').waitFor();
    assert.deepEqual(await page.locator('.mine-statistics strong').allTextContents(), ['1', '2', '4'], 'Profile statistics exclude drafts and deleted records');
    assert.equal(await page.locator('.mobile-nav').getByRole('button', { name: '我的', exact: true }).getAttribute('aria-current'), 'page');
    await fits();
    await page.screenshot({ path: `artifacts/mine-home-${width}.png` });
    await page.locator('.mine-menu').getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('heading', { name: '设置', exact: true }).waitFor();
    await page.getByRole('button', { name: '返回我的' }).click();
    await page.getByRole('button', { name: '我的助手', exact: true }).click();
    await page.getByRole('checkbox', { name: '主动关心' }).waitFor();
    await page.getByRole('button', { name: /^我们记得的事/ }).click();
    await page.getByRole('dialog', { name: '我们记得的事' }).waitFor();
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await page.locator('.mobile-nav').getByRole('button', { name: '记账', exact: true }).click();
    await page.getByRole('button', { name: '展开助手', exact: true }).click({ position: { x: 12, y: 32 } });
    await page.getByRole('textbox', { name: '发送给助手的消息' }).waitFor();
    await page.locator('.mobile-nav').getByRole('button', { name: '记账', exact: true }).click();
    assert.equal(await page.getByTestId('ledger-expense').textContent(), '28.50');
    assert.equal(await page.getByRole('button', { name: '支出分类统计', exact: true }).locator('.lucide-chart-spline').count(), 1);
    assert.ok((await page.locator('.ledger-query').boundingBox()).height <= 110, 'Date/search area stays compact');
    await page.screenshot({ path: `artifacts/compact-ledger-${width}.png` });
    const summaryHeight = (await page.locator('.ledger-head').boundingBox()).height;
    assert.ok(summaryHeight <= 185, `Summary spacing stays compact without shrinking amounts: ${summaryHeight}px`);
    const spacing = await page.locator('.ledger-summary').evaluate(element => ({
      top: getComputedStyle(element).paddingTop, gap: getComputedStyle(element).rowGap,
    }));
    assert.deepEqual(spacing, { top: '0px', gap: '4px' });
    const overviewBox = await page.locator('.ledger-overview').boundingBox();
    const headingBox = await page.locator('.ledger-page>.page-heading').boundingBox();
    assert.equal(headingBox.height, 64, 'Header reserves 16px of additional top space');
    assert.equal(await page.locator('.ledger-page>.page-heading').evaluate(node => getComputedStyle(node).paddingTop), '16px');
    const menuBox = await page.getByRole('tablist', { name: '账单视图' }).boundingBox();
    const incomeBox = await page.locator('.ledger-overview .summary-income').boundingBox();
    for (const tab of ['月账单', '年账单', '债务', '明细']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      assert.deepEqual(await page.locator('.ledger-page>.page-heading').boundingBox(), headingBox, `${tab}: header keeps the same position`);
      assert.deepEqual(await page.locator('.ledger-overview').boundingBox(), overviewBox, `${tab}: summary bounds match details`);
      assert.deepEqual(await page.getByRole('tablist', { name: '账单视图' }).boundingBox(), menuBox, `${tab}: menu does not move`);
      if (tab === '债务') await page.locator('[aria-label="全部债务汇总"][aria-busy="false"]').waitFor();
      assert.deepEqual(await page.locator('.ledger-overview').boundingBox(), overviewBox, `${tab}: loading does not shift layout`);
      const insets = await page.locator('.ledger-overview').evaluate(header => {
        const style = getComputedStyle(header);
        const box = header.getBoundingClientRect();
        const toolbar = header.querySelector('.ledger-toolbar').getBoundingClientRect();
        const summary = header.querySelector('.ledger-summary').getBoundingClientRect();
        return {
          padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
          edges: [toolbar.left - box.left, box.right - toolbar.right, toolbar.top - box.top,
            summary.left - box.left, box.right - summary.right, box.bottom - summary.bottom],
        };
      });
      assert.deepEqual(insets.padding, ['12px', '18px', '12px', '18px'], `${tab}: compact balanced padding`);
      assert.ok(insets.edges.every((value, index) => Math.abs(value - ([2, 5].includes(index) ? 12 : 18)) < 1), `${tab}: toolbar and amounts share aligned edges`);
      if (tab === '债务') {
        const metrics = await page.locator('.ledger-overview').evaluate(header => {
          const left = header.querySelector('.summary-expense > strong');
          const right = header.querySelector('.debt-summary-payable > strong');
          const leftLabel = header.querySelector('.summary-expense > span');
          const rightLabel = header.querySelector('.debt-summary-payable > span');
          const toolbar = header.querySelector('.ledger-toolbar');
          return {
            sizes: [getComputedStyle(left).fontSize, getComputedStyle(right).fontSize],
            labels: [getComputedStyle(leftLabel).fontSize, getComputedStyle(rightLabel).fontSize],
            tops: [...toolbar.children].map(item => item.getBoundingClientRect().y),
            bottoms: [left, right].map(item => item.getBoundingClientRect().bottom),
          };
        });
        assert.equal(metrics.sizes[0], metrics.sizes[1]);
        assert.equal(metrics.labels[0], metrics.labels[1]);
        assert.equal(metrics.tops[0], metrics.tops[1]);
        assert.equal(metrics.bottoms[0], metrics.bottoms[1]);
      } else {
        const nextIncomeBox = await page.locator('.ledger-overview .summary-income').boundingBox();
        assert.ok(Math.abs(nextIncomeBox.y - incomeBox.y) < 1, `${tab}: right amount row stays aligned`);
      }
      const overlaps = await page.locator('.ledger-overview .summary-income,.ledger-overview .summary-average').evaluateAll(rows => rows.some(row => {
        const label = row.querySelector(':scope > span').getBoundingClientRect();
        const amount = row.querySelector(':scope > strong').getBoundingClientRect();
        return label.right > amount.left + 1;
      }));
      assert.equal(overlaps, false, `${tab}: summary labels and amounts do not overlap`);
      await page.screenshot({ path: `artifacts/aligned-${tab}-${width}.png` });
    }
    await page.getByRole('button', { name: '支出分类统计', exact: true }).click();
    await page.getByRole('region', { name: '支出分类统计', exact: true }).waitFor();
    assert.equal(await page.locator('.category-line').count(), 1, 'The category chart itself is unchanged');
    await page.getByRole('button', { name: '查看账目明细', exact: true }).click();
    await page.screenshot({ path: `artifacts/blue-ledger-${width}.png` });
    assert.equal(await page.getByRole('tab', { name: '明细', exact: true }).getAttribute('aria-selected'), 'true');
    await page.getByRole('button', { name: '选择账目日期', exact: true }).waitFor();
    const tabTop = (await page.getByRole('tablist', { name: '账单视图' }).boundingBox()).y;
    await page.getByRole('tab', { name: '年账单', exact: true }).click();
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal((await page.getByRole('tablist', { name: '账单视图' }).boundingBox()).y, tabTop);
    assert.equal(await page.getByRole('button', { name: '返回记账' }).count(), 0);
    await page.getByRole('region', { name: '年账单汇总', exact: true }).waitFor();
    assert.equal(await page.locator('.bill-table tbody tr').count(), 2);
    assert.equal(await page.locator('.bill-summary-net .bill-money').getAttribute('aria-label'), '-5,712.46 元');
    await fits();
    await page.screenshot({ path: `artifacts/blue-bill-year-${width}.png` });
    await page.getByRole('button', { name: `查看${oldYear}年各月账单`, exact: true }).click();
    assert.equal(await page.getByRole('tab', { name: '月账单', exact: true }).getAttribute('aria-selected'), 'true');
    assert.equal(await page.getByLabel('选择账单年份').inputValue(), oldYear);
    assert.equal(await page.locator('.bill-summary-net .bill-money').getAttribute('aria-label'), '-10,683.96 元');
    await fits();
    assert.equal(await page.locator('.bill-period-column').evaluate(node => node.getBoundingClientRect().width), 44, 'Month column stays compact');
    await page.screenshot({ path: `artifacts/blue-bill-month-${width}.png` });
    await page.getByRole('button', { name: `查看${oldYear}-12月明细`, exact: true }).click();
    assert.equal(await page.getByRole('tab', { name: '明细', exact: true }).getAttribute('aria-selected'), 'true');
    assert.equal(await page.getByRole('button', { name: '选择账目日期', exact: true }).getAttribute('title'), `${oldYear}-12 · 整月`);
    assert.equal(await page.locator('.ledger-row').count(), 2);
    await page.getByRole('button', { name: '收支与分类筛选', exact: true }).click();
    await page.getByLabel('筛选收支').selectOption('income');
    assert.equal(await page.locator('.ledger-row').count(), 1);
    assert.equal(await page.locator('.ledger-amount').textContent(), '+260.00');
    await page.screenshot({ path: `artifacts/blue-bill-details-${width}.png` });
    await page.getByRole('tab', { name: '月账单', exact: true }).click();
    assert.equal(await page.getByLabel('选择账单年份').inputValue(), oldYear);
    await page.getByRole('tab', { name: '明细', exact: true }).click();
    assert.equal(await page.getByLabel('筛选收支').inputValue(), 'income');
    assert.equal(await page.locator('.ledger-row').count(), 1);
    await page.getByRole('button', { name: '选择账目日期', exact: true }).click();
    await page.getByRole('dialog', { name: '选择账目日期', exact: true }).waitFor();
    assert.equal(await page.getByRole('listbox', { name: '日', exact: true }).getByRole('option', { selected: true }).textContent(), '整月');
    for (const label of ['年', '月', '日']) {
      const column = page.getByRole('listbox', { name: label, exact: true });
      const box = await column.boundingBox();
      const selected = await column.getByRole('option', { selected: true }).boundingBox();
      assert.ok(Math.abs(selected.y + selected.height / 2 - box.y - box.height / 2) < 2, 'Applied selection is centered on opening');
    }
    await page.getByRole('button', { name: '确定', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '选择账目日期', exact: true }).getAttribute('title'), `${oldYear}-12 · 整月`, 'Default confirmation retains the whole month');
    await page.getByRole('button', { name: '选择账目日期', exact: true }).click();
    assert.equal(await page.getByRole('listbox', { name: '日', exact: true }).getByRole('option').count(), 32);
    const wholeMonth = await page.getByRole('button', { name: '查看整月', exact: true }).boundingBox();
    assert.ok(wholeMonth.y + wholeMonth.height <= 844, 'Popup actions fit in viewport');
    await page.screenshot({ path: `artifacts/date-wheels-${width}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole('listbox', { name: '日', exact: true }).press('End');
    assert.equal(await page.getByRole('button', { name: '选择账目日期', exact: true }).getAttribute('title'), `${oldYear}-12 · 整月`, 'Draft must not apply before confirmation');
    await page.getByRole('button', { name: '确定', exact: true }).click();
    assert.equal(await page.locator('.ledger-row').count(), 1);
    assert.equal(await page.locator('.ledger-date-dialog').count(), 0);
    assert.equal(await page.getByRole('button', { name: '选择账目日期', exact: true }).getAttribute('title'), `${oldYear}-12-31`);
    await page.screenshot({ path: `artifacts/compact-ledger-day-${width}.png` });
    await page.getByRole('button', { name: '选择账目日期', exact: true }).click();
    await page.getByRole('button', { name: '查看整月', exact: true }).click();
    assert.match(await page.getByRole('button', { name: '选择账目日期', exact: true }).getAttribute('title'), /整月/);
    await page.getByRole('tab', { name: '月账单', exact: true }).click();
    await page.getByLabel('选择账单年份').selectOption(year);
    assert.equal(await page.locator('.bill-summary-net .bill-money').getAttribute('aria-label'), '4,971.50 元');
    assert.equal(await page.getByRole('tab', { name: '月账单', exact: true }).getAttribute('aria-selected'), 'true');
    await page.getByRole('button', { name: `查看${month}月明细`, exact: true }).click();
    assert.equal(await page.locator('.ledger-row').count(), 2);
    assert.equal(await page.getByTestId('ledger-expense').textContent(), '28.50');
    await page.getByRole('button', { name: '记一笔', exact: true }).click();
    if (await page.locator('.add-menu').count()) await page.locator('.add-menu').getByRole('button', { name: '记一笔', exact: true }).click();
    await page.getByRole('button', { name: '收入', exact: true }).click();
    await page.screenshot({ path: `artifacts/blue-income-${width}.png` });
    await page.getByRole('button', { name: '债务', exact: true }).click();
    await page.getByRole('dialog', { name: '收回欠款', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '我欠别人', exact: true }).count(), 0);
    await page.getByRole('button', { name: '关闭', exact: true }).click();
  }
  records = [record('day-a', `${month}-01`, 1234), record('day-b', `${month}-02`, 9876, 'income')];
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.reload();
    await page.locator('.ledger-day-toggle').first().waitFor();
    assert.equal(await page.locator('.ledger-day-toggle[aria-expanded="true"]').count(), 2, 'Whole month defaults to all days expanded');
    const first = page.getByRole('button', { name: `收起${month}-01账目`, exact: true });
    await first.click();
    assert.equal(await page.locator(`#ledger-day-${month}-01`).isVisible(), false);
    assert.equal(await page.locator(`#ledger-day-${month}-02`).isVisible(), true, 'Days collapse independently');
    assert.equal(await page.getByTestId('ledger-expense').textContent(), '12.34', 'Collapse does not change totals');
    assert.equal(await page.locator('.ledger-list-scroll').evaluate(node => node.scrollWidth > node.clientWidth), false, 'Day headers do not cause horizontal scrolling');
    assert.equal(await page.locator('.ledger-day-heading').evaluateAll(headers => headers.every(header => {
      const total = header.querySelector('.day-totals').getBoundingClientRect();
      const toggle = header.querySelector('.ledger-day-toggle').getBoundingClientRect();
      return total.right + 4 <= toggle.left && toggle.right <= header.getBoundingClientRect().right;
    })), true, 'Daily totals leave room for the toggle');
    await page.screenshot({ path: `artifacts/ledger-day-collapse-${width}.png` });
    await page.getByRole('button', { name: `展开${month}-01账目`, exact: true }).click();
    assert.equal(await page.locator('.ledger-row:visible').count(), 2);
    await page.getByRole('button', { name: `收起${month}-01账目`, exact: true }).click();
    await page.getByRole('button', { name: '选择账目日期', exact: true }).click();
    await page.getByRole('listbox', { name: '日', exact: true }).press('Home');
    await page.getByRole('listbox', { name: '日', exact: true }).press('ArrowDown');
    await page.getByRole('button', { name: '确定', exact: true }).click();
    assert.equal(await page.locator('.ledger-day-toggle').count(), 0, 'A specific day has no collapse control');
    assert.equal(await page.locator('.ledger-row:visible').count(), 1, 'A previously collapsed day is visible when selected');
    for (const tab of ['月账单', '年账单', '债务']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      assert.equal(await page.locator('.ledger-day-toggle').count(), 0, `${tab} has no daily collapse controls`);
    }
  }
  records = [record('big', today, 100000000)];
  await page.setViewportSize({ width: 320, height: 740 });
  await page.reload();
  await page.getByRole('tab', { name: '年账单', exact: true }).click();
  await fits();
  assert.equal(await page.locator('.bill-summary-net .bill-money').textContent(), '-100.00万');
  await page.screenshot({ path: 'artifacts/blue-bill-million-320.png' });
  records = [];
  await page.reload();
  await page.getByRole('tab', { name: '月账单', exact: true }).click();
  assert.equal(await page.locator('.bill-table tbody tr').count(), 1);
  assert.equal(await page.locator('.bill-summary-net .bill-money').textContent(), '0.00');
  await fits();
  await page.getByRole('tab', { name: '明细', exact: true }).click();
  await page.getByRole('button', { name: '选择账目日期', exact: true }).click();
  const wheel = label => page.getByRole('listbox', { name: label, exact: true });
  assert.equal(await wheel('月').getByRole('option').count(), Number(month.slice(5)));
  assert.equal(await wheel('日').getByRole('option').count(), Number(today.slice(8)) + 1);
  for (let y = Number(year); y > 2024; y--) await wheel('年').press('ArrowUp');
  await wheel('月').press('Home');
  await wheel('日').press('End');
  await wheel('月').press('ArrowDown');
  assert.equal(await wheel('日').getByRole('option').count(), 30);
  assert.equal(await wheel('日').getByRole('option', { selected: true }).textContent(), '29日');
  await page.getByRole('button', { name: '确定', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '选择账目日期', exact: true }).getAttribute('title'), '2024-02-29');
  await page.getByRole('button', { name: '选择账目日期', exact: true }).click();
  await wheel('年').press('ArrowUp');
  assert.equal(await wheel('日').getByRole('option').count(), 29);
  assert.equal(await wheel('日').getByRole('option', { selected: true }).textContent(), '28日');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.ledger-date-dialog').count(), 0);
  assert.equal(await page.getByRole('button', { name: '选择账目日期', exact: true }).getAttribute('title'), '2024-02-29', 'Cancel preserves applied date');
  await page.getByRole('button', { name: '选择账目日期', exact: true }).click();
  await wheel('日').hover();
  await page.mouse.wheel(0, -80);
  await page.waitForTimeout(500);
  assert.equal(await wheel('日').getByRole('option', { selected: true }).textContent(), '27日', 'Mouse wheel changes selected day');
  await page.mouse.click(10, 10);
  assert.equal(await page.locator('.ledger-date-dialog').count(), 0, 'Backdrop dismisses the calendar');
  records = Array.from({ length: 35 }, (_, i) => record(`scroll-${i}`, today, 100));
  records.push(...Array.from({ length: 12 }, (_, i) => record(`month-${i}`, `${year}-${String(i + 1).padStart(2, '0')}-01`, 100)));
  records.push(...Array.from({ length: 20 }, (_, i) => record(`year-${i}`, `${Number(year) - i - 1}-01-01`, 100)));
  debts = {
    people: Array.from({ length: 25 }, (_, i) => ({ id: `person-${i}`, name: `测试往来人${i}` })),
    bills: Array.from({ length: 25 }, (_, i) => ({ id: `bill-${i}`, person_id: `person-${i}`, direction: 'receivable', balanceCents: 10000, state: 'open' })),
    payments: [],
  };
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 740 });
    await page.reload();
    for (const [tab, selector] of [['明细', '.ledger-list-scroll'], ['月账单', '.bill-list-scroll'], ['年账单', '.bill-list-scroll'], ['债务', '.debt-scroll>section']]) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      const list = page.locator(selector);
      await list.waitFor();
      if (tab === '明细') await page.getByRole('button', { name: '收支与分类筛选' }).click();
      const fixed = page.locator('.ledger-page>.page-heading,.ledger-section-tabs,.ledger-overview,.ledger-query,.debt-direction,.debt-filters,.mobile-nav');
      const bounds = () => fixed.evaluateAll(nodes => nodes.map(node => ({ y: node.getBoundingClientRect().y, height: node.getBoundingClientRect().height })));
      const before = await bounds();
      assert.ok((await list.boundingBox()).height >= 200, `${tab}: useful list viewport`);
      await list.hover();
      await page.mouse.wheel(0, 550);
      await page.waitForTimeout(200);
      assert.ok(await list.evaluate(node => node.scrollTop > 0), `${tab}: list actually scrolls`);
      assert.deepEqual(await bounds(), before, `${tab}: header, filters and navigation stay fixed`);
      assert.equal(await page.evaluate(() => window.scrollY), 0);
      await page.screenshot({ path: `artifacts/fixed-${tab}-${width}.png` });
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS: annual/all-time and monthly/year totals, year picker, month details, income filtering, return state, debt income entry, million/empty states, blue mobile layouts. Fixtures only.');
} finally {
  await browser.close();
}
