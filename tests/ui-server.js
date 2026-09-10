import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { hashPassword } from '../server/auth.js';
import { createApp } from '../server/app.js';
mkdirSync(resolve('.local'), { recursive: true });
const directory = mkdtempSync(resolve('.local', 'ui-test-'));
const { app } = createApp({ databasePath: join(directory, 'tracker.db'), passwordHash: await hashPassword('ui-test-only-password-2026') });
app.listen(3101, '127.0.0.1', () => console.log('UI test server ready'));
