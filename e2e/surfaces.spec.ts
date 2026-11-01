import { expect, test, type Locator, type Page } from '@playwright/test';
import { presetApiKey, stubClaude } from './claudeStub';
import { HISTORY_DAY, MONDAY, chooseFromMenu, historyObservations, importScreenshots, openAt, row, seedRecords } from './helpers';

/**
 * Issue #21: every modal screen and sheet uses the one header pattern (contract 02), and every surface
 * has at most one primary action (contract 01).
 */

test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'structure is width-independent; the sweep covers widths'));

/** The surface on top: the last open sheet/dialog, else the screen. */
const topSurface = (page: Page): Locator => page.locator('[role="dialog"]').last();

async function expectHeaderPattern(surface: Locator, dismiss: 'Cancel' | 'Close', confirm?: string) {
  const header = surface.getByTestId('modal-header').first();
  await expect(header).toBeVisible();
  const d = (await header.getByTestId('modal-dismiss').boundingBox())!;
  const t = (await header.getByTestId(/modal-title|guide-title/).boundingBox())!;
  const h = (await header.boundingBox())!;
  await expect(header.getByTestId('modal-dismiss')).toHaveText(dismiss);
  expect(d.x + d.width, 'dismiss is on the left').toBeLessThanOrEqual(t.x + 1);
  expect(Math.abs(t.x + t.width / 2 - (h.x + h.width / 2)), 'title is centred').toBeLessThanOrEqual(2);
  if (confirm) {
    const c = header.getByTestId('modal-confirm');
    await expect(c).toHaveText(confirm);
    expect((await c.boundingBox())!.x, 'confirm is on the right').toBeGreaterThanOrEqual(t.x + t.width - 1);
  } else {
    await expect(header.getByTestId('modal-confirm')).toHaveCount(0);
  }
}

async function expectOnePrimary(scope: Locator | Page, what: string) {
  const n = await scope.locator('[data-variant="primary"], [data-variant="inverse"]').evaluateAll(
    (els) => els.filter((el) => (el as HTMLElement).offsetParent !== null).length,
  );
  expect(n, `${what}: primary buttons`).toBeLessThanOrEqual(1);
}

test('sheets on the Daily Log share the header pattern and have one primary action', async ({ page }) => {
  await openAt(page, MONDAY);
  await expectOnePrimary(page.getByTestId('day-scroll'), 'Daily Log');

  const sheets: [string, () => Promise<void>, 'Cancel' | 'Close', string?][] = [
    ['app menu', () => page.getByRole('button', { name: 'Menu' }).click(), 'Close'],
    ['weight', () => page.getByTestId('measurement-weight').click(), 'Cancel', 'Save'],
    ['day type', () => page.getByRole('button', { name: /Day type:/ }).click(), 'Close'],
    ['go to date', () => page.getByTestId('date-button').click(), 'Close'],
    ['workout details', () => row(page, 'resistance').getByRole('button', { name: 'Strength workout details' }).click(), 'Close'],
  ];
  for (const [what, open, dismiss, confirm] of sheets) {
    await open();
    await expectHeaderPattern(topSurface(page), dismiss, confirm);
    await expectOnePrimary(topSurface(page), what);
    await topSurface(page).getByTestId('modal-dismiss').first().click();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  }
});

test('the exercise guide nests with the same header, and closing returns to its sheet', async ({ page }) => {
  await openAt(page, MONDAY);
  await row(page, 'resistance').getByRole('button', { name: 'Strength workout details' }).click();
  await page.getByTestId('sheet-session').getByRole('button', { name: /^Kettlebell squat/ }).click();
  await expectHeaderPattern(topSurface(page), 'Close');
  await topSurface(page).getByTestId('modal-dismiss').click();
  await expect(page.getByTestId('sheet-session')).toBeVisible();
});

test('a recorded observation: Cancel/Save on an editable day', async ({ page }) => {
  await seedRecords(page, { observations: historyObservations });
  await openAt(page, MONDAY);
  await page.goto(`/?date=${HISTORY_DAY}`);
  await page.getByTestId('recorded-steps').click();
  await expectHeaderPattern(topSurface(page), 'Cancel', 'Save');
  await expectOnePrimary(topSurface(page), 'observation');
});

test('modal screens: Import and Configure share the pattern and keep one primary action per state', async ({ page, context }) => {
  await presetApiKey(page);
  await stubClaude(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openAt(page, MONDAY);

  await importScreenshots(page, ['e2e/fixtures/scale.png']);
  const screen = page.locator('body');
  await expectHeaderPattern(screen, 'Cancel');
  await expectOnePrimary(screen, 'import, before reading');
  await page.getByRole('button', { name: 'Read 1 screenshot' }).click();
  await expect(page.getByTestId('review-scale.png')).toBeVisible();
  await expectOnePrimary(screen, 'import, reviewing');
  await page.getByRole('button', { name: 'Cancel' }).click();

  await chooseFromMenu(page, 'Configure with AI');
  await expectHeaderPattern(screen, 'Close');
  await expectOnePrimary(screen, 'configure, start');
  await page.getByLabel('AI update').fill(require('node:fs').readFileSync('fixtures/config/nutrition.update.json', 'utf8'));
  await expectHeaderPattern(screen, 'Cancel'); // a pasted update would be lost
  await expectOnePrimary(screen, 'configure, pasted');
  await page.getByRole('button', { name: 'Check update' }).click();
  await expect(page.getByTestId('config-preview')).toBeVisible();
  await expectOnePrimary(screen, 'configure, preview');
});
