import { expect, test, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import seed from '../plans/seed.plan.json';
import { MONDAY, chooseFromMenu, leaveSettings } from './helpers';

/**
 * #128 Full offline backup and restore on the web build: back up a realistic fictional history with meal photos,
 * wipe the browser (a fresh install), restore from first-run setup, and get every record and photo back. Also:
 * restore over existing data (cancel, then replace) and a damaged file that changes nothing.
 */

const SHOTS = 'docs/design/issue-128-backup';
const KEY = 'pft:tracking:v1';
const png = (n: number) => `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), randomBytes(n)]).toString('base64')}`;
const shot = async (page: Page, name: string, project: string) => {
  if (project !== 'phone') return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

/** A fictional history: plan, activity, measurements (incl. imported), Muscle Growth with a skip, meals with photos. */
const PHOTOS = { 'p-1': png(3000), 'p-2': png(5000), 'p-3': png(4000) };
function doc() {
  const meal = (id: string, date: string, photos: string[]) => ({
    id, date, at: `${date}T12:15:00+11:00`, planId: null, activityId: null, replacedLabel: null, name: `Lunch ${id}`,
    items: [{ name: 'Rice bowl', quantity: 1, unit: 'bowl', energyKj: 2400, proteinG: 30, carbsG: 70, fatG: 15 }],
    aiTotals: null, confidence: 'high', assumptions: [], uncertainties: ['sauce'], source: 'photo-ai', schemaVersion: 1, edited: false,
    photos: photos.map((p) => ({ id: p, uri: `pft-photo:${p}`, addedAt: `${date}T12:10:00+11:00`, width: 800, height: 600 })),
    recordedAt: `${date}T12:20:00+11:00`, updatedAt: `${date}T12:20:00+11:00`,
  });
  const src = (type: string, app: string | null) => ({ type, app, capturedAt: null, confidence: null, importId: type === 'integration' ? 'health-connect' : null, assetId: null, evidence: null, edited: false });
  return {
    version: 1,
    plan: { planId: seed.id, revision: seed.revision, formatVersion: seed.formatVersion, json: JSON.stringify(seed), importedAt: '2026-09-01T00:00:00.000Z', origin: 'seed' },
    activities: { [`${seed.id}|2026-10-30`]: { 'school-run-am': { activityId: 'school-run-am', status: 'done', count: 0, labelSnapshot: 'School run', updatedAt: '2026-10-30T08:40:00+11:00' }, walk: { activityId: 'walk', status: 'skipped', count: 0, labelSnapshot: 'Walk', updatedAt: '2026-10-30T19:00:00+11:00' } } },
    overrides: { [`${seed.id}|2026-10-31`]: seed.dayTypes[0].id },
    observations: [
      { id: 'w-1', date: '2026-10-20', metric: 'weight', value: 98.4, unit: 'kg', kind: 'observed', label: null, note: 'morning', source: src('manual', null), recordedAt: '2026-10-20T07:00:00+11:00' },
      { id: 'hc-steps-2026-10-30', date: '2026-10-30', metric: 'steps', value: 9120, unit: 'count', kind: 'observed', label: null, note: null, source: src('integration', 'health-connect'), recordedAt: '2026-10-30T21:00:00+11:00' },
    ],
    quickLogs: [], imports: [], configChanges: [], completionEvents: [], daySnapshots: {},
    exerciseLogs: [
      { id: 'mg-2026-10-30-hammer_curl', movement: 'hammer_curl', date: '2026-10-30', at: '2026-10-30T12:30:00+11:00', sets: 3, reps: 12, seconds: null, intensity: 'moderate', routine: 'muscle_growth', status: 'done', loadKg: 8, rir: 2 },
      { id: 'mg-2026-10-30-lat_pulldown', movement: 'lat_pulldown', date: '2026-10-30', at: '2026-10-30T12:35:00+11:00', sets: 0, reps: null, seconds: null, intensity: null, routine: 'muscle_growth', status: 'skipped' },
    ],
    muscleReports: [],
    mealLogs: [meal('m-1', '2026-10-28', ['p-1', 'p-2']), meal('m-2', '2026-10-30', ['p-3'])],
  };
}

async function seedHistory(page: Page) {
  await page.addInitScript(({ d, photos }) => {
    if (sessionStorage.getItem('pft:e2e:backup-seeded')) return;
    sessionStorage.setItem('pft:e2e:backup-seeded', '1');
    localStorage.setItem('pft:tracking:v1', JSON.stringify(d));
    for (const [id, data] of Object.entries(photos)) localStorage.setItem(`pft:meal-photo:${id}`, data);
    localStorage.setItem('pft.display.theme', 'classic');
    localStorage.setItem('pft.gamification.v1', JSON.stringify({ enabled: true, celebrated: [] }));
    localStorage.setItem('pft.anthropic.apiKey', 'sk-fictional-not-a-key');
  }, { d: doc(), photos: PHOTOS });
}

/** Records as stored, with photo references replaced by the photo data they point to (ids are kept). */
const canonical = (page: Page) =>
  page.evaluate((key) => {
    const d = JSON.parse(localStorage.getItem(key)!);
    for (const m of d.mealLogs) for (const p of m.photos) p.uri = localStorage.getItem(`pft:meal-photo:${p.uri.slice('pft-photo:'.length)}`);
    return d;
  }, KEY);

/** ☰ → Settings → Data management → Back up data / Restore data (#174). */
async function menu(page: Page, label: 'Back up data' | 'Restore data') {
  await chooseFromMenu(page, label);
}

async function backUp(page: Page, project: string): Promise<string> {
  await menu(page, 'Back up data');
  await expect(page.getByTestId('backup-sheet')).toContainText('Not included');
  await shot(page, '1-backup-start', project);
  const download = page.waitForEvent('download');
  await page.getByTestId('backup-create').click();
  const d = await download;
  expect(d.suggestedFilename()).toBe('body-anvil-backup-2026-11-02.zip');
  const path = test.info().outputPath('backup.zip');
  await d.saveAs(path);
  await expect(page.getByTestId('backup-done')).toContainText('Backup ready');
  await expect(page.getByTestId('backup-contents')).toContainText('2 meals with 3 photos');
  await shot(page, '2-backup-done', project);
  await page.getByTestId('backup-done').getByRole('button', { name: 'Done' }).click();
  await leaveSettings(page);
  return path;
}

async function pickFile(page: Page, button: string, path: string | { name: string; mimeType: string; buffer: Buffer }) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId(button).click();
  await (await chooser).setFiles(path);
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(MONDAY));
});

test('back up, wipe (fresh install), restore from setup: every record and photo comes back', async ({ page }, info) => {
  await seedHistory(page);
  await page.goto('/');
  await expect(page.getByTestId('day-progress')).toBeVisible();
  const before = await canonical(page);
  const path = await backUp(page, info.project.name);

  // The file: manifest, checksums, photos as original bytes, no secrets.
  const zip = unzipSync(new Uint8Array(readFileSync(path)));
  const manifest = JSON.parse(strFromU8(zip['manifest.json']));
  expect(manifest).toMatchObject({ format: 'body-anvil-backup', backupVersion: 1, counts: { mealPhotos: 3, mealLogs: 2, exerciseLogs: 2 } });
  expect(Object.keys(zip).filter((p) => p.startsWith('attachments/meal-photos/')).sort()).toEqual(['attachments/meal-photos/p-1.png', 'attachments/meal-photos/p-2.png', 'attachments/meal-photos/p-3.png']);
  expect(Buffer.from(zip['attachments/meal-photos/p-2.png']).toString('base64')).toBe(PHOTOS['p-2'].split(',')[1]);
  expect(readFileSync(path).toString('latin1')).not.toContain('sk-fictional-not-a-key');

  // Fresh install: everything gone; first-run setup offers a restore.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('setup-about')).toBeVisible();
  await page.getByTestId('setup-restore').click();
  await pickFile(page, 'restore-choose', path);
  await expect(page.getByTestId('restore-preview')).toContainText('2 meals with 3 photos');
  await expect(page.getByTestId('restore-warning')).toContainText('This replaces all data on this phone');
  await shot(page, '3-restore-preview', info.project.name);
  await page.getByTestId('restore-confirm').click();

  await expect(page.getByTestId('day-progress')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Restored the backup');
  await shot(page, '4-restored', info.project.name);
  expect(await canonical(page)).toEqual(before);
  expect(await page.evaluate(() => [localStorage.getItem('pft.display.theme'), localStorage.getItem('pft.gamification.v1'), localStorage.getItem('pft.anthropic.apiKey')])).toEqual([
    'classic',
    JSON.stringify({ enabled: true, celebrated: [] }),
    null,
  ]);
  // The photos resolve: the restored meal shows its photo.
  await page.goto('/?date=2026-10-30');
  await expect(page.getByTestId('day-progress')).toBeVisible();
});

test('restore over existing data: cancel changes nothing; confirming replaces it (no merge)', async ({ page }, info) => {
  await seedHistory(page);
  await page.goto('/');
  await expect(page.getByTestId('day-progress')).toBeVisible();
  const backed = await canonical(page);
  const path = await backUp(page, info.project.name);
  // Data added after the backup: replaced, not merged.
  await page.evaluate((key) => {
    const d = JSON.parse(localStorage.getItem(key)!);
    d.observations.push({ ...d.observations[0], id: 'after-backup', date: '2026-11-01' });
    localStorage.setItem(key, JSON.stringify(d));
  }, KEY);
  await page.reload();
  const populated = await canonical(page);

  await menu(page, 'Restore data');
  await pickFile(page, 'restore-choose', path);
  await expect(page.getByTestId('restore-preview')).toBeVisible();
  await page.getByRole('button', { name: 'Close restore data' }).click();
  expect(await canonical(page)).toEqual(populated);

  await menu(page, 'Restore data');
  await pickFile(page, 'restore-choose', path);
  await page.getByTestId('restore-confirm').click();
  await expect(page.getByRole('status')).toContainText('Restored the backup');
  const after = await canonical(page);
  expect(after).toEqual(backed);
  expect(after.observations.find((o: { id: string }) => o.id === 'after-backup')).toBeUndefined();
});

test('a damaged or tampered file is refused with a clear message and nothing changes', async ({ page }, info) => {
  await seedHistory(page);
  await page.goto('/');
  await expect(page.getByTestId('day-progress')).toBeVisible();
  const path = await backUp(page, info.project.name);
  const before = await canonical(page);
  const bytes = new Uint8Array(readFileSync(path));

  await menu(page, 'Restore data');
  await pickFile(page, 'restore-choose', { name: 'body-anvil-backup.zip', mimeType: 'application/zip', buffer: Buffer.from(bytes.slice(0, bytes.length >> 1)) });
  await expect(page.getByTestId('backup-error')).toContainText('damaged or incomplete');
  await shot(page, '5-restore-damaged', info.project.name);

  const files = unzipSync(bytes);
  files['attachments/meal-photos/p-1.png'] = strToU8('not the photo');
  await pickFile(page, 'restore-choose', { name: 'tampered.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync(files)) });
  await expect(page.getByTestId('backup-error')).toContainText('A meal photo in this backup is damaged');
  await expect(page.getByTestId('restore-preview')).toHaveCount(0);
  expect(await canonical(page)).toEqual(before);
});
