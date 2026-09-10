import { test, expect } from '@playwright/test';
const headers = { 'X-Tracker-Request': 'web' };
let createdIds = [];
test.beforeEach(() => { createdIds = []; });
test.afterEach(async ({ request }) => {
  // Only delete this test's fixtures from the dedicated localhost test server.
  for (const id of createdIds) {
    const record = await get(request, id);
    const response = await request.delete(`/api/applications/${id}`, { headers, data: { version: record.version } });
    expect(response.ok()).toBeTruthy();
  }
});
async function create(request, company, role = 'Java开发工程师', stage = '笔试') {
  const response = await request.post('/api/applications', { headers, data: { company, role, stage, applied_at: '2026-08-20T00:00:00+08:00', notes: '保留导入来源与原始备注 <script>bad()</script>', url: 'https://example.com/job' } });
  expect(response.ok()).toBeTruthy(); const record = await response.json(); createdIds.push(record.id); return record;
}
async function addEvent(request, id, title, due_at, kind = '测评截止', status = 'pending') {
  const response = await request.post(`/api/applications/${id}/events`, { headers, data: { title, due_at, kind, status, url: 'https://example.com/assessment', notes: '邮件导入安排；结果尚未确认。' } });
  expect(response.ok()).toBeTruthy(); return response.json();
}
async function get(request, id) { return (await request.get(`/api/applications/${id}`)).json(); }

test('inline progress works in list and board, preserving metadata and creating history', async ({ page, request }, info) => {
  const a = await create(request, `快捷进度-${info.project.name}`);
  await page.goto('/');
  await page.getByLabel('搜索公司或岗位').fill(a.company);
  const control = page.locator(`#applications [data-quick-stage="${a.id}"]`);
  await control.selectOption('一面');
  await expect(control).toBeEnabled();
  await expect(control).toHaveValue('一面');
  let changed = await get(request, a.id);
  expect(changed.notes).toBe(a.notes); expect(changed.url).toBe(a.url); expect(changed.applied_at).toBe(a.applied_at);
  expect(changed.history).toHaveLength(2); expect(changed.history[0].note).toBe('通过快捷下拉更新进度');
  await page.getByRole('button', { name: '看板', exact: true }).click();
  await control.selectOption('二面');
  await expect(control).toBeEnabled();
  await expect(control).toHaveValue('二面');
  await expect(page.locator('.board-column').filter({ has: page.locator('h3 .stage-4') }).locator('.board-card')).toHaveCount(1);
  await expect(page.locator('#detail-dialog')).not.toBeVisible();
  changed = await get(request, a.id); expect(changed.history).toHaveLength(3);
  await control.selectOption('二面');
  expect((await get(request, a.id)).history).toHaveLength(3);
  const external = await request.put(`/api/applications/${a.id}`, { headers, data: { ...changed, notes: '详情打开前另一端更新的备注' } });
  expect(external.ok()).toBeTruthy();
  await page.locator('.board-open').filter({ hasText: a.company }).click();
  await expect(page.locator('#detail-dialog .timeline li')).toHaveCount(3);
  await page.locator('#detail-dialog [data-quick-stage]').selectOption('HR面');
  await expect(page.locator('#detail-dialog [data-quick-stage]')).toHaveValue('HR面');
  await expect(page.locator('#detail-dialog [data-quick-stage]')).toBeEnabled();
  expect((await get(request, a.id)).notes).toBe('详情打开前另一端更新的备注');
  await page.getByRole('button', { name: '关闭详情' }).click();
  await page.reload();
  await page.getByLabel('搜索公司或岗位').fill(a.company);
  await expect(control).toHaveValue('HR面');
});

test('stale and failed inline changes restore server state without overwriting another edit', async ({ page, request }, info) => {
  const a = await create(request, `并发验证-${info.project.name}`);
  await page.goto('/'); await page.getByLabel('搜索公司或岗位').fill(a.company);
  const control = page.locator(`#applications [data-quick-stage="${a.id}"]`);
  await expect(control).toHaveValue('笔试');
  const update = await request.put(`/api/applications/${a.id}`, { headers, data: { ...a, stage: '二面', notes: '手机端已经修改的备注' } });
  expect(update.ok()).toBeTruthy();
  await control.selectOption('一面');
  await expect(page.locator('#toast')).toContainText('其他页面更新');
  await expect(control).toHaveValue('二面'); await expect(control).toBeEnabled();
  expect((await get(request, a.id)).notes).toBe('手机端已经修改的备注');
  await page.route(`**/api/applications/${a.id}`, async route => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 503, json: { error: '测试连接失败，请重试' } });
    else await route.continue();
  });
  await control.selectOption('Offer');
  await expect(page.locator('#toast')).toContainText('测试连接失败');
  await expect(control).toHaveValue('二面'); await expect(control).toBeEnabled();
  expect((await get(request, a.id)).history).toHaveLength(2);
  await page.unroute(`**/api/applications/${a.id}`);
  await control.selectOption('Offer');
  await expect(control).toHaveValue('Offer'); await expect(control).toBeEnabled();
  expect((await get(request, a.id)).history).toHaveLength(3);
});

test('todos group imported dates, filter independently, show live role stage, complete and restore', async ({ page, request }, info) => {
  const company = `待办筛选-${info.project.name}`;
  const a = await create(request, company, '后端工程师');
  const b = await create(request, company, '前端工程师', '一面');
  const overdue = await addEvent(request, a.id, '昨日测评', '2026-09-09T18:00:00+08:00');
  await addEvent(request, a.id, '今天笔试', '2026-09-10T18:00:00+08:00', '笔试');
  await addEvent(request, b.id, '明天面试', '2026-09-11T10:00:00+08:00', '面试');
  await addEvent(request, b.id, '已完成材料', '2026-09-08T10:00:00+08:00', '其他', 'completed');
  await page.route('**/api/dashboard', async route => {
    const response = await route.fetch(); const data = await response.json();
    await route.fulfill({ json: { ...data, serverNow: '2026-09-10T08:00:00Z' } });
  });
  await page.goto('/#todos');
  await page.getByLabel('搜索待办').fill(company);
  const cards = page.locator('#todo-list [data-todo-event]');
  await expect(cards).toHaveCount(3);
  await expect(cards.first()).toContainText('昨日测评');
  await expect(cards.first()).toContainText('已逾期');
  await page.getByLabel('待办范围', { exact: true }).selectOption('today');
  await expect(cards).toHaveCount(1); await expect(cards).toContainText('今天笔试');
  await page.getByLabel('待办范围', { exact: true }).selectOption('upcoming');
  await expect(cards).toHaveCount(2);
  await page.getByLabel('待办类型', { exact: true }).selectOption('面试');
  await expect(cards).toHaveCount(1); await expect(cards).toContainText('前端工程师');
  await cards.locator('[data-quick-stage]').selectOption('二面');
  await expect(cards.locator('[data-quick-stage]')).toHaveValue('二面');
  await expect(cards.locator('[data-quick-stage]')).toBeEnabled();
  expect((await get(request, a.id)).stage).toBe('笔试');
  expect((await get(request, b.id)).stage).toBe('二面');
  await page.getByLabel('待办类型', { exact: true }).selectOption('');
  await page.getByLabel('待办范围', { exact: true }).selectOption('overdue');
  const card = page.locator(`[data-todo-event="${overdue.id}"]`);
  await card.getByRole('button', { name: '完成', exact: true }).click();
  await expect(card).toHaveCount(0);
  expect((await get(request, a.id)).stage).toBe('笔试');
  await page.getByLabel('待办范围', { exact: true }).selectOption('completed');
  await expect(card).toContainText('已完成');
  await card.getByRole('button', { name: '恢复待办' }).click();
  await expect(card).toHaveCount(0);
  await page.getByLabel('待办范围', { exact: true }).selectOption('pending');
  await expect(cards).toHaveCount(3);
  await expect(cards.first().getByRole('link', { name: '打开日程链接' })).toHaveAttribute('href', 'https://example.com/assessment');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: `test-results/${info.project.name}-todos.jpg`, fullPage: true, type: 'jpeg', quality: 70, scale: 'css' });
  await page.reload(); await expect(page.locator('#todos-page')).toBeVisible();
});

test('unscheduled roles can add and edit linked tasks without opening the detail drawer', async ({ page, request }, info) => {
  const a = await create(request, `补充时间-${info.project.name}`);
  await page.goto('/#todos');
  await page.getByLabel('搜索待办').fill(a.company);
  await page.getByLabel('待办范围', { exact: true }).selectOption('unscheduled');
  await expect(page.locator('#todo-list .todo-card')).toHaveCount(1);
  await expect(page.getByLabel('待办类型', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '补充时间', exact: true }).click();
  const editor = page.locator('#editor-dialog');
  await expect(editor.getByLabel('关联投递')).toHaveValue(String(a.id));
  await editor.getByLabel('日程名称').fill('补录测评截止');
  await editor.getByLabel('日程类型').selectOption('测评截止');
  await editor.getByLabel('安排时间 / 截止时间（北京时间）').fill('2026-09-24T18:00');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.locator('#todo-list .todo-card')).toHaveCount(0);
  await page.getByLabel('待办范围', { exact: true }).selectOption('pending');
  const card = page.locator('#todo-list .todo-card');
  await expect(card).toContainText('2026/09/24 18:00');
  await card.getByRole('button', { name: '编辑时间 / 备注' }).click();
  await editor.getByLabel('安排时间 / 截止时间（北京时间）').fill('2026-09-24T20:00');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(card).toContainText('2026/09/24 20:00');
  page.once('dialog', dialog => dialog.accept());
  await card.getByRole('button', { name: '取消待办' }).click();
  await expect(card).toHaveCount(0);
  await page.getByLabel('待办范围', { exact: true }).selectOption('cancelled');
  await expect(card).toContainText('已取消');
  const result = await get(request, a.id);
  expect(result.stage).toBe('笔试'); expect(result.events).toHaveLength(1); expect(result.events[0].status).toBe('cancelled');
});
