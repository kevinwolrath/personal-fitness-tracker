import { setEquipmentSelection } from '../src/equipment/catalogue';
import { expect, type Page } from '@playwright/test';
import seed from '../plans/seed.plan.json';

/** Frozen local times (Australia/Melbourne, AEDT +11:00). */
export const MONDAY = '2026-11-02T09:00:00+11:00';
export const THURSDAY = '2026-11-05T09:00:00+11:00';
export const SATURDAY = '2026-11-07T09:00:00+11:00';

export async function openAt(page: Page, isoTime: string) {
  await page.clock.setFixedTime(new Date(isoTime));
  await page.goto('/');
  await expect(page.getByTestId('day-progress')).toBeVisible();
  // Today's workout settles once its order has loaded (#56).
  await expect(page.getByTestId('today-workout-loading')).toHaveCount(0);
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

/**
 * The seed plan with Strength given an explicit day part, as a configured plan could (#41). The shipped seed's
 * Strength is untimed, so it is never promoted to "Do this next"; tests of the workout card seed this instead.
 */
export const seedWithStrengthWindow = (when: 'morning' | 'lunch' | 'afternoon' | 'evening' = 'morning') => ({
  ...seed,
  formatVersion: 9,
  // This training fixture explicitly confirms its stations; the real legacy seed still requires My Gym review.
  exercise: { ...seed.exercise, equipment: setEquipmentSelection(seed.exercise.equipment as any, ['multi_gym_chest_press', 'multi_gym_lat_pulldown', 'multi_gym_leg_extension'], true) },
  activities: seed.activities.map((a) => (a.id === 'resistance' ? { ...a, when } : a)),
});

/** Grow the viewport to the scroll content so one screenshot shows the whole day. */
export async function expandToFullDay(page: Page) {
  const height = await page.getByTestId('day-scroll').evaluate((el) => {
    const scroller = el as HTMLElement;
    return Math.ceil(window.innerHeight - scroller.clientHeight + scroller.scrollHeight);
  });
  await page.setViewportSize({ width: page.viewportSize()!.width, height });
}

/** Seed tracking records (keeping the plan already stored: the bundled seed, see playwright.config) before the app boots. */
export async function seedRecords(page: Page, records: { observations?: unknown[]; activities?: Record<string, unknown>; quickLogs?: unknown[]; exerciseLogs?: unknown[]; imports?: unknown[] }) {
  await page.addInitScript((json) => {
    const key = 'pft:tracking:v1';
    if (sessionStorage.getItem('pft:e2e:records')) return;
    sessionStorage.setItem('pft:e2e:records', '1');
    const r = JSON.parse(json);
    const plan = JSON.parse(localStorage.getItem(key) ?? 'null')?.plan ?? null;
    localStorage.setItem(key, JSON.stringify({ version: 1, plan, activities: r.activities ?? {}, overrides: {}, observations: r.observations ?? [], quickLogs: r.quickLogs ?? [], imports: r.imports ?? [], exerciseLogs: r.exerciseLogs ?? [] }));
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
export async function chooseFromMenu(page: Page, label: 'Configure with AI' | 'Export all data' | 'Edit setup answers' | 'My Gym' | 'Muscle coverage & exercise log') {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByTestId('app-menu').getByRole('button', { name: label }).click();
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

/** Today's workout (#56): the card, its sheet, and a session's options (full/short, skip, mark done) from the sheet. */
export const workoutCard = (page: Page) => page.getByTestId('today-workout');
export const workoutSheet = (page: Page) => page.getByTestId('today-workout-sheet');
export async function openWorkoutSheet(page: Page) {
  await page.getByTestId('today-workout-show-all').click();
  await expect(workoutSheet(page)).toBeVisible();
}
export async function closeWorkoutSheet(page: Page) {
  await page.getByRole('button', { name: "Close today's workout" }).click();
  await expect(workoutSheet(page)).toHaveCount(0);
}
export async function openSessionOptions(page: Page, label = 'Strength workout') {
  if (!(await workoutSheet(page).count())) await openWorkoutSheet(page);
  await workoutSheet(page).getByRole('button', { name: `${label}: full or short, skip and more` }).click();
}

/** Close the topmost open sheet (other sheets stay mounted but hidden). */
export async function closeTopSheet(page: Page) {
  await page.getByTestId('modal-dismiss').filter({ visible: true }).last().click();
}
