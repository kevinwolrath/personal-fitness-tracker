import { defineConfig } from '@playwright/test';

/** Contract 05 reference viewports. Visual baselines are kept for `phone` only. */
const phone = (width: number, height: number) => ({
  viewport: { width, height },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  locale: 'en-AU',
  timezoneId: 'Australia/Melbourne',
});

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: [['list']],
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' } },
  use: { baseURL: 'http://localhost:8081', trace: 'retain-on-failure' },
  projects: [
    { name: 'phone-small', use: phone(360, 780) },
    { name: 'phone', use: phone(390, 844) },
    { name: 'phone-large', use: phone(430, 932) },
  ],
  webServer: {
    command: 'npx expo export --platform web && node scripts/serve-dist.mjs',
    url: 'http://localhost:8081',
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
