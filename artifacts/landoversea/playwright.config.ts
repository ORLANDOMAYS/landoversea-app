import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The suite runs against the dev proxy: web app at "/", API at "/api".
// Both workflows (LandOverSEA web + API Server) must be running.
const here = path.dirname(fileURLToPath(import.meta.url));
const authDir = path.join(here, 'e2e', '.auth');
const defaultBaseURL = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : 'http://localhost:80';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || defaultBaseURL,
    launchOptions: {
      executablePath: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    },
    viewport: { width: 420, height: 900 },
    timezoneId: 'UTC',
  },
  projects: [
    {
      name: 'auth-setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'release',
      testMatch: /.*\.spec\.ts/,
      dependencies: ['auth-setup'],
      use: {
        storageState: path.join(authDir, 'primary.json'),
      },
    },
  ],
});
