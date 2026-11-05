import { readFileSync } from 'node:fs';
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

/**
 * Every test starts as an existing install running the bundled seed plan (#49: a fresh install goes through
 * first-run setup instead). Setup tests opt out with an empty storage state.
 */
const seedJson = readFileSync('plans/seed.plan.json', 'utf8');
const seed = JSON.parse(seedJson);
const seededStorage = {
  cookies: [],
  origins: [
    {
      origin: `http://localhost:${port}`,
      localStorage: [
        {
          name: 'pft:tracking:v1',
          value: JSON.stringify({
            version: 1,
            plan: { planId: seed.id, revision: seed.revision, formatVersion: seed.formatVersion, json: seedJson, importedAt: '2026-11-01T00:00:00.000Z', origin: 'seed' },
            activities: {},
            overrides: {},
            observations: [],
            quickLogs: [],
            imports: [],
            configChanges: [],
            completionEvents: [],
            daySnapshots: {},
          }),
        },
      ],
    },
  ],
};

export default defineConfig({
  testDir: './e2e',
  testMatch: dev ? 'dev-smoke.spec.ts' : undefined,
  testIgnore: dev ? undefined : 'dev-smoke.spec.ts',
  fullyParallel: true,
  reporter: [['list']],
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' } },
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure', storageState: seededStorage },
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
