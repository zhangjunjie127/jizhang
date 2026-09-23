import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
mkdirSync('artifacts', { recursive: true });
try {
  for (const width of [320, 390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = [];
    const writes = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.url().includes('/api/') && !['GET', 'HEAD'].includes(request.method())) writes.push(request.url());
    });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.addInitScript(() => {
      localStorage.setItem('zaizai-token', 'calculator-fixture');
      location.hash = '#ledger';
    });
    await page.route('**/api/**', route => route.fulfill({ json: route.request().url().includes('/state')
      ? { user: { id: 'calculator-test', name: '测试', persona: 'gentle' }, records: [], messages: [], memories: [] }
      : {} }));
    await page.goto('http://127.0.0.1:5173/');
    await page.getByRole('tab', { name: '工具箱', exact: true }).click();
    assert.equal(await page.locator('.calc-open').count(), 11);
    assert.equal(await page.getByLabel('搜索工具').count(), 0);
    await page.getByRole('button', { name: '普通计算', exact: true }).first().click();
    assert.match(await page.getByRole('status').innerText(), /安卓安装包/);
    assert.equal(await page.locator('.calc-editor').count(), 0);
    const tabs = await page.locator('.ledger-section-tabs>button').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
    assert.ok(tabs.every(top => top === tabs[0]), 'tabs stay on one row');
    await page.screenshot({ path: `artifacts/calculator-tools-${width}.png`, fullPage: true });
    await page.locator('.calc-open').filter({ hasText: '折扣计算' }).first().click();
    await page.getByLabel('原价 / 元', { exact: true }).fill('100');
    await page.getByLabel('折扣 / 折', { exact: true }).fill('8.5');
    await page.getByLabel('折后优惠 / 元（选填）').fill('10');
    await page.getByRole('button', { name: '计算', exact: true }).click();
    assert.match(await page.locator('.calc-value').innerText(), /75/);
    await page.getByLabel('原价 / 元', { exact: true }).fill('200');
    assert.equal(await page.locator('.calc-result').count(), 0);
    await page.getByRole('button', { name: '清空计算' }).click();
    assert.equal(await page.getByLabel('原价 / 元', { exact: true }).inputValue(), '');
    await page.getByRole('button', { name: '返回工具箱' }).click();
    assert.equal(await page.getByRole('button', { name: '采购汇总', exact: true }).count(), 0);
    await page.getByRole('button', { name: '工资计算', exact: true }).click();
    await page.getByRole('button', { name: '计算', exact: true }).click();
    assert.match(await page.getByRole('alert').innerText(), /请填写税前月薪/);
    await page.getByLabel('税前月薪 / 元', { exact: true }).fill('10000');
    await page.getByRole('button', { name: '计算', exact: true }).click();
    assert.equal(await page.locator('.calc-value strong').innerText(), '9,710');
    for (const label of ['个人社保 / 月（选填）', '个人公积金 / 月（选填）', '专项附加扣除 / 月（选填）']) {
      await page.getByLabel(label, { exact: true }).fill('1000');
    }
    await page.getByRole('button', { name: '计算', exact: true }).click();
    assert.equal(await page.locator('.calc-value strong').innerText(), '7,940');
    await page.locator('.calc-result').scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
    await page.screenshot({ path: `artifacts/calculator-salary-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: '复制结果' }).click();
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /月均到手（估算）：7940/);
    await page.getByRole('button', { name: '清空计算' }).click();
    assert.equal(await page.getByLabel('税前月薪 / 元', { exact: true }).inputValue(), '');
    assert.equal(await page.locator('.calc-result').count(), 0);
    async function openTool(name) {
      await page.getByRole('button', { name: '返回工具箱' }).click();
      await page.getByRole('button', { name, exact: true }).first().click();
    }
    const cases = [
      ['费用分摊', [['总费用 / 元', '100'], ['人数', '3']], null, null, '33.33'],
      ['借款利息', [['本金 / 元', '10000'], ['年利率 / %', '3.65'], ['计息天数', '100']], null, null, '100'],
      ['贷款月供', [['贷款本金 / 元', '120000'], ['年利率 / %', '6'], ['还款期数 / 月', '12']], null, null, '10,327.97'],
      ['课时费', [['课时数', '1'], ['每课时费用 / 元', '10.075']], null, null, '10.08'],
    ];
    for (const [name, fields, select, option, expected] of cases) {
      await openTool(name);
      await page.getByRole('button', { name: '计算', exact: true }).click();
      assert.match(await page.getByRole('alert').innerText(), /请填写/);
      for (const [label, value] of fields) await page.getByLabel(label, { exact: true }).fill(value);
      if (select) await page.getByLabel(select, { exact: true }).selectOption(option);
      await page.getByRole('button', { name: '计算', exact: true }).click();
      assert.equal(await page.locator('.calc-value strong').innerText(), expected);
      if (name === '贷款月供') {
        await page.getByLabel('还款方式', { exact: true }).selectOption('equalPrincipal');
        assert.equal(await page.locator('.calc-result').count(), 0);
        await page.getByRole('button', { name: '计算', exact: true }).click();
        assert.equal(await page.locator('.calc-value strong').innerText(), '10,600');
        const loanTabs = page.getByRole('tablist', { name: '贷款类型' });
        assert.equal(await loanTabs.getByRole('tab').count(), 3);
        await loanTabs.getByRole('tab', { name: '到期还本', exact: true }).click();
        assert.equal(await page.locator('.calc-result').count(), 0);
        await page.getByRole('button', { name: '计算', exact: true }).click();
        assert.match(await page.getByRole('alert').innerText(), /放款日期/);
        await page.getByLabel('放款日期', { exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: '确定', exact: true }).click();
        await page.getByRole('button', { name: '计算', exact: true }).click();
        assert.equal(await page.locator('.calc-value strong').innerText(), '600');
        await page.getByLabel('还息方法', { exact: true }).selectOption('maturity');
        await page.getByRole('button', { name: '计算', exact: true }).click();
        assert.equal(await page.locator('.calc-value strong').innerText(), '127,200');
        await loanTabs.getByRole('tab', { name: '固定利率', exact: true }).click();
        await page.getByLabel('首段折扣期限 / 月', { exact: true }).fill('6');
        await page.getByLabel('首段利率折扣 / %', { exact: true }).fill('50');
        await page.getByRole('button', { name: '计算', exact: true }).click();
        assert.equal(await page.locator('.calc-value strong').innerText(), '10,300');
        assert.match(await page.locator('.calc-result details').innerText(), /第 7 月恢复年利率 6%/);
        await page.getByLabel('还款方式', { exact: true }).selectOption('equalPayment');
        await page.getByRole('button', { name: '计算', exact: true }).click();
        assert.ok(Number((await page.locator('.calc-value strong').innerText()).replaceAll(',', '')) > 10000);
        await page.locator('.calc-result details p').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `artifacts/loan-fixed-${width}.png`, fullPage: true });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.getByRole('button', { name: '清空计算' }).click();
        assert.equal(await loanTabs.getByRole('tab', { name: '按揭贷款', exact: true }).getAttribute('aria-selected'), 'true');
        assert.equal(await page.getByLabel('贷款本金 / 元', { exact: true }).inputValue(), '');
      }
    }
    await openTool('单价比价');
    await page.getByRole('button', { name: '添加项目', exact: true }).click();
    assert.equal(await page.locator('.calc-item').count(), 3);
    await page.getByRole('button', { name: '删除项目3', exact: true }).click();
    assert.equal(await page.locator('.calc-item').count(), 2);
    for (const [i, price, quantity] of [[1, '10', '2'], [2, '12', '3']]) {
      await page.getByLabel(`项目${i}价格`, { exact: true }).fill(price);
      await page.getByLabel(`项目${i}数量`, { exact: true }).fill(quantity);
    }
    await page.getByRole('button', { name: '计算', exact: true }).click();
    assert.equal(await page.locator('.calc-value strong').innerText(), '4');
    await page.getByLabel('项目1价格', { exact: true }).fill('0.01');
    await page.getByLabel('项目1数量', { exact: true }).fill('100000000');
    await page.getByRole('button', { name: '计算', exact: true }).click();
    assert.equal(Number(await page.locator('.calc-value strong').innerText()), 1e-10);
    await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true, value: async () => { throw new Error('denied'); },
    }));
    await page.getByRole('button', { name: '复制结果' }).click();
    assert.match(await page.getByRole('status').innerText(), /复制失败/);
    if (width < 700) {
      await page.setViewportSize({ width, height: 560 });
      await page.locator('.calc-result details p').scrollIntoViewIfNeeded();
      const smallBox = await page.locator('.calc-result details p').boundingBox();
      assert.ok(smallBox.y >= 0 && smallBox.y + smallBox.height < 490, 'short viewport details remain accessible');
      await page.screenshot({ path: `artifacts/calculator-short-${width}.png` });
      await page.setViewportSize({ width, height: 844 });
    }
    await page.getByRole('button', { name: '返回工具箱' }).click();
    await page.getByRole('button', { name: '设为常用：课时费', exact: true }).first().click();
    await page.reload();
    await page.getByRole('tab', { name: '工具箱', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '取消常用：课时费', exact: true }).count(), 2);
    await page.getByRole('button', { name: '取消常用：课时费', exact: true }).first().click();
    assert.equal(await page.getByLabel('搜索工具').count(), 0);
    await page.getByRole('tab', { name: '明细', exact: true }).click();
    assert.equal(await page.locator('.calculator-tools').count(), 0);
    assert.deepEqual(writes, [], 'tools never write ledger or other API data');
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: Android-only calculator notice without fallback, seven tools, validation, clipboard, favorites, no API writes and responsive layouts.');
} finally { await browser.close(); }
