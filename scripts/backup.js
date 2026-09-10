import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const source = resolve(process.env.DATA_DIR || 'data', 'tracker.db');
if (!existsSync(source)) throw new Error('数据库不存在，请先启动应用。');
const dir = resolve('backups');
mkdirSync(dir, { recursive: true });
const target = join(dir, `tracker-${new Date().toISOString().replaceAll(':', '-')}.db`);
const db = new DatabaseSync(source, { readOnly: true });
try { await backup(db, target); console.log(`数据库已备份至 ${target}`); }
finally { db.close(); }
