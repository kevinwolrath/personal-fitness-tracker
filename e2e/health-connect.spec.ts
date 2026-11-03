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
  await expect(page.getByTestId('hc-today-steps')).toContainText('7,000');
  await expect(page.getByTestId('hc-today-sleep')).toContainText('7h 45m'); // kept from the last good read
  await close(page);
  await expect(page.getByTestId('next-action')).toBeVisible();
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
