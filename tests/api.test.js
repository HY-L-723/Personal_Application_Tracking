import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/app.js';
let instance, server, base, time;
beforeEach(async () => {
  time = Date.parse('2026-09-10T10:00:00Z');
  instance = createApp({ databasePath: ':memory:', clock: () => time });
  server = instance.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => { await new Promise(resolve => server.close(resolve)); instance.db.close(); });
async function request(path, method = 'GET', body, { marker = true } = {}) {
  const response = await fetch(base + path, { method, headers: {
    'Content-Type': 'application/json', ...(marker ? { 'X-Tracker-Request': 'web' } : {}),
  }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json(), response };
}
const input = overrides => ({ company: '示例科技', role: '前端工程师', stage: '已投递', applied_at: '2026-09-01T09:00:00+08:00', url: 'https://example.com/jobs/1', notes: '', ...overrides });
async function add(overrides) {
  const result = await request('/api/applications', 'POST', input(overrides));
  assert.equal(result.status, 201); return result.data;
}
async function event(applicationId, overrides = {}) {
  const result = await request(`/api/applications/${applicationId}/events`, 'POST', { title: '一面', kind: '面试', due_at: '2026-09-11T15:00:00+08:00', ...overrides });
  assert.equal(result.status, 201); return result.data;
}
test('fresh browsers can open the dashboard and API without cookies or credentials', async () => {
  assert.equal((await request('/api/dashboard', 'GET', undefined, { marker: false })).status, 200);
  const page = await fetch(base + '/', { redirect: 'manual' });
  assert.equal(page.status, 200); assert.equal(page.headers.get('set-cookie'), null);
  assert.match(await page.text(), /我的秋招工作台/);
  assert.equal((await fetch(base + '/assets/index.html')).status, 404);
});
test('old login bookmarks go directly home and obsolete auth APIs are removed', async () => {
  const page = await fetch(base + '/login', { redirect: 'manual' });
  assert.equal(page.status, 302); assert.equal(page.headers.get('location'), '/');
  assert.equal((await request('/api/session')).status, 404);
  assert.equal((await request('/api/login', 'POST', {})).status, 404);
  assert.equal((await request('/api/logout', 'POST', {})).status, 404);
  assert.equal((await fetch(base + '/assets/login.js')).status, 404);
});
test('response headers remain protective without creating a login session', async () => {
  const r = await request('/api/dashboard');
  assert.equal(r.response.headers.get('set-cookie'), null);
  assert.equal(r.response.headers.get('cache-control'), 'no-store');
  assert.match(r.response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});
test('unrelated websites cannot submit browser writes; ordinary app writes need no login', async () => {
  assert.equal((await request('/api/applications', 'POST', input(), { marker: false })).status, 403);
  const r = await fetch(base + '/api/applications', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tracker-Request': 'web', 'Sec-Fetch-Site': 'cross-site' }, body: JSON.stringify(input()) });
  assert.equal(r.status, 403);
  assert.equal((await request('/api/dashboard')).data.applications.length, 0);
  assert.equal((await request('/api/applications', 'POST', input())).status, 201);
});
test('roles in the same company are independent and saved jobs do not count as submitted', async () => {
  const first = await add(); const second = await add({ role: '后端工程师', stage: '已收藏', applied_at: null });
  assert.notEqual(first.id, second.id);
  const { data } = await request('/api/dashboard');
  assert.equal(data.applications.length, 2); assert.equal(data.stats.total, 1);
  assert.equal(data.stats.counts['已收藏'], 1); assert.equal(first.history.length, 1);
});
test('editing stage records history; editing metadata does not add history', async () => {
  const first = await add(); time += 60000;
  const edited = await request(`/api/applications/${first.id}`, 'PUT', { ...first, notes: '准备项目介绍', stage: '二面' });
  assert.equal(edited.status, 200); assert.equal(edited.data.stage, '二面'); assert.equal(edited.data.history.length, 2);
  const again = await request(`/api/applications/${first.id}`, 'PUT', { ...edited.data, role: '全栈工程师' });
  assert.equal(again.data.history.length, 2); assert.equal(again.data.notes, '准备项目介绍');
  const dashboard = (await request('/api/dashboard')).data;
  assert.equal(dashboard.stats.feedback, 1); assert.equal(dashboard.stats.feedbackRate, 100);
});
test('history corrections preserve recorded time and recalculate current stage', async () => {
  const first = await add({ stage: '笔试', occurred_at: '2026-09-01T00:00:00Z' });
  const second = (await request(`/api/applications/${first.id}`, 'PUT', { ...first, stage: 'Offer' })).data;
  const offer = second.history.find(h => h.stage === 'Offer'); time += 60000;
  const corrected = await request(`/api/applications/${first.id}/history/${offer.id}`, 'PUT', { stage: '已收藏', occurred_at: '2026-08-01T00:00:00Z', note: '纠正误录', version: second.version });
  assert.equal(corrected.status, 200); assert.equal(corrected.data.stage, '笔试');
  const history = corrected.data.history.find(h => h.id === offer.id);
  assert.equal(history.recorded_at, offer.recorded_at); assert.notEqual(history.updated_at, offer.updated_at);
  assert.equal((await request('/api/dashboard')).data.stats.offers, 0);
});
test('feedback deduplicates records and uses documented history/current-stage rules', async () => {
  const first = await add({ stage: '笔试' }); time += 60000;
  const second = (await request(`/api/applications/${first.id}`, 'PUT', { ...first, stage: '一面' })).data;
  time += 60000;
  await request(`/api/applications/${first.id}`, 'PUT', { ...second, stage: '已投递' });
  await add({ role: '产品', stage: '拒绝' }); await add({ role: '设计', stage: 'Offer' });
  await add({ role: '测试', stage: 'Offer', applied_at: null }); await add({ role: '算法', stage: '已投递' });
  const stats = (await request('/api/dashboard')).data.stats;
  assert.equal(stats.total, 4); assert.equal(stats.feedback, 3); assert.equal(stats.feedbackRate, 75); assert.equal(stats.offers, 2);
});
test('independent browsers share data and stale updates/deletes return conflict', async () => {
  const first = await add();
  const other = await fetch(base + '/api/dashboard');
  assert.equal((await other.json()).applications[0].id, first.id);
  assert.equal((await request(`/api/applications/${first.id}`, 'PUT', { ...first, role: '更新岗位' })).status, 200);
  assert.equal((await request(`/api/applications/${first.id}`, 'PUT', { ...first, role: '旧页面覆盖' })).status, 409);
  assert.equal((await request(`/api/applications/${first.id}`, 'DELETE', { version: first.version })).status, 409);
});
test('events support editing, completion, cancellation, restoration and conflict detection', async () => {
  const first = await add(); let e = await event(first.id); const stale = e;
  for (const status of ['completed', 'cancelled', 'pending']) {
    const r = await request(`/api/events/${e.id}`, 'PUT', { ...e, status });
    assert.equal(r.status, 200); assert.equal(r.data.status, status); e = r.data;
  }
  assert.equal((await request(`/api/events/${e.id}`, 'PUT', { ...stale, status: 'completed' })).status, 409);
  assert.equal((await request(`/api/events/${e.id}`, 'DELETE', { version: stale.version })).status, 409);
  assert.equal((await request(`/api/events/${e.id}`, 'DELETE', { version: e.version })).status, 200);
  assert.equal((await request(`/api/applications/${first.id}`)).data.events.length, 0);
});
test('deletion cascades only to the selected application history and events', async () => {
  const first = await add(); const second = await add({ role: '后端' });
  await event(first.id); await event(second.id);
  assert.equal((await request(`/api/applications/${first.id}`, 'DELETE', { version: first.version })).status, 200);
  assert.equal((await request(`/api/applications/${first.id}`)).status, 404);
  assert.equal((await request('/api/dashboard')).data.events.length, 1);
  assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM history WHERE application_id=?').get(first.id).n, 0);
});
test('invalid fields, unsafe URLs, invalid dates and future history are rejected', async () => {
  for (const patch of [{ company: '' }, { stage: '不存在' }, { url: 'javascript:alert(1)' }, { url: 'https://user:pass@example.com' }, { applied_at: '2026-09-01T09:00' }, { applied_at: '2026-02-30T09:00:00Z' }, { occurred_at: '2027-01-01T00:00:00Z' }, { role: 'x'.repeat(161) }]) {
    assert.equal((await request('/api/applications', 'POST', input(patch))).status, 400, JSON.stringify(patch));
  }
  assert.equal((await request('/api/dashboard')).data.applications.length, 0);
});
test('oversized and malformed JSON requests do not write data', async () => {
  const invalid = await fetch(base + '/api/applications', { method: 'POST', headers: { 'X-Tracker-Request': 'web', 'Content-Type': 'application/json' }, body: '{bad-json' });
  assert.equal(invalid.status, 400);
  assert.equal((await request('/api/applications', 'POST', input({ notes: 'x'.repeat(50000) }))).status, 413);
});
test('HTML/SQL-like strings remain data, and dates normalize to UTC', async () => {
  const a = await add({ company: '<img src=x onerror=alert(1)>', role: "'; DROP TABLE applications;--" });
  assert.equal(a.company, '<img src=x onerror=alert(1)>'); assert.equal(a.applied_at, '2026-09-01T01:00:00.000Z');
  assert.equal((await request('/api/dashboard')).data.applications.length, 1);
});
test('database survives closing and reopening the connection', () => {
  const root = resolve('.local'); mkdirSync(root, { recursive: true });
  const databasePath = join(mkdtempSync(join(root, 'persistence-test-')), 'tracker.db');
  const first = createApp({ databasePath });
  first.db.prepare('INSERT INTO applications(company,role,stage,created_at,updated_at) VALUES (?,?,?,?,?)').run('持久化公司', '开发', '已收藏', '2026-09-10', '2026-09-10');
  first.db.close(); const second = createApp({ databasePath });
  assert.equal(second.db.prepare('SELECT company FROM applications').get().company, '持久化公司'); second.db.close();
});
