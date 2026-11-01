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

/** E2E_DEV=1: run the dev-server smoke test against `expo start --web` instead of the production export. */
const dev = process.env.E2E_DEV === '1';
const port = dev ? 8091 : 8081;

export default defineConfig({
  testDir: './e2e',
  testMatch: dev ? 'dev-smoke.spec.ts' : undefined,
  testIgnore: dev ? undefined : 'dev-smoke.spec.ts',
  fullyParallel: true,
  reporter: [['list']],
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' } },
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure' },
  projects: dev
    ? [{ name: 'phone', use: phone(390, 844) }]
    : [
        { name: 'phone-small', use: phone(360, 780) },
        { name: 'phone', use: phone(390, 844) },
        { name: 'phone-large', use: phone(430, 932) },
      ],
  webServer: dev
    ? { command: `npx expo start --web --port ${port}`, url: `http://localhost:${port}`, reuseExistingServer: !process.env.CI, timeout: 300_000 }
    : {
        command: 'npx expo export --platform web && node scripts/serve-dist.mjs',
        url: `http://localhost:${port}`,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
      },
});
