const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const STAGES = ['已收藏', '已投递', '笔试', '一面', '二面', 'HR面', 'Offer', '拒绝'];
const EVENT_STATUS = { pending: '待完成', completed: '已完成', cancelled: '已取消' };
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2M8 18h2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.1M3 12h.1M3 18h.1"/>',
  board: '<rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="14" y="4" width="7" height="10" rx="1.5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  arrow: '<path d="M6 18 18 6M6 6h12v12"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4M12 17h.01"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  briefcase: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12a20 20 0 0 0 18 0M12 11v4"/>',
  chart: '<path d="M4 4v16h17M8 15v-4M13 15V7M18 15V5"/>',
  award: '<path d="M8 3h8v7a4 4 0 0 1-8 0ZM8 6H4v3a4 4 0 0 0 4 4M16 6h4v3a4 4 0 0 1-4 4M12 14v6M8 21h8"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  edit: '<path d="m14 5 5 5M4 20l5-1L21 7l-5-5L4 14Z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.grid}</svg>`;
function icons(root = document) { $$('[data-icon]', root).forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const format = (value, options = {}) => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', ...options }).format(new Date(value)) : '未填写';
const fullTime = value => format(value, { year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const localInput = value => value ? new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 16) : '';
const beijingDate = value => localInput(value).slice(0, 10);
const toISO = value => value ? new Date(`${value}+08:00`).toISOString() : null;
const badge = stage => `<span class="stage-badge stage-${STAGES.indexOf(stage)}">${escape(stage)}</span>`;
const avatar = company => `<span class="company-avatar tone-${[...company].reduce((n, c) => n + c.codePointAt(0), 0) % 5}">${escape([...company][0] || '企')}</span>`;
const safeLink = (url, label = '打开链接') => url ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(label)} ↗</a>` : '<span class="muted">未填写</span>';
const state = { applications: [], events: [], stats: null, page: 'overview', stage: '', view: 'list', detail: null, timeOffset: 0, ready: false };
let toastTimer;
let loadSequence = 0;
let detailSequence = 0;
const currentTime = () => Date.now() + state.timeOffset;
const isOverdue = e => e.status === 'pending' && Date.parse(e.due_at) < currentTime();
const isUpcoming = e => e.status === 'pending' && Date.parse(e.due_at) >= currentTime() && Date.parse(e.due_at) <= currentTime() + 7 * 86400000;
function notify(message, error = false) {
  const el = $('#toast');
  el.textContent = message; el.classList.toggle('error', error); el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
}
async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method || 'GET', headers: { 'Content-Type': 'application/json', 'X-Tracker-Request': 'web' },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch { throw new Error('暂时无法连接服务器，请检查网络后重试。'); }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '操作失败，请重试');
  return result;
}
async function loadData() {
  const sequence = ++loadSequence;
  $('#refresh-button').disabled = true;
  try {
    const data = await api('/dashboard');
    if (sequence !== loadSequence) return;
    Object.assign(state, data, { timeOffset: Date.parse(data.serverNow) - Date.now(), ready: true });
    $('#loading').hidden = true; $('#dashboard').hidden = false; $('#page-error').hidden = true;
    renderAll();
    $('#last-refreshed').textContent = `更新于 ${format(data.serverNow, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`;
  } catch (error) {
    $('#loading').hidden = true;
    $('#page-error').textContent = `${error.message} 点击右上角刷新按钮重试。`;
    $('#page-error').hidden = false;
  } finally { if (sequence === loadSequence) $('#refresh-button').disabled = false; }
}
function renderAll() {
  renderStats(); renderReminders(); renderStages(); renderApplications(); renderSchedule();
  $('#nav-event-count').textContent = state.events.filter(e => e.status === 'pending').length;
}
function renderStats() {
  const { stats } = state;
  const overdue = state.events.filter(isOverdue).length;
  const active = state.applications.filter(a => ['笔试', '一面', '二面', 'HR面'].includes(a.stage)).length;
  const cards = [
    ['已投递', stats.total, '份', `${state.applications.length} 条记录，包含已收藏的机会`, 'briefcase'],
    ['流程反馈率', stats.feedbackRate, '%', `${stats.feedback} 份投递已有流程反馈`, 'chart'],
    ['收获 Offer', stats.offers, '份', `${active} 份投递正在笔试或面试中`, 'award'],
    ['未来 7 天日程', state.events.filter(isUpcoming).length, '项', overdue ? `另有 ${overdue} 项已逾期，记得处理` : '按自己的节奏，准备下一步', 'calendar'],
  ];
  $('#stats').innerHTML = cards.map(([label, value, unit, caption, symbol], i) => `<article class="stat-card ${i === 2 ? 'featured' : ''}"><span class="stat-symbol">${icon(symbol)}</span><div class="stat-label">${label}${i === 1 ? '<button class="icon-button" data-help aria-label="查看流程反馈率统计口径" title="查看统计口径">' + icon('help') + '</button>' : ''}</div><div class="stat-value">${value}<small>${unit}</small></div><p class="stat-caption">${caption}</p></article>`).join('');
}
function eventTag(event) {
  if (event.status !== 'pending') return `<span class="event-tag">${EVENT_STATUS[event.status]}</span>`;
  if (isOverdue(event)) return '<span class="event-tag overdue">已逾期</span>';
  if (Date.parse(event.due_at) <= currentTime() + 86400000) return '<span class="event-tag soon">24 小时内</span>';
  return `<span class="event-tag">${escape(event.kind)}</span>`;
}
function renderReminders() {
  const reminders = state.events.filter(e => isOverdue(e) || isUpcoming(e));
  $('#reminder-count').textContent = reminders.length ? `${reminders.length} 项待办` : '';
  $('#reminders').innerHTML = reminders.length ? reminders.slice(0, 3).map(e => `<button class="reminder-card" data-detail="${e.application_id}"><div class="reminder-card-top">${eventTag(e)}<span class="reminder-time">${format(e.due_at, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}</span></div><div class="reminder-title">${escape(e.company)} · ${escape(e.title)}</div><div class="reminder-meta">${escape(e.role)} <span aria-hidden="true">↗</span></div></button>`).join('') : `<div class="reminder-empty">${icon('check')}<span>近期暂无待办，安心准备下一次机会。<br>可以在投递详情中添加日程。</span></div>`;
}
function renderStages() {
  $('#stage-filters').innerHTML = ['', ...STAGES].map(stage => `<button class="stage-filter ${state.stage === stage ? 'active' : ''}" data-stage="${escape(stage)}" aria-pressed="${state.stage === stage}">${stage || '全部'}<small>${stage ? state.stats.counts[stage] : state.applications.length}</small></button>`).join('');
}
function filteredApplications() {
  const query = $('#search').value.trim().toLocaleLowerCase();
  const from = $('#date-from').value; const to = $('#date-to').value;
  const invalid = from && to && from > to;
  $('#filter-error').textContent = invalid ? '起始日期不能晚于结束日期。' : '';
  if (invalid) return [];
  return state.applications.filter(a => {
    const date = beijingDate(a.applied_at);
    return (!query || `${a.company} ${a.role}`.toLocaleLowerCase().includes(query)) && (!state.stage || a.stage === state.stage) && (!from || date && date >= from) && (!to || date && date <= to);
  });
}
function empty(iconName, title, description, action = '') {
  return `<div class="empty"><div class="empty-icon">${icon(iconName)}</div><h3>${title}</h3><p>${description}</p>${action}</div>`;
}
function renderApplications() {
  const records = filteredApplications();
  $('#record-count').textContent = state.applications.length;
  $('#results-summary').textContent = `显示 ${records.length} 条 · 共 ${state.applications.length} 条记录`;
  if (!records.length) {
    $('#applications').innerHTML = state.applications.length ? empty('search', '没有找到匹配的投递', '试试其他关键词，或重置筛选条件。', '<button class="button" data-reset>重置筛选</button>') : empty('briefcase', '从第一份投递开始', '收藏一个心仪岗位，或记下已经投递的机会。<br>你的秋招进展，会在这里慢慢清晰起来。', '<button class="button primary" data-new>新增第一条投递</button>');
    return;
  }
  if (state.view === 'board') {
    $('#applications').innerHTML = `<div class="board" aria-label="流程看板">${(state.stage ? [state.stage] : STAGES).map(stage => {
      const matches = records.filter(a => a.stage === stage);
      return `<section class="board-column"><h3>${badge(stage)}<small>${matches.length}</small></h3>${matches.length ? matches.map(a => `<button class="board-card" data-detail="${a.id}"><strong>${escape(a.company)}</strong><p>${escape(a.role)}</p><small>${a.applied_at ? format(a.applied_at) + ' 投递' : '尚未填写投递时间'}</small></button>`).join('') : '<div class="board-empty">暂无记录</div>'}</section>`;
    }).join('')}</div>`;
    return;
  }
  $('#applications').innerHTML = `<div class="table-wrap"><table class="application-table"><thead><tr><th>公司</th><th>投递岗位</th><th>当前进度</th><th>投递时间</th><th class="next-col">下一项安排</th><th>操作</th></tr></thead><tbody>${records.map(a => {
    const next = state.events.find(e => e.application_id === a.id && e.status === 'pending');
    return `<tr><td><div class="company-cell">${avatar(a.company)}<div><button class="company-name" data-detail="${a.id}">${escape(a.company)}</button><div class="company-sub">APPLICATION · ${String(a.id).padStart(3, '0')}</div></div></div></td><td class="role-text">${escape(a.role)}</td><td>${badge(a.stage)}</td><td class="date-cell">${a.applied_at ? format(a.applied_at, { year: 'numeric' }) : '尚未投递'}</td><td class="next-col"><div class="next-event ${next && isOverdue(next) ? 'is-overdue' : ''}">${next ? `${escape(next.title)}<br>${format(next.due_at, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}${isOverdue(next) ? ' · 逾期' : ''}` : '—'}</div></td><td><button class="row-action" data-detail="${a.id}" aria-label="查看 ${escape(a.company)} ${escape(a.role)}">详情 ↗</button></td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function renderSchedule() {
  const filter = $('#event-filter').value;
  const events = state.events.filter(e => filter === 'all' || (filter === 'overdue' ? isOverdue(e) : filter === 'upcoming' ? isUpcoming(e) : e.status === filter));
  $('#schedule-list').innerHTML = events.length ? events.map(e => `<article class="event-row"><div class="event-date"><small>${format(e.due_at, { month: 'short', day: undefined })}</small><strong>${format(e.due_at, { month: undefined, day: '2-digit' })}</strong></div><div class="event-description"><h3>${escape(e.title)}</h3><p>${escape(e.company)} · ${escape(e.role)}</p><p>${fullTime(e.due_at)} · ${escape(e.kind)}</p></div>${eventTag(e)}<div class="event-actions">${e.status === 'pending' ? `<button class="button small-button" data-complete-event="${e.id}">${icon('check')}完成</button>` : ''}<button class="button small-button" data-detail="${e.application_id}">查看投递 ↗</button></div></article>`).join('') : empty('calendar', '这里暂时没有日程', '在投递详情中添加安排，或切换查看范围。');
}
function setPage(page) {
  state.page = page;
  $('#overview-page').hidden = page !== 'overview'; $('#schedule-page').hidden = page !== 'schedule';
  $$('.sidebar [data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  $('#breadcrumb-current').textContent = page === 'overview' ? '投递总览' : '日程安排';
  $('#page-title').innerHTML = page === 'overview' ? '每一步，都有迹可循<span>。</span>' : '为下一次机会，留好时间<span>。</span>';
  $('#page-subtitle').textContent = page === 'overview' ? '把机会记下来，把进展握在手里。' : '测评、笔试、面试，把重要的安排放在眼前。';
}
function resetFilters() {
  state.stage = ''; $('#search').value = ''; $('#date-from').value = ''; $('#date-to').value = '';
  renderStages(); renderApplications();
}
async function showDetail(id) {
  const sequence = ++detailSequence;
  const dialog = $('#detail-dialog');
  dialog.innerHTML = `<div class="dialog-header"><h2 id="detail-title">投递详情</h2><button class="icon-button" data-close="detail-dialog" aria-label="关闭详情">${icon('close')}</button></div><div class="empty">正在读取记录…</div>`;
  if (!dialog.open) dialog.showModal();
  try {
    const record = await api(`/applications/${id}`);
    if (sequence !== detailSequence || !dialog.open) return;
    state.detail = record;
    renderDetail();
  } catch (error) {
    if (sequence !== detailSequence) return;
    dialog.innerHTML = `<div class="dialog-header"><h2 id="detail-title">投递详情</h2><button class="icon-button" data-close="detail-dialog" aria-label="关闭详情">${icon('close')}</button></div><div class="empty">${escape(error.message)}<br><button class="button" data-detail="${Number(id)}">重试</button></div>`;
  }
}
function renderDetail() {
  const a = state.detail;
  $('#detail-dialog').innerHTML = `<div class="dialog-header"><div><div class="eyebrow">APPLICATION ${String(a.id).padStart(3, '0')}</div><h2 id="detail-title">投递详情</h2></div><button class="icon-button" data-close="detail-dialog" aria-label="关闭详情">${icon('close')}</button></div><div class="drawer-content"><div class="detail-company">${avatar(a.company)}<div><h2>${escape(a.company)}</h2><p>${escape(a.role)}</p></div></div><div class="detail-actions"><button class="button primary" data-edit-application>${icon('edit')}编辑投递 / 更新进度</button><button class="button danger" data-delete-application>${icon('trash')}删除</button></div><dl class="detail-info"><dt>当前进度</dt><dd>${badge(a.stage)}</dd><dt>投递时间</dt><dd>${fullTime(a.applied_at)}</dd><dt>岗位链接</dt><dd>${safeLink(a.url, '查看岗位')}</dd><dt>最近更新</dt><dd>${fullTime(a.updated_at)}</dd></dl>${a.notes ? `<div class="detail-notes">${escape(a.notes)}</div>` : ''}<section class="detail-section"><div class="section-caption"><h3>日程安排 <span class="subtle-count">${a.events.length}</span></h3><button class="text-button" data-new-event>＋ 添加日程</button></div>${a.events.length ? a.events.map(e => `<article class="detail-event"><div class="detail-event-top"><div><h4>${escape(e.title)}</h4><p>${escape(e.kind)} · ${fullTime(e.due_at)}</p></div>${eventTag(e)}</div>${e.url ? `<p>${safeLink(e.url, '打开日程链接')}</p>` : ''}${e.notes ? `<p>${escape(e.notes)}</p>` : ''}<div class="event-actions">${e.status === 'pending' ? `<button class="button small-button" data-complete-event="${e.id}">${icon('check')}完成</button><button class="text-button" data-cancel-event="${e.id}">取消日程</button>` : `<button class="button small-button" data-reopen-event="${e.id}">恢复待办</button>`}<button class="text-button" data-edit-event="${e.id}">编辑</button><button class="icon-button" data-delete-event="${e.id}" aria-label="删除日程 ${escape(e.title)}">${icon('trash')}</button></div></article>`).join('') : '<p class="muted small">还没有日程。记下测评截止时间或下一场面试吧。</p>'}</section><section class="detail-section"><div class="section-caption"><h3>流程足迹</h3><span class="muted small">按发生时间排序 · 北京时间</span></div><ol class="timeline">${a.history.map(h => `<li><div class="timeline-top">${badge(h.stage)}<button class="text-button" data-edit-history="${h.id}">纠正</button></div><p>发生于 ${fullTime(h.occurred_at)}<br>记录于 ${fullTime(h.recorded_at)}${h.updated_at !== h.recorded_at ? `<br>修订于 ${fullTime(h.updated_at)}` : ''}</p>${h.note ? `<p class="timeline-note">${escape(h.note)}</p>` : ''}</li>`).join('')}</ol></section></div>`;
}
function field(name, label, value = '', { type = 'text', required = false, wide = false, max = '', hint = '', options = null, placeholder = '' } = {}) {
  const input = options ? `<select id="field-${name}" name="${name}">${options.map(option => { const [v, l] = Array.isArray(option) ? option : [option, option]; return `<option value="${escape(v)}" ${value === v ? 'selected' : ''}>${escape(l)}</option>`; }).join('')}</select>` : type === 'textarea' ? `<textarea id="field-${name}" name="${name}" ${max ? `maxlength="${max}"` : ''} placeholder="${escape(placeholder)}">${escape(value)}</textarea>` : `<input id="field-${name}" name="${name}" type="${type}" value="${escape(value)}" ${required ? 'required' : ''} ${max ? `maxlength="${max}"` : ''} placeholder="${escape(placeholder)}">`;
  return `<div class="form-field ${wide ? 'wide' : ''}"><label for="field-${name}">${label}${required ? ' <span class="required">*</span>' : ''}</label>${input}${hint ? `<small>${hint}</small>` : ''}</div>`;
}
function openEditor(title, fields, onSubmit) {
  const dialog = $('#editor-dialog');
  dialog.innerHTML = `<div class="dialog-header"><h2 id="editor-title">${title}</h2><button class="icon-button" data-close="editor-dialog" aria-label="关闭编辑">${icon('close')}</button></div><form class="editor-form"><div class="form-grid">${fields}</div><p class="form-error" role="alert"></p><div class="form-footer"><button type="button" class="button" data-close="editor-dialog">取消</button><button type="submit" class="button primary">保存</button></div></form>`;
  dialog.showModal();
  let saving = false;
  const onCancel = event => { if (saving) event.preventDefault(); };
  dialog.addEventListener('cancel', onCancel);
  dialog.addEventListener('close', () => dialog.removeEventListener('cancel', onCancel), { once: true });
  $('form', dialog).addEventListener('submit', async event => {
    event.preventDefault();
    if (saving) return;
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form));
    saving = true;
    $$('button', dialog).forEach(b => { b.disabled = true; });
    const button = $('button[type=submit]', form); button.textContent = '保存中…';
    $('.form-error', form).textContent = '';
    try {
      await onSubmit(payload);
      dialog.close();
      notify('已保存');
      await loadData();
      if ($('#detail-dialog').open && state.detail) await showDetail(state.detail.id);
    } catch (error) { $('.form-error', form).textContent = error.message; }
    finally { saving = false; $$('button', dialog).forEach(b => { b.disabled = false; }); button.textContent = '保存'; }
  });
}
function editApplication(existing = null) {
  const a = existing || { company: '', role: '', stage: '已收藏', url: '', applied_at: null, notes: '' };
  openEditor(existing ? '编辑投递' : '新增投递',
    field('company', '公司名称', a.company, { required: true, max: 120, placeholder: '例如：心仪的公司' }) +
    field('role', '岗位名称', a.role, { required: true, max: 160, placeholder: '例如：前端开发工程师' }) +
    field('stage', '当前进度', a.stage, { options: STAGES, required: true }) +
    field('applied_at', '投递时间（北京时间）', localInput(a.applied_at), { type: 'datetime-local', hint: '已收藏可留空；统计按此时间计算。' }) +
    field('url', '岗位链接', a.url, { type: 'url', wide: true, max: 2000, placeholder: 'https://' }) +
    field('occurred_at', existing ? '本次进度发生时间（北京时间）' : '初始进度发生时间（北京时间）', localInput(new Date(currentTime()).toISOString()), { type: 'datetime-local', wide: true, required: true, hint: existing ? '仅修改进度时生效；历史按发生时间排序，最近一次决定当前进度。' : '记录该阶段实际发生的时间，之后也可纠正。' }) +
    field('notes', '备注', a.notes, { type: 'textarea', wide: true, max: 10000, placeholder: '记下岗位要求、准备事项或面试感受…' }),
    async data => {
      const result = await api(existing ? `/applications/${a.id}` : '/applications', { method: existing ? 'PUT' : 'POST', body: { ...data, applied_at: toISO(data.applied_at), occurred_at: toISO(data.occurred_at), ...(existing ? { version: a.version } : {}) } });
      if ($('#detail-dialog').open) state.detail = result;
    });
}
function findEvent(id) { return state.detail?.events.find(e => e.id === Number(id)) || state.events.find(e => e.id === Number(id)); }
function editEvent(existing = null) {
  const e = existing || { title: '', kind: '面试', due_at: '', url: '', notes: '', status: 'pending' };
  const applicationId = state.detail.id;
  openEditor(existing ? '编辑日程' : '添加日程',
    field('title', '日程名称', e.title, { required: true, wide: true, max: 160, placeholder: '例如：一面 / 在线测评截止' }) +
    field('kind', '日程类型', e.kind, { options: ['测评截止', '笔试', '面试', '其他'] }) +
    field('status', '日程状态', e.status, { options: Object.entries(EVENT_STATUS) }) +
    field('due_at', '安排时间 / 截止时间（北京时间）', localInput(e.due_at), { required: true, wide: true, type: 'datetime-local', hint: '未来 7 天内出现在近期安排；超过时间显示为逾期。' }) +
    field('url', '日程链接', e.url, { type: 'url', wide: true, max: 2000, placeholder: '测评、会议或面试链接 https://' }) +
    field('notes', '备注', e.notes, { type: 'textarea', wide: true, max: 10000, placeholder: '会议号、面试地点、需要准备的材料…' }),
    data => api(existing ? `/events/${e.id}` : `/applications/${applicationId}/events`, { method: existing ? 'PUT' : 'POST', body: { ...data, due_at: toISO(data.due_at), ...(existing ? { version: e.version } : {}) } }));
}
function editHistory(id) {
  const a = state.detail;
  const h = a.history.find(h => h.id === Number(id));
  openEditor('纠正流程记录', field('stage', '进度', h.stage, { options: STAGES, wide: true }) +
    field('occurred_at', '实际发生时间（北京时间）', localInput(h.occurred_at), { type: 'datetime-local', wide: true, required: true, hint: `原始记录时间：${fullTime(h.recorded_at)}。纠正后保留该记录时间，按发生时间重新计算当前阶段。` }) +
    field('note', '流程备注', h.note, { type: 'textarea', wide: true, max: 2000 }),
    data => api(`/applications/${a.id}/history/${h.id}`, { method: 'PUT', body: { ...data, occurred_at: toISO(data.occurred_at), version: a.version } }));
}
async function changeEvent(id, status) {
  const e = findEvent(id);
  if (!e) return;
  if (status === 'cancelled' && !confirm(`确定取消“${e.title}”吗？之后可以恢复为待办。`)) return;
  await api(`/events/${e.id}`, { method: 'PUT', body: { ...e, status } });
  notify(status === 'completed' ? '日程已完成' : status === 'cancelled' ? '日程已取消' : '已恢复为待办');
  await loadData();
  if ($('#detail-dialog').open) await showDetail(e.application_id);
}
async function deleteApplication() {
  const a = state.detail;
  if (!confirm(`确定删除“${a.company} · ${a.role}”吗？关联的流程历史和日程也会被删除，此操作无法撤销。`)) return;
  await api(`/applications/${a.id}`, { method: 'DELETE', body: { version: a.version } });
  $('#detail-dialog').close(); state.detail = null;
  notify('投递记录及关联日程、历史已删除'); await loadData();
}
async function deleteEvent(id) {
  const e = findEvent(id);
  if (!confirm(`确定删除日程“${e.title}”吗？此操作无法撤销。`)) return;
  await api(`/events/${e.id}`, { method: 'DELETE', body: { version: e.version } });
  notify('日程已删除'); await loadData(); await showDetail(e.application_id);
}
document.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  const d = button.dataset;
  try {
    if (d.close) { $(`#${d.close}`).close(); return; }
    if (d.page) { setPage(d.page); return; }
    if ('detail' in d) { await showDetail(d.detail); return; }
    if ('stage' in d) { state.stage = d.stage; renderStages(); renderApplications(); return; }
    if (d.view) {
      state.view = d.view;
      $$('[data-view]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', b === button); });
      renderApplications(); return;
    }
    if ('new' in d || button.id === 'new-application') editApplication();
    else if ('reset' in d || button.id === 'clear-filters') resetFilters();
    else if ('help' in d || button.id === 'help-button') $('#help-dialog').showModal();
    else if (button.id === 'refresh-button') { await loadData(); }
    else if ('editApplication' in d) editApplication(state.detail);
    else if ('deleteApplication' in d) await deleteApplication();
    else if ('newEvent' in d) editEvent();
    else if ('editEvent' in d) editEvent(findEvent(d.editEvent));
    else if ('editHistory' in d) editHistory(d.editHistory);
    else if ('completeEvent' in d || 'cancelEvent' in d || 'reopenEvent' in d) {
      button.disabled = true;
      await changeEvent(d.completeEvent || d.cancelEvent || d.reopenEvent, 'completeEvent' in d ? 'completed' : 'cancelEvent' in d ? 'cancelled' : 'pending');
    } else if ('deleteEvent' in d) await deleteEvent(d.deleteEvent);
  } catch (error) { notify(error.message, true); }
  finally { if (button.isConnected && button.id !== 'refresh-button') button.disabled = false; }
});
$('#detail-dialog').addEventListener('close', () => { ++detailSequence; });
['search', 'date-from', 'date-to'].forEach(id => $(`#${id}`).addEventListener('input', () => { if (state.ready) renderApplications(); }));
$('#event-filter').addEventListener('change', renderSchedule);
icons();
$('#today-label').textContent = format(new Date().toISOString(), { year: 'numeric', weekday: 'short' });
await loadData();
// Recalculate time-sensitive reminders while the page stays open; no background notifications.
setInterval(() => { if (state.ready && !document.hidden) { renderStats(); renderReminders(); renderSchedule(); } }, 60000);
