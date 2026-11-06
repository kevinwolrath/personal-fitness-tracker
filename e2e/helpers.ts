import { expect, type Page } from '@playwright/test';

/** Frozen local times (Australia/Melbourne, AEDT +11:00). */
export const MONDAY = '2026-11-02T09:00:00+11:00';
export const THURSDAY = '2026-11-05T09:00:00+11:00';
export const SATURDAY = '2026-11-07T09:00:00+11:00';

export async function openAt(page: Page, isoTime: string) {
  await page.clock.setFixedTime(new Date(isoTime));
  await page.goto('/');
  await expect(page.getByTestId('day-progress')).toBeVisible();
}

/** Activity ids rendered in a section, in order (from data-testid="activity-<id>"). */
export async function renderedActivityIds(page: Page): Promise<string[]> {
  const ids = await page.locator('[data-testid^="activity-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!));
  return ids.map((id) => id.replace('activity-', ''));
}

export const row = (page: Page, id: string) => page.getByTestId(`activity-${id}`);

/** Seed a different plan by writing the web store document before the app boots (only on first load). */
export async function seedPlan(page: Page, plan: unknown) {
  await page.addInitScript((json) => {
    const key = 'pft:tracking:v1';
    // Once per test (sessionStorage survives reloads): later reloads keep what the app changed.
    if (sessionStorage.getItem('pft:e2e:plan')) return;
    sessionStorage.setItem('pft:e2e:plan', '1');
    const p = JSON.parse(json);
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        plan: { planId: p.id, revision: p.revision, formatVersion: p.formatVersion, json, importedAt: new Date().toISOString() },
        activities: {},
        overrides: {},
        measurements: [],
        quickLogs: [],
      }),
    );
  }, JSON.stringify(plan));
}

/** Grow the viewport to the scroll content so one screenshot shows the whole day. */
export async function expandToFullDay(page: Page) {
  const height = await page.getByTestId('day-scroll').evaluate((el) => {
    const scroller = el as HTMLElement;
    return Math.ceil(window.innerHeight - scroller.clientHeight + scroller.scrollHeight);
  });
  await page.setViewportSize({ width: page.viewportSize()!.width, height });
}

/** Seed tracking records (keeping the plan already stored: the bundled seed, see playwright.config) before the app boots. */
export async function seedRecords(page: Page, records: { observations?: unknown[]; activities?: Record<string, unknown>; quickLogs?: unknown[] }) {
  await page.addInitScript((json) => {
    const key = 'pft:tracking:v1';
    if (sessionStorage.getItem('pft:e2e:records')) return;
    sessionStorage.setItem('pft:e2e:records', '1');
    const r = JSON.parse(json);
    const plan = JSON.parse(localStorage.getItem(key) ?? 'null')?.plan ?? null;
    localStorage.setItem(key, JSON.stringify({ version: 1, plan, activities: r.activities ?? {}, overrides: {}, observations: r.observations ?? [], quickLogs: r.quickLogs ?? [], imports: [] }));
  }, JSON.stringify(records));
}

const shot = (app: string, evidence: string) => ({
  type: 'screenshot', app, capturedAt: '2025-12-25T20:10:00+11:00', confidence: 0.95, importId: 'imp', assetId: 'a', evidence, edited: false,
});
/** A full historical day: several sources, a workout, a calculated value, a long custom label. */
export const HISTORY_DAY = '2025-12-25';
export const historyObservations = [
  { id: 'h1', date: HISTORY_DAY, metric: 'weight', value: 99.35, unit: 'kg', kind: 'observed', label: null, note: null, recordedAt: '2025-12-25T07:00:00Z', source: shot('renpho', '99.35 kg') },
  { id: 'h2', date: HISTORY_DAY, metric: 'weight', value: 101.9, unit: 'kg', kind: 'inferred', label: null, note: null, recordedAt: '2025-12-25T07:00:01Z', source: shot('renpho', '99.35 + 2.55') },
  { id: 'h3', date: HISTORY_DAY, metric: 'steps', value: 18342, unit: 'count', kind: 'observed', label: null, note: null, recordedAt: '2025-12-25T09:00:00Z', source: shot('fitbit', '18,342') },
  { id: 'h4', date: HISTORY_DAY, metric: 'sleep_duration', value: 412, unit: 'min', kind: 'observed', label: null, note: null, recordedAt: '2025-12-25T09:00:01Z', source: shot('fitbit', '6 hr 52 min') },
  { id: 'h5', date: HISTORY_DAY, metric: 'readiness_score', value: 63, unit: 'score', kind: 'observed', label: null, note: null, recordedAt: '2025-12-25T09:00:02Z', source: shot('fitbit', '63') },
  { id: 'h6', date: HISTORY_DAY, metric: 'exercise_session', value: 52, unit: 'min', kind: 'observed', label: 'Outdoor bike ride with the kids around the lake', note: null, recordedAt: '2025-12-25T09:00:03Z', source: shot('google-health-connect', '52 min') },
  { id: 'h7', date: HISTORY_DAY, metric: 'total_energy', value: 13180, unit: 'kJ', kind: 'observed', label: null, note: null, recordedAt: '2025-12-25T09:00:04Z', source: shot('fitbit', '3,150 cal') },
];

/** The VR boxing alternative inside tonight's conditioning requirement (contract 08). */
export const vrBoxing = (page: Page) => page.getByTestId('option-vr-boxing');

/** App-level operations live in the header menu (#15). */
export async function chooseFromMenu(page: Page, label: 'Import from screenshots' | 'Configure with AI' | 'Export all data' | 'Edit setup answers') {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByTestId('app-menu').getByRole('button', { name: label }).click();
}

/** Menu → Import from screenshots: the platform picker opens straight away; choose these files. */
export async function importScreenshots(page: Page, files: string[]) {
  const chooser = page.waitForEvent('filechooser');
  await chooseFromMenu(page, 'Import from screenshots');
  const fc = await chooser;
  expect(fc.isMultiple()).toBe(true);
  await fc.setFiles(files);
  await expect(page.getByRole('heading', { name: 'Import screenshots' })).toBeVisible();
}

/** Menu → Export all data → confirm "Export JSON". Resolves with the downloaded document. */
export async function exportAllData(page: Page): Promise<any> {
  await chooseFromMenu(page, 'Export all data');
  const dialog = page.getByRole('alertdialog', { name: 'Export all fitness data?' });
  await expect(dialog).toBeVisible();
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export JSON' }).click();
  const { readFileSync } = await import('node:fs');
  return JSON.parse(readFileSync((await (await download).path())!, 'utf8'));
}
