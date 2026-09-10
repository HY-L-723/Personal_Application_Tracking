import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createApp } from './app.js';

const dataDir = resolve(process.env.DATA_DIR || 'data');
let auth;
try { auth = JSON.parse(readFileSync(join(dataDir, 'auth.json'), 'utf8')); }
catch { console.error('尚未配置访问密码，请先运行 npm run setup。'); process.exit(1); }
const { app, db } = createApp({
  databasePath: join(dataDir, 'tracker.db'), passwordHash: auth.passwordHash,
  secureCookies: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production',
  trustProxy: process.env.TRUST_PROXY === '1',
});
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const server = app.listen(port, host, () => console.log(`投递手记已启动：http://${host}:${port}`));
function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
