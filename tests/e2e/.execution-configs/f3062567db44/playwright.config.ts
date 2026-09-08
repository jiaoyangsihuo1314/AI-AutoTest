import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: "/Users/syj/Documents/AI-AutoTest",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: "/Users/syj/Documents/AI-AutoTest/artifacts/automation-platform/playwright-reports/runs/f3062567db44", open: 'never' }],
    ['json', { outputFile: "/Users/syj/Documents/AI-AutoTest/tests/e2e/.execution-configs/f3062567db44/results.json" }],
  ],
  use: {
    baseURL: 'https://www.saucedemo.com',
    actionTimeout: 15_000,
    navigationTimeout: 15_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
