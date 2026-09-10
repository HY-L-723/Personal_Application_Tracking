export const STAGES = ['已收藏', '已投递', '笔试', '一面', '二面', 'HR面', 'Offer', '拒绝'];
export const KINDS = ['测评截止', '笔试', '面试', '其他'];
export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (message, status = 400) => { throw new ApiError(status, message); };
export function text(value, label, max, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string') fail(`${label}格式不正确`);
  const result = value.trim();
  if (required && !result) fail(`请填写${label}`);
  if (result.length > max) fail(`${label}不能超过 ${max} 个字符`);
  return result;
}
export function choice(value, choices, label) {
  if (!choices.includes(value)) fail(`${label}无效`);
  return value;
}
export function url(value) {
  const result = text(value, '链接', 2000);
  if (!result) return '';
  try {
    const parsed = new URL(result);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
  } catch { fail('请填写完整的 http:// 或 https:// 链接'); }
  return result;
}
export function datetime(value, required = false) {
  if ((value == null || value === '') && !required) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) fail('时间必须包含时区');
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) fail('时间无效');
  const day = value.slice(0, 10);
  if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) fail('日期无效');
  const result = new Date(milliseconds).toISOString();
  if (result < '2000' || result >= '2100') fail('时间应在 2000–2099 年之间');
  return result;
}
export function applicationInput(body) {
  return {
    company: text(body.company, '公司名称', 120, true), role: text(body.role, '岗位名称', 160, true),
    url: url(body.url), applied_at: datetime(body.applied_at),
    stage: choice(body.stage, STAGES, '进度'), notes: text(body.notes, '备注', 10000),
  };
}
export function eventInput(body) {
  return {
    title: text(body.title, '日程名称', 160, true), kind: choice(body.kind, KINDS, '日程类型'),
    due_at: datetime(body.due_at, true), url: url(body.url), notes: text(body.notes, '备注', 10000),
    status: choice(body.status ?? 'pending', ['pending', 'completed', 'cancelled'], '日程状态'),
  };
}
export function checkVersion(body, record) {
  if (!Number.isInteger(body.version) || body.version !== record.version) {
    fail('这条记录已在其他页面更新，请刷新后重新编辑。', 409);
  }
}
