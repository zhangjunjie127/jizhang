import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkKeySounds } from './key-sound-checks.mjs';

export async function checkSettings(page, api, userId) {
  const nav = page.locator('.mobile-nav');
  async function openSettings() {
    await nav.getByRole('button', { name: '我的', exact: true }).click();
    await page.locator('.mine-menu').getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('heading', { name: '设置', exact: true }).waitFor();
  }
  await nav.getByRole('button', { name: '我的', exact: true }).click();
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.locator('.mine-home .mine-heading, .mine-home .assistant-entry, .mine-shortcuts').count(), 0);
    assert.equal(await page.locator('.mine-home').evaluate(node => node.scrollWidth > node.clientWidth), false);
    await page.screenshot({ path: `artifacts/mine-home-${width}.png` });
  }
  await page.getByRole('button', { name: '我的助手', exact: true }).click();
  await page.getByRole('heading', { name: '我的助手', exact: true }).waitFor();
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    const assistant = page.locator('.assistant-settings-page');
    assert.equal(await assistant.evaluate(node => node.scrollWidth > node.clientWidth), false);
    const avatar = await assistant.locator('.avatar').boundingBox();
    assert.equal(avatar.width, avatar.height, 'Assistant avatar stays circular instead of stretching across the row');
    await page.screenshot({ path: `artifacts/my-assistant-${width}.png` });
    await page.setViewportSize({ width, height: 360 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const headerTop = (await assistant.locator('.preferences-heading').boundingBox()).y;
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    assert.ok(Math.abs((await assistant.locator('.preferences-heading').boundingBox()).y - headerTop) < 1, 'Assistant back header stays pinned');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.setViewportSize({ width, height: 844 });
  }
  const before = await api('/state');
  const proactive = page.getByRole('checkbox', { name: '主动关心', exact: true });
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/api/profile') && response.request().method() === 'PATCH' && response.status() === 200),
    proactive.click(),
  ]);
  await page.waitForFunction(expected => document.querySelector('.assistant-settings-page input.switch')?.checked === expected, !Boolean(before.user.proactive));
  assert.equal(Boolean((await api('/state')).user.proactive), !Boolean(before.user.proactive));
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/api/profile') && response.request().method() === 'PATCH'),
    proactive.click(),
  ]);
  const pause = page.waitForResponse(response => response.url().endsWith('/api/profile') && response.request().method() === 'PATCH');
  await page.getByRole('button', { name: /^今天想安静一点/ }).click();
  await pause;
  assert.ok(Date.parse((await api('/state')).user.quiet_until) > Date.now());
  const resume = page.waitForResponse(response => response.url().endsWith('/api/profile') && response.request().method() === 'PATCH');
  await page.getByRole('button', { name: /^今天想安静一点/ }).click();
  await resume;
  await page.getByRole('button', { name: /^我们记得的事/ }).click();
  await page.getByRole('dialog', { name: '我们记得的事', exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '切换助手性格', exact: true }).click();
  await page.getByRole('dialog', { name: '今天，谁来陪你？', exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  assert.equal(await page.getByRole('combobox', { name: '关系模式', exact: true }).inputValue(), before.user.relationship);
  await page.getByRole('button', { name: '返回我的', exact: true }).click();
  await openSettings();
  for (const label of ['账户与服务', '算力用量', '隐私与内测说明']) {
    assert.equal(await page.locator('.preferences-page').getByText(label, { exact: true }).count(), 0);
  }
  assert.equal(await page.getByRole('checkbox', { name: '主动关心', exact: true }).count(), 0);
  assert.equal(await page.getByRole('combobox', { name: '关系模式', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: /^我们记得的事/ }).count(), 0);
  await checkKeySounds(page);
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.getByRole('button', { name: '账户安全中心', exact: true }).count(), 0);
    for (const label of ['类别设置', '标签设置', '图表页设置', '去除广告', 'Siri快捷指令']) assert.equal(await page.getByText(label, { exact: true }).count(), 0);
    assert.equal(await page.locator('.preferences-page').evaluate(node => node.scrollWidth > node.clientWidth), false);
    assert.equal(await page.locator('label.preferences-row').evaluateAll(rows => rows.every(row => {
      const parts = [...row.children].map(child => child.getBoundingClientRect());
      return parts.every(box => Math.abs(box.y + box.height / 2 - parts[0].y - parts[0].height / 2) < 1);
    })), true, 'Settings toggles, labels and icons are vertically centered on one row');
    await page.getByRole('heading', { name: '设置', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/settings-top-${width}.png` });
    const headerTop = (await page.locator('.preferences-heading').boundingBox()).y;
    await page.getByRole('button', { name: '退出登录', exact: true }).scrollIntoViewIfNeeded();
    assert.ok(Math.abs((await page.locator('.preferences-heading').boundingBox()).y - headerTop) < 1, 'Settings back header stays pinned at the bottom of the page');
    await page.screenshot({ path: `artifacts/settings-bottom-${width}.png` });
  }
  await page.getByRole('button', { name: /^默认记账类型/ }).click();
  await page.getByRole('dialog', { name: '默认记账类型' }).getByRole('button', { name: '收入', exact: true }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('checkbox', { name: '隐藏总金额', exact: true }).check();
  await page.getByRole('checkbox', { name: '快捷编辑', exact: true }).uncheck();
  await page.getByRole('button', { name: /^日历设置/ }).click();
  await page.getByRole('button', { name: '今天', exact: true }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '个性装扮', exact: true }).click();
  await page.getByRole('button', { name: '绿色', exact: true }).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'green');
  await page.getByRole('button', { name: '蓝色', exact: true }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  await api('/records', { kind: 'expense', confirmed: true, payload: { title: '设置测试账目', amount: '12.34', direction: 'expense', category: '早餐', date: today } }, undefined, 201);
  await page.reload();
  await page.getByTestId('ledger-expense').waitFor();
  assert.equal(await page.getByTestId('ledger-expense').textContent(), '****');
  assert.equal(await page.getByTestId('ledger-expense').getAttribute('title'), '金额已隐藏');
  assert.equal(await page.locator('.ledger-query-period').textContent(), today);
  for (const view of ['月账单', '年账单']) {
    await page.getByRole('tab', { name: view, exact: true }).click();
    assert.equal(await page.locator('.bill-summary .bill-money').first().textContent(), '****');
  }
  await page.getByRole('tab', { name: '明细', exact: true }).click();
  await page.getByRole('button', { name: '查看设置测试账目', exact: true }).click();
  const detail = page.getByRole('dialog', { name: '账目详情', exact: true });
  await detail.waitFor();
  await detail.getByText('-12.34 元', { exact: true }).waitFor();
  await detail.getByRole('button', { name: '编辑账目', exact: true }).click();
  await page.getByRole('dialog', { name: '修改记录' }).waitFor();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await nav.getByRole('button', { name: '记一笔', exact: true }).click();
  await page.getByRole('region', { name: '收入类别', exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await openSettings();
  await page.getByRole('button', { name: /^导出数据/ }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 CSV', exact: true }).click();
  const download = await downloadEvent;
  assert.match(await readFile(await download.path(), 'utf8'), /设置测试账目/);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: /^数据恢复/ }).click();
  await page.getByRole('dialog', { name: '记录回收站', exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: /^收支账户/ }).click();
  await page.getByRole('heading', { name: '暂未开放', exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '清除缓存', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('dialog', { name: '清除缓存', exact: true }).getByRole('button', { name: '清除缓存', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /缓存/ }).waitFor();
  assert.ok((await api('/state')).records.some(record => record.payload.title === '设置测试账目'));
  assert.equal(await page.evaluate(id => JSON.parse(localStorage.getItem(`zaizai-preferences-${id}`)).hideTotals, userId), true);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '返回我的', exact: true }).click();
}
