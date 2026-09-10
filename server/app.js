import express from 'express';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { openDatabase, transaction } from './database.js';
import { token, digest, verifyPassword } from './auth.js';
import { STAGES, ApiError, fail, text, choice, datetime, applicationInput, eventInput, checkVersion } from './validation.js';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const SESSION_AGE = 7 * 86400000;

export function createApp({ databasePath, passwordHash, secureCookies = false, trustProxy = false, clock = () => Date.now() }) {
  if (!passwordHash?.startsWith('scrypt:')) throw new Error('请先运行 npm run setup 设置个人访问密码。');
  const db = openDatabase(databasePath);
  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    if (secureCookies) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
  app.use(express.json({ limit: '48kb' }));
  app.use((req, res, next) => {
    const cookie = req.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith('tracker_session='))?.slice(16);
    if (cookie && /^[a-f0-9]{64}$/.test(cookie)) {
      req.sessionHash = digest(cookie);
      req.session = db.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?').get(req.sessionHash, clock());
    }
    next();
  });
  const auth = (req, res, next) => req.session ? next() : res.status(401).json({ error: '请先登录' });
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: secureCookies, path: '/' };
  const now = () => new Date(clock()).toISOString();
  function getApplication(id) {
    const record = db.prepare('SELECT * FROM applications WHERE id = ?').get(id);
    if (!record) fail('投递记录不存在', 404);
    return record;
  }
  function detail(id) {
    return {
      ...getApplication(id),
      history: db.prepare('SELECT * FROM history WHERE application_id = ? ORDER BY occurred_at DESC, id DESC').all(id),
      events: db.prepare('SELECT * FROM events WHERE application_id = ? ORDER BY due_at, id').all(id),
    };
  }
  // Event time determines the current stage; recorded time remains immutable for corrections.
  function recalculateStage(id) {
    const latest = db.prepare('SELECT stage FROM history WHERE application_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 1').get(id);
    db.prepare('UPDATE applications SET stage = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(latest.stage, now(), id);
  }
  function occurredAt(value) {
    const result = datetime(value || now(), true);
    if (Date.parse(result) > clock() + 60000) fail('流程发生时间不能在未来，请将未来安排添加为日程');
    return result;
  }
  app.get('/healthz', (req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ ok: true });
  });
  app.post('/api/login', async (req, res) => {
    if (!req.is('application/json') || req.headers['sec-fetch-site'] === 'cross-site') fail('请求来源无效', 403);
    const time = clock();
    db.prepare('DELETE FROM login_attempts WHERE attempted_at < ?').run(time - 15 * 60000);
    const ip = req.ip || 'unknown';
    const attempts = db.prepare('SELECT COUNT(*) AS total, COALESCE(SUM(ip = ?), 0) AS personal FROM login_attempts').get(ip);
    if (attempts.personal >= 10 || attempts.total >= 60) {
      res.set('Retry-After', '900');
      fail('尝试次数过多，请在 15 分钟后重试', 429);
    }
    db.prepare('INSERT INTO login_attempts(ip, attempted_at) VALUES (?, ?)').run(ip, time);
    if (!await verifyPassword(req.body?.password, passwordHash)) fail('密码不正确', 401);
    db.prepare('DELETE FROM login_attempts WHERE ip = ?').run(ip);
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(time);
    if (req.sessionHash) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionHash);
    const raw = token();
    const csrf = token();
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(raw), csrf, time + SESSION_AGE);
    res.cookie('tracker_session', raw, { ...cookieOptions, maxAge: SESSION_AGE });
    res.json({ csrf });
  });
  app.use('/api', auth, (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (!req.is('application/json') || req.headers['x-csrf-token'] !== req.session.csrf || req.headers['sec-fetch-site'] === 'cross-site') fail('请求验证失败，请刷新页面后重试', 403);
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) fail('请求数据格式不正确');
    }
    next();
  });
  app.get('/api/session', (req, res) => res.json({ csrf: req.session.csrf }));
  app.post('/api/logout', (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionHash);
    res.clearCookie('tracker_session', cookieOptions).json({ ok: true });
  });
  app.get('/api/dashboard', (req, res) => {
    const applications = db.prepare('SELECT * FROM applications ORDER BY updated_at DESC, id DESC').all();
    const events = db.prepare(`SELECT e.*, a.company, a.role FROM events e JOIN applications a ON a.id = e.application_id ORDER BY e.due_at, e.id`).all();
    const total = applications.filter(a => a.applied_at).length;
    const feedback = db.prepare(`SELECT COUNT(*) AS n FROM applications a WHERE a.applied_at IS NOT NULL AND (
      a.stage IN ('Offer', '拒绝') OR EXISTS (SELECT 1 FROM history h WHERE h.application_id = a.id AND h.stage IN ('笔试','一面','二面','HR面'))
    )`).get().n;
    const counts = Object.fromEntries(STAGES.map(stage => [stage, applications.filter(a => a.stage === stage).length]));
    res.json({ applications, events, stats: { total, feedback, feedbackRate: total ? Math.round(feedback * 100 / total) : 0, offers: counts.Offer, counts }, serverNow: now() });
  });
  app.get('/api/applications/:id', (req, res) => res.json(detail(req.params.id)));
  app.post('/api/applications', (req, res) => {
    const input = applicationInput(req.body);
    const time = now();
    const happened = occurredAt(req.body.occurred_at);
    const id = transaction(db, () => {
      const result = db.prepare('INSERT INTO applications(company,role,url,applied_at,stage,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(input.company, input.role, input.url, input.applied_at, input.stage, input.notes, time, time);
      const id = Number(result.lastInsertRowid);
      db.prepare('INSERT INTO history(application_id,stage,occurred_at,recorded_at,updated_at,note) VALUES (?,?,?,?,?,?)').run(id, input.stage, happened, time, time, '创建记录');
      return id;
    });
    res.status(201).json(detail(id));
  });
  app.put('/api/applications/:id', (req, res) => {
    const old = getApplication(req.params.id);
    checkVersion(req.body, old);
    const input = applicationInput(req.body);
    const happened = occurredAt(req.body.occurred_at);
    const historyNote = text(req.body.history_note, '流程备注', 2000);
    transaction(db, () => {
      db.prepare('UPDATE applications SET company=?,role=?,url=?,applied_at=?,notes=?,updated_at=?,version=version+1 WHERE id=?')
        .run(input.company, input.role, input.url, input.applied_at, input.notes, now(), old.id);
      if (old.stage !== input.stage) {
        db.prepare('INSERT INTO history(application_id,stage,occurred_at,recorded_at,updated_at,note) VALUES (?,?,?,?,?,?)').run(old.id, input.stage, happened, now(), now(), historyNote);
        recalculateStage(old.id);
      }
    });
    res.json(detail(old.id));
  });
  app.delete('/api/applications/:id', (req, res) => {
    const old = getApplication(req.params.id);
    checkVersion(req.body, old);
    db.prepare('DELETE FROM applications WHERE id = ?').run(old.id);
    res.json({ ok: true });
  });
  app.put('/api/applications/:id/history/:historyId', (req, res) => {
    const old = getApplication(req.params.id);
    checkVersion(req.body, old);
    const history = db.prepare('SELECT * FROM history WHERE id = ? AND application_id = ?').get(req.params.historyId, old.id);
    if (!history) fail('流程记录不存在', 404);
    const stage = choice(req.body.stage, STAGES, '进度');
    const happened = occurredAt(req.body.occurred_at);
    const note = text(req.body.note, '流程备注', 2000);
    transaction(db, () => {
      db.prepare('UPDATE history SET stage=?,occurred_at=?,updated_at=?,note=? WHERE id=?').run(stage, happened, now(), note, history.id);
      recalculateStage(old.id);
    });
    res.json(detail(old.id));
  });
  app.post('/api/applications/:id/events', (req, res) => {
    const record = getApplication(req.params.id);
    const e = eventInput(req.body);
    const id = db.prepare('INSERT INTO events(application_id,title,kind,due_at,url,notes,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(record.id, e.title, e.kind, e.due_at, e.url, e.notes, e.status, now(), now()).lastInsertRowid;
    res.status(201).json(db.prepare('SELECT * FROM events WHERE id=?').get(id));
  });
  app.put('/api/events/:id', (req, res) => {
    const old = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
    if (!old) fail('日程不存在', 404);
    checkVersion(req.body, old);
    const e = eventInput(req.body);
    db.prepare('UPDATE events SET title=?,kind=?,due_at=?,url=?,notes=?,status=?,version=version+1,updated_at=? WHERE id=?')
      .run(e.title, e.kind, e.due_at, e.url, e.notes, e.status, now(), old.id);
    res.json(db.prepare('SELECT * FROM events WHERE id=?').get(old.id));
  });
  app.delete('/api/events/:id', (req, res) => {
    const old = db.prepare('SELECT * FROM events WHERE id=?').get(req.params.id);
    if (!old) fail('日程不存在', 404);
    checkVersion(req.body, old);
    db.prepare('DELETE FROM events WHERE id=?').run(old.id);
    res.json({ ok: true });
  });
  app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));
  app.use('/assets', (req, res, next) => {
    if (!/\.(js|css|svg)$/.test(req.path)) return res.status(404).end();
    next();
  }, express.static(publicDir, { dotfiles: 'deny', index: false, etag: false }));
  app.get('/login', (req, res) => req.session ? res.redirect('/') : res.sendFile(join(publicDir, 'login.html')));
  app.get('/', (req, res) => req.session ? res.sendFile(join(publicDir, 'index.html')) : res.redirect('/login'));
  app.use((req, res) => res.status(404).send('页面不存在'));
  app.use((error, req, res, next) => {
    if (error instanceof ApiError) return res.status(error.status).json({ error: error.message });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: '请求数据不是有效的 JSON' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: '提交内容过大' });
    console.error(error);
    res.status(500).json({ error: '服务器暂时无法处理请求，请稍后重试' });
  });
  return { app, db };
}
