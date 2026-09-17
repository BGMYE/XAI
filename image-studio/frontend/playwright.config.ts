import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 2,
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:5176', browserName: 'chromium', channel: process.env.PLAYWRIGHT_CHANNEL || undefined, headless: true, trace: 'retain-on-failure', launchOptions: { args: ['--disable-features=msEdgeEnclavePrefsBasic'] } },
  webServer: { command: 'node node_modules/vite/bin/vite.js --mode windows --host 127.0.0.1 --port 5176 --strictPort', env: { VITE_TARGET_PLATFORM: 'windows' }, url: 'http://127.0.0.1:5176', reuseExistingServer: !process.env.CI },
  reporter: process.env.CI ? 'github' : 'list',
});
