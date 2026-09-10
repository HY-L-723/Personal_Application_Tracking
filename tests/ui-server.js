import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createApp } from '../server/app.js';
mkdirSync(resolve('.local'), { recursive: true });
const directory = mkdtempSync(resolve('.local', 'ui-test-'));
const { app } = createApp({ databasePath: join(directory, 'tracker.db') });
app.listen(3101, '127.0.0.1', () => console.log('UI test server ready'));
