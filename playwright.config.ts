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
/** Placeholder only, never a real key; must match FakeHealthServer.enrollmentKey. */
export const E2E_ENROLLMENT_KEY = 'test-enrollment-key-placeholder';
/** #146: the e2e API base, served by the fake backend in e2e/health-sync.spec.ts (never a real server). */
export const E2E_API_URL = 'https://health.example.test';
const e2eEnv = { EXPO_PUBLIC_BODY_ANVIL_ENROLLMENT_KEY: E2E_ENROLLMENT_KEY, EXPO_PUBLIC_BODY_ANVIL_API_URL: E2E_API_URL };
const dev = process.env.E2E_DEV === '1';
const port = Number(process.env.PFT_E2E_PORT ?? (dev ? 8091 : 8081));

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
  outputDir: dev ? './test-results-dev' : './test-results',
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
  // #136: e2e builds carry a placeholder enrollment key (the fake backend in e2e/health-sync.spec.ts expects it).
  // Set here, it wins over any real key in a developer's .env.local. --clear: Metro's transform cache keeps inlined
  // EXPO_PUBLIC_ values, so without it a build could reuse a key from an earlier, differently configured build.
  webServer: dev
    ? { command: `npx expo start --web --clear --port ${port}`, env: e2eEnv, url: `http://localhost:${port}`, reuseExistingServer: !process.env.CI, timeout: 300_000 }
    : {
        command: 'npx expo export --platform web --clear && node scripts/serve-dist.mjs',
        env: { PORT: String(port), ...e2eEnv },
        url: `http://localhost:${port}`,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
      },
});
