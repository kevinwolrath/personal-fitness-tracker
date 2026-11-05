import { expect, test, type Page } from '@playwright/test';
import { MONDAY, expandToFullDay, openAt } from './helpers';

/**
 * Issue #36: Android Health Connect, read only. Browsers have no Health Connect, so the web build reports it as
 * unsupported unless a test installs a fixture (src/platform/healthConnect.web.ts). The fixture stands in for the
 * platform only: sync, mapping, storage and UI are the real code.
 */

const SAMSUNG = 'com.sec.android.app.shealth';
const WITHINGS = 'com.withings.wiscale2';
const KEY = 'pft.test.healthConnect';
const ALL = ['steps', 'active_energy', 'exercise', 'weight', 'sleep'];

const data = {
  steps: [
    { date: '2026-11-02', value: 6214, origins: [SAMSUNG] },
    { date: '2026-11-01', value: 11002, origins: [SAMSUNG] },
  ],
  activeKcal: [{ date: '2026-11-02', value: 320, origins: [SAMSUNG] }],
  exercise: [{ id: 'ex1', start: '2026-11-02T07:30:00+11:00', end: '2026-11-02T08:02:00+11:00', origin: SAMSUNG, exerciseType: 79 }],
  weight: [{ id: 'w1', time: '2026-11-02T06:58:00+11:00', kg: 82.4, origin: WITHINGS }],
  sleep: [{ id: 's1', start: '2026-11-01T23:00:00+11:00', end: '2026-11-02T06:45:00+11:00', origin: SAMSUNG }],
};

/** Install the stand-in before the app boots, once: later reloads keep what the app (or the test) changed. */
async function installHealthConnect(page: Page, over: Record<string, unknown> = {}) {
  await page.addInitScript(
    ([key, json]) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, json);
    },
    [KEY, JSON.stringify({ availability: 'available', grantOnRequest: ALL, granted: [], data, ...over })] as const,
  );
}
const fixture = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), KEY);
const setFixture = (page: Page, f: unknown) => page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(f)] as const);
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('pft:tracking:v1')!).observations as any[]);
const imported = async (page: Page) => (await stored(page)).filter((o) => o.source.importId === 'health-connect');

async function openSheet(page: Page) {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByTestId('menu-health-connect').click();
  await expect(page.getByTestId('health-connect-sheet')).toBeVisible();
}
async function connect(page: Page) {
  await openSheet(page);
  await page.getByRole('button', { name: 'Connect Health Connect' }).click();
  await expect(page.getByTestId('hc-sync-status')).toContainText('Last synced today');
}
const close = (page: Page) => page.getByTestId('modal-dismiss').click();

test('unsupported (any browser, an iPhone): the menu says so; nothing else changes', async ({ page }) => {
  await openAt(page, MONDAY);
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByTestId('menu-health-connect')).toContainText('Not available on this device');
  await page.getByTestId('menu-health-connect').click();
  await expect(page.getByTestId('hc-unsupported')).toContainText('available on Android phones');
});

test('off until connected: no request and no read on launch', async ({ page }) => {
  await installHealthConnect(page);
  await openAt(page, MONDAY);
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByTestId('menu-health-connect')).toContainText('Off · steps, energy, workouts, weight and sleep');
  const f = await fixture(page);
  expect(f.requests ?? 0).toBe(0);
  expect(f.reads ?? []).toEqual([]);
});

test('connect → 30 days imported into the existing Daily Log, labelled with their source; later syncs read 7 days', async ({ page }) => {
  await installHealthConnect(page);
  await openAt(page, MONDAY);
  await connect(page);
  await expect(page.getByTestId('hc-today-steps')).toContainText('6,214');
  await expect(page.getByTestId('hc-today-steps')).toContainText('Samsung Health');
  await expect(page.getByTestId('hc-today-active_energy')).toContainText('1,340 kJ');
  await expect(page.getByTestId('hc-today-active_energy')).toContainText('Samsung Health');
  await expect(page.getByTestId('hc-today-exercise')).toContainText('Walk 32m');
  await expect(page.getByTestId('hc-today-weight')).toContainText('82.4 kg');
  await expect(page.getByTestId('hc-today-weight')).toContainText('Withings');
  await expect(page.getByTestId('hc-today-sleep')).toContainText('7h 45m');
  await close(page);

  // No Health Connect view of the day: the values sit in the Weight tile and the Recorded rows.
  await expect(page.getByTestId('measurement-weight')).toContainText('82.4 kg');
  await expect(page.getByTestId('measurement-weight')).toContainText('Health Connect · Withings');
  await expect(page.getByTestId('recorded-steps')).toContainText('6,214');
  await expect(page.getByTestId('recorded-steps')).toContainText('Health Connect · Samsung Health');
  await expect(page.getByTestId('recorded-sleep_duration')).toContainText('7h 45m');

  const f = await fixture(page);
  expect(f.requests).toBe(1);
  expect(f.reads[0].dates).toHaveLength(30);
  expect(f.reads[0].types).toEqual(ALL);
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByTestId('menu-health-connect')).toContainText('Connected · synced');
  await page.getByTestId('menu-health-connect').click();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect.poll(async () => (await fixture(page)).reads.length).toBe(2);
  expect((await fixture(page)).reads[1].dates).toHaveLength(7);
});

test('re-syncing is idempotent and follows Health Connect: changes update, deletions disappear, nothing duplicates', async ({ page }) => {
  await installHealthConnect(page);
  await openAt(page, MONDAY);
  await connect(page);
  const first = await imported(page);
  expect(first.map((o) => o.id).sort()).toEqual(
    ['hc:active_energy:2026-11-02', 'hc:exercise:ex1', 'hc:sleep:2026-11-02', 'hc:steps:2026-11-01', 'hc:steps:2026-11-02', 'hc:weight:2026-11-02'],
  );

  // Same data again: identical records.
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect.poll(async () => (await fixture(page)).reads.length).toBe(2);
  expect((await imported(page)).map((o) => [o.id, o.value]).sort()).toEqual(first.map((o) => [o.id, o.value]).sort());

  // In Health Connect: today's steps went up, the workout was deleted.
  const f = await fixture(page);
  f.data.steps[0].value = 8100;
  f.data.exercise = [];
  await setFixture(page, f);
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByTestId('hc-today-steps')).toContainText('8,100');
  const after = await imported(page);
  expect(after.find((o) => o.id === 'hc:steps:2026-11-02').value).toBe(8100);
  expect(after.find((o) => o.id === 'hc:exercise:ex1')).toBeUndefined();
  expect(after).toHaveLength(5);
});

test('a weight entered by hand is kept and shown first; syncing never overwrites it', async ({ page }) => {
  await installHealthConnect(page);
  await openAt(page, MONDAY);
  await connect(page);
  await close(page);
  await expect(page.getByTestId('measurement-weight')).toContainText('82.4 kg');

  await page.getByTestId('measurement-weight').click();
  await page.getByTestId('measure-input').fill('81.9');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('measurement-weight')).toContainText('81.9 kg');

  await page.reload(); // app open → sync again
  await expect(page.getByTestId('day-progress')).toBeVisible();
  await expect.poll(async () => (await fixture(page)).reads.length).toBe(2);
  await expect(page.getByTestId('measurement-weight')).toContainText('81.9 kg');
  const weights = (await stored(page)).filter((o) => o.metric === 'weight' && o.date === '2026-11-02');
  expect(weights.map((o) => o.source.type).sort()).toEqual(['integration', 'manual']); // both kept, distinguishable
});

test('imported values are read-only here: the details say where to change them', async ({ page }) => {
  await installHealthConnect(page);
  await openAt(page, MONDAY);
  await connect(page);
  await close(page);
  await page.getByTestId('recorded-steps').click();
  await expect(page.getByTestId('observation-imported-note')).toContainText('Change or delete it there');
  await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
});

test('imported active energy follows the energy display (#39)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pft.display.energy', 'kcal'));
  await installHealthConnect(page);
  await openAt(page, MONDAY);
  await connect(page);
  await expect(page.getByTestId('hc-today-active_energy')).toContainText('320 kcal');
  await close(page);
  await expect(page.getByTestId('recorded-active_energy')).toContainText('320 kcal');
});

test('a failing read never blocks the app; the other types still sync and the failed one keeps its values', async ({ page }) => {
  await installHealthConnect(page);
  await openAt(page, MONDAY);
  await connect(page);
  const f = await fixture(page);
  f.failTypes = ['sleep'];
  f.data.steps[0].value = 7000;
  await setFixture(page, f);
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByTestId('hc-sync-status')).toContainText("Last sync didn't finish");
  await expect(page.getByTestId('hc-sync-status')).toContainText("couldn't read sleep"); // which type, not just "didn't finish"
  await expect(page.getByTestId('hc-today-weight')).toContainText('82.4 kg'); // the others still read
  await expect(page.getByTestId('hc-today-steps')).toContainText('7,000');
  await expect(page.getByTestId('hc-today-sleep')).toContainText('7h 45m'); // kept from the last good read
  await close(page);
  await expect(page.getByTestId('next-action')).toBeVisible();
});

test('revoking one type keeps its imported values while the others refresh (#43)', async ({ page }) => {
  await installHealthConnect(page);
  await openAt(page, MONDAY);
  await connect(page);
  const sleepBefore = (await imported(page)).find((o) => o.id === 'hc:sleep:2026-11-02');
  expect(sleepBefore.value).toBe(465);

  // In Health Connect's own settings: sleep turned off, steps still allowed. Steps went up; the sleep data
  // there also changed, so a wrong re-read of sleep would show.
  const f = await fixture(page);
  f.granted = ALL.filter((t) => t !== 'sleep');
  f.data.steps[0].value = 8100;
  f.data.sleep = [];
  await setFixture(page, f);
  await page.getByRole('button', { name: 'Sync now' }).click();

  await expect(page.getByTestId('hc-today-steps')).toContainText('8,100'); // still allowed: refreshed
  await expect(page.getByTestId('hc-today-sleep')).toContainText('Not allowed');
  const after = await fixture(page);
  expect(after.reads[after.reads.length - 1].types).not.toContain('sleep'); // not read at all
  expect(after.requests).toBe(1); // never asked again by itself
  expect((await imported(page)).find((o) => o.id === 'hc:sleep:2026-11-02')).toEqual(sleepBefore); // kept, unchanged

  await close(page);
  await expect(page.getByTestId('recorded-sleep_duration')).toContainText('7h 45m');
  await expect(page.getByTestId('recorded-steps')).toContainText('8,100');
});

test('#44: weight not in Health Connect yet → says so; Fitbit exports it later → imported on the next sync', async ({ page }) => {
  const PHONE = 'com.android.healthconnect.phone.j26a4212';
  const FITBIT = 'com.fitbit.FitbitMobile';
  await installHealthConnect(page, {
    data: {
      steps: [{ date: '2026-11-02', value: 1698, origins: [PHONE, FITBIT] }],
      activeKcal: [{ date: '2026-11-02', value: 86, origins: [PHONE] }],
      sleep: [{ id: 's', start: '2026-11-01T23:30:00+11:00', end: '2026-11-02T06:17:00+11:00', origin: FITBIT }],
      weight: [], // Fitbit has it; Health Connect doesn't (yet)
      exercise: [],
    },
  });
  await openAt(page, MONDAY);
  await connect(page);
  // Readable sources, never a raw ID.
  await expect(page.getByTestId('hc-today-steps')).toContainText('Fitbit + this phone');
  await expect(page.getByTestId('hc-today-active_energy')).toContainText('This phone');
  await expect(page.getByTestId('health-connect-sheet')).not.toContainText('com.android');
  // Upstream absence is stated, not hidden behind "synced".
  await expect(page.getByTestId('hc-today-weight')).toContainText('None in Health Connect · last 30 days');
  await expect(page.getByTestId('hc-today-exercise')).toContainText('None in Health Connect');
  await expect(page.getByTestId('hc-missing-help')).toContainText('hasn’t reached Health Connect yet');
  await expect(page.getByTestId('hc-not-imported')).toContainText('body fat');

  // Fitbit's export arrives later (7:48 am weigh-in); the next sync picks it up.
  const f = await fixture(page);
  f.data.weight = [{ id: 'fw', time: '2026-11-02T07:48:00+11:00', kg: 95.5, origin: FITBIT }];
  await setFixture(page, f);
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByTestId('hc-today-weight')).toContainText('95.5 kg');
  await expect(page.getByTestId('hc-today-weight')).toContainText('Fitbit');
  await close(page);
  await expect(page.getByTestId('measurement-weight')).toContainText('95.5 kg');
  await expect(page.getByTestId('measurement-weight')).toContainText('Health Connect · Fitbit');
  await expect(page.getByTestId('recorded-steps')).toContainText('Health Connect · Fitbit + this phone');
});

test('#44: none today, but earlier in the window → the latest date is shown', async ({ page }) => {
  await installHealthConnect(page, {
    data: { ...data, weight: [{ id: 'w0', time: '2026-10-31T07:00:00+11:00', kg: 96.1, origin: 'com.withings.wiscale2' }] },
  });
  await openAt(page, MONDAY);
  await connect(page);
  await expect(page.getByTestId('hc-today-weight')).toContainText('None today');
  await expect(page.getByTestId('hc-today-weight')).toContainText('Latest Sat, 31 Oct');
});

test('#44: an unknown source app is "Another app" on screen; its ID is only in the value’s details', async ({ page }) => {
  await installHealthConnect(page, { data: { ...data, steps: [{ date: '2026-11-02', value: 4000, origins: ['com.example.tracker'] }] } });
  await openAt(page, MONDAY);
  await connect(page);
  await expect(page.getByTestId('hc-today-steps')).toContainText('Another app');
  await close(page);
  await expect(page.getByTestId('recorded-steps')).toContainText('Health Connect · Another app');
  await page.getByTestId('recorded-steps').click();
  await expect(page.getByText('com.example.tracker')).toBeVisible(); // App ID, for troubleshooting
});

test('refused, then allowed later in Health Connect: picked up on the next app open without asking again', async ({ page }) => {
  await installHealthConnect(page, { grantOnRequest: [] });
  await openAt(page, MONDAY);
  await openSheet(page);
  await page.getByRole('button', { name: 'Connect Health Connect' }).click();
  await expect(page.getByTestId('hc-refused')).toContainText('Nothing was allowed');
  await page.getByRole('button', { name: 'Open Health Connect' }).click();
  expect((await fixture(page)).opened).toEqual(['settings']);
  expect(await imported(page)).toEqual([]);

  // The user allows steps and weight in Health Connect's own screen.
  const f = await fixture(page);
  f.granted = ['steps', 'weight'];
  await setFixture(page, f);
  await page.reload();
  await expect(page.getByTestId('recorded-steps')).toContainText('6,214');
  expect((await fixture(page)).requests).toBe(1);
  expect((await imported(page)).map((o) => o.metric).sort()).toEqual(['steps', 'steps', 'weight']);
});

test('not installed: one way forward, nothing else changes', async ({ page }) => {
  await installHealthConnect(page, { availability: 'not_installed' });
  await openAt(page, MONDAY);
  await openSheet(page);
  await expect(page.getByTestId('hc-install')).toContainText('isn’t installed');
  await page.getByRole('button', { name: 'Get Health Connect' }).click();
  expect((await fixture(page)).opened).toEqual(['install']);
});

test.describe('visual', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'baselines are kept for the phone viewport only'));
  test('health-connect-off', async ({ page }) => {
    await installHealthConnect(page);
    await openAt(page, MONDAY);
    await openSheet(page);
    await expect(page).toHaveScreenshot('health-connect-off.png');
  });
  test('health-connect-on', async ({ page }) => {
    await installHealthConnect(page);
    await openAt(page, MONDAY);
    await connect(page);
    await expect(page).toHaveScreenshot('health-connect-on.png');
  });
  test('health-connect-missing (#44: weight not in Health Connect, steps from Fitbit + this phone)', async ({ page }) => {
    await installHealthConnect(page, {
      data: {
        ...data,
        steps: [{ date: '2026-11-02', value: 1698, origins: ['com.android.healthconnect.phone.j26a4212', 'com.fitbit.FitbitMobile'] }],
        activeKcal: [{ date: '2026-11-02', value: 86, origins: ['com.android.healthconnect.phone.j26a4212'] }],
        sleep: [{ id: 's', start: '2026-11-01T23:30:00+11:00', end: '2026-11-02T06:17:00+11:00', origin: 'com.fitbit.FitbitMobile' }],
        weight: [],
        exercise: [],
      },
    });
    await openAt(page, MONDAY);
    await connect(page);
    await expect(page.getByTestId('hc-missing-help')).toBeVisible();
    await expect(page).toHaveScreenshot('health-connect-missing.png');
  });
  test('today-health-connect-full', async ({ page }) => {
    await installHealthConnect(page);
    await openAt(page, MONDAY);
    await connect(page);
    await close(page);
    await expect(page.getByTestId('recorded-steps')).toBeVisible();
    await expandToFullDay(page);
    await expect(page).toHaveScreenshot('today-health-connect-full.png');
  });
});
