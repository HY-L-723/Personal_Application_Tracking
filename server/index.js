import { resolve, join } from 'node:path';
import { createApp } from './app.js';

const dataDir = resolve(process.env.DATA_DIR || 'data');
const { app, db } = createApp({
  databasePath: join(dataDir, 'tracker.db'),
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
