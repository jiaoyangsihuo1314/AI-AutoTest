import { defineConfig, devices } from 'playwright/test';
import baseConfig from './playwright.config';

export default defineConfig({
  ...baseConfig,
  projects: [
    {
      name: 'google-chrome',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        headless: false,
      },
    },
  ],
});
