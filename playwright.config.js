import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui', fullyParallel: false, workers: 1, timeout: 30000,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3101', trace: 'retain-on-failure', screenshot: 'only-on-failure', channel: 'chrome' },
  projects: [{ name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } }, { name: 'mobile', use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium', channel: 'chrome' } }],
  webServer: { command: 'node tests/ui-server.js', url: 'http://127.0.0.1:3101/healthz', reuseExistingServer: false, timeout: 30000 },
});
