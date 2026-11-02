import { expect, test, type Page } from '@playwright/test';
import { MONDAY, openAt, row } from './helpers';

/** Issue #30: plan-driven local reminders. The web surface uses an in-memory stand-in (window.__pftReminders). */

const scheduled = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__pftReminders.scheduled().map((r: any) => r.id as string));
const todayFor = (page: Page, activity: string) =>
  scheduled(page).then((ids) => ids.filter((id) => id.includes('|2026-11-02|') && id.includes(`|${activity}|`)));
const openReminders = async (page: Page) => {
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByTestId('app-menu').getByRole('button', { name: 'Reminders' }).click();
  await expect(page.getByTestId('reminders-sheet')).toBeVisible();
};

test('off by default; the menu says so; the sheet lists the plan’s reminders (no strength or VR boxing)', async ({ page }) => {
  await openAt(page, MONDAY);
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByTestId('menu-reminders')).toContainText('Off · reminders from your plan');
  await page.getByTestId('menu-reminders').click();
  const sheet = page.getByTestId('reminders-sheet');
  await expect(sheet).toContainText('Your plan reminds you about');
  await expect(page.getByTestId('reminder-lunch')).toContainText('11:55');
  await expect(page.getByTestId('reminder-snack')).toContainText('4:00');
  await expect(page.getByTestId('reminder-dinner')).toContainText('6:15');
  await expect(sheet).not.toContainText('Strength');
  await expect(sheet).not.toContainText('VR boxing');
  expect(await scheduled(page)).toEqual([]);
  expect(await page.evaluate(() => (window as any).__pftReminders.status())).toBe('undetermined'); // never asked on launch
});

test('turn on → the week is scheduled; completing lunch cancels it; off cancels all; on rebuilds; restart adds no duplicates', async ({ page }) => {
  await openAt(page, MONDAY); // 09:00
  await openReminders(page);
  await page.getByRole('button', { name: 'Turn on reminders' }).click();
  await expect(page.getByTestId('reminders-status')).toContainText('On · next: Fixed lunch at 11:55');
  await expect.poll(async () => (await scheduled(page)).length).toBe(21); // 3 meals × 7 days

  await page.getByTestId('modal-dismiss').click();
  await row(page, 'lunch').getByRole('checkbox').click();
  await expect.poll(async () => (await todayFor(page, 'lunch')).length).toBe(0);
  expect((await scheduled(page)).length).toBe(20);

  await page.reload();
  await expect(page.getByTestId('day-progress')).toBeVisible();
  await page.waitForTimeout(300);
  expect((await scheduled(page)).length).toBe(20); // no duplicates after restart

  await openReminders(page);
  await expect(page.getByTestId('reminder-lunch')).toContainText("won't remind");
  await page.getByTestId('reminders-switch').click(); // off
  await expect.poll(async () => (await scheduled(page)).length).toBe(0);
  await page.getByRole('button', { name: 'Turn on reminders' }).click();
  await expect.poll(async () => (await scheduled(page)).length).toBe(20);
});

test('a plan change through Configure with AI reschedules; the on/off choice is untouched', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openAt(page, MONDAY);
  await openReminders(page);
  await page.getByRole('button', { name: 'Turn on reminders' }).click();
  await expect.poll(async () => (await scheduled(page)).length).toBe(21);
  await page.getByTestId('modal-dismiss').click();

  const seed = JSON.parse(require('node:fs').readFileSync('plans/seed.plan.json', 'utf8'));
  const snack = { ...seed.activities.find((a: any) => a.id === 'snack'), notifications: [{ at: '15:30', title: 'Snack', body: 'Snack time' }] };
  const { chooseFromMenu } = await import('./helpers');
  await chooseFromMenu(page, 'Configure with AI');
  await page.getByLabel('AI update').fill(JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, nutrition: { meals: { merge: [snack] } } } }));
  await page.getByRole('button', { name: 'Check update' }).click();
  await page.getByRole('button', { name: /^Apply \d+ changes?$/ }).click();
  await page.getByRole('button', { name: 'Close' }).click();

  await expect.poll(async () => (await todayFor(page, 'snack')).length).toBe(1);
  const snackToday = await page.evaluate(() => (window as any).__pftReminders.scheduled().find((r: any) => r.date === '2026-11-02' && r.activityId === 'snack'));
  expect(snackToday).toMatchObject({ minute: 15 * 60 + 30, body: 'Snack time' });
  expect((await scheduled(page)).length).toBe(21); // replaced, not added
  await openReminders(page);
  await expect(page.getByTestId('reminders-status')).toContainText('On ·'); // still on: a plan change never toggles it
});

test('denied permission: the app carries on and shows the block; no repeated asking', async ({ page }) => {
  await page.addInitScript(() => ((window as any).__pftDenyNotifications = true));
  await openAt(page, MONDAY);
  await openReminders(page);
  await page.getByRole('button', { name: 'Turn on reminders' }).click();
  await expect(page.getByTestId('reminders-blocked')).toBeVisible();
  expect(await scheduled(page)).toEqual([]);
  await page.getByTestId('modal-dismiss').click();
  await row(page, 'lunch').getByRole('checkbox').click(); // the rest of the app works
  await expect(row(page, 'lunch').getByRole('checkbox')).toBeChecked();
});

test('tapping a reminder opens that day’s activity details', async ({ page }) => {
  await openAt(page, MONDAY);
  await openReminders(page);
  await page.getByRole('button', { name: 'Turn on reminders' }).click();
  await page.getByTestId('modal-dismiss').click();
  const id = (await scheduled(page)).find((x) => x.includes('|2026-11-04|') && x.includes('|dinner|'))!;
  await page.evaluate((i) => (window as any).__pftReminders.open(i), id);
  await expect(page.getByTestId('day-title')).toHaveText('Wednesday');
  await expect(page.getByTestId('modal-title')).toHaveText('Family dinner');
});

test.describe('visual', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'baselines are kept for the phone viewport only'));
  test('reminders sheet: off and on', async ({ page }) => {
    await openAt(page, MONDAY);
    await openReminders(page);
    await expect(page).toHaveScreenshot('reminders-off.png');
    await page.getByRole('button', { name: 'Turn on reminders' }).click();
    await expect(page.getByTestId('reminders-status')).toBeVisible();
    await expect(page).toHaveScreenshot('reminders-on.png');
  });
});
