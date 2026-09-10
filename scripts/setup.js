import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { hashPassword } from '../server/auth.js';
import { openDatabase } from '../server/database.js';

try { process.loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const dir = resolve(process.env.DATA_DIR || 'data');
mkdirSync(dir, { recursive: true, mode: 0o700 });
const filename = join(dir, 'auth.json');
if (existsSync(filename) && !process.argv.includes('--reset')) {
  console.error('访问密码已配置。需要重置时运行 npm run setup -- --reset；投递数据不会被删除。');
  process.exit(1);
}
let password;
if (process.argv.includes('--generate')) {
  password = randomBytes(18).toString('base64url');
} else {
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
  const input = createInterface({ input: process.stdin, output, terminal: true });
  process.stdout.write('设置个人密码（至少 10 个字符，输入不回显）：');
  muted = true;
  password = await input.question('');
  process.stdout.write('\n再次输入：');
  const confirmation = await input.question('');
  input.close();
  process.stdout.write('\n');
  if (confirmation !== password) { console.error('两次密码不一致。'); process.exit(1); }
}
try {
  const passwordHash = await hashPassword(password);
  writeFileSync(filename, JSON.stringify({ passwordHash }, null, 2) + '\n', { mode: 0o600 });
  const db = openDatabase(join(dir, 'tracker.db'));
  db.prepare('DELETE FROM sessions').run();
  db.close();
  if (process.argv.includes('--generate')) {
    const accessPath = join(dir, 'initial-password.txt');
    writeFileSync(accessPath, password + '\n', { mode: 0o600 });
    console.log(`随机密码已保存在 ${accessPath}。该文件不会提交到 GitHub，请妥善保管。`);
  }
  console.log('配置完成。运行 npm start 启动网页。');
} catch (error) { console.error(error.message); process.exit(1); }
