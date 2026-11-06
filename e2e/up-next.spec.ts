import { expect, test, type Page } from '@playwright/test';

/**
 * #51: "Do this next" is time-aware. Before anything is due, Today shows a compact "Up next" card;
 * the full card (meal, Done) appears only once the item is due. Friday 6 Nov is an office day: lunch at 12:00.
 */

const FRI = (hhmm: string) => new Date(`2026-11-06T${hhmm}:00+11:00`);
const upNext = (page: Page) => page.getByTestId('up-next');
const card = (page: Page) => page.getByTestId('next-action');

/** A running clock (timers fire), unlike openAt's fixed time: the card must update by itself. */
async function openRunningAt(page: Page, hhmm: string) {
  await page.clock.install({ time: FRI(hhmm) });
  await page.goto('/');
  await expect(page.getByTestId('day-progress')).toBeVisible();
}

/** Leave the app and come back (web AppState follows document visibility). */
async function resume(page: Page) {
  await page.evaluate(() => {
    const set = (v: string) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => v === 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    set('hidden');
    set('visible');
  });
}

test('07:30: lunch is hours away, so there is no card at all and no placeholder (#41)', async ({ page }) => {
  await openRunningAt(page, '07:30');
  await expect(upNext(page)).toHaveCount(0);
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByText(/Nothing left|Nothing planned/)).toHaveCount(0);
  await expect(page.getByTestId('activity-lunch')).toBeVisible(); // the checklist is unchanged
});

test('10:45: within an hour of lunch becoming due, a compact "Up next" card, no meal and no Done; Weight stays on the first screen', async ({ page }) => {
  await openRunningAt(page, '10:45');
  await expect(upNext(page)).toBeVisible();
  await expect(page.getByTestId('up-next-when')).toHaveText(/Up next · 12:00\s?pm/i);
  await expect(page.getByTestId('up-next-title')).toHaveText('Fixed lunch');
  await expect(page.getByTestId('up-next-countdown')).toHaveText(/^In 1 h 15 min/);
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByTestId('next-action-meal-ingredients')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Done: Fixed lunch' })).toHaveCount(0);

  const box = (await upNext(page).boundingBox())!;
  expect(box.height, 'compact').toBeLessThanOrEqual(110);
  const weight = (await page.getByTestId('measurement-weight').boundingBox())!;
  expect(weight.y + weight.height, 'Weight fully visible without scrolling').toBeLessThanOrEqual(page.viewportSize()!.height);
});

test('Details on "Up next" opens the item: lunch can be completed early, on purpose', async ({ page }) => {
  await openRunningAt(page, '11:00');
  await page.getByRole('button', { name: 'Up next details: Fixed lunch' }).click();
  await expect(page.getByTestId('meal-details')).toBeVisible();
  await expect(page.getByTestId('day-progress')).toHaveText('0 of 5 done'); // opening completes nothing
  await page.getByTestId('modal-dismiss').click();
  // The list row's circle completes it too (deliberate, as before).
  await page.getByTestId('activity-lunch').getByRole('checkbox').click();
  await expect(page.getByTestId('day-progress')).toHaveText('1 of 5 done');
  await expect(page.getByTestId('up-next-title')).toHaveText('Lunch walk'); // the next item, still only a preview
});

test('updates with the clock: due at 11:45 (15 min before), "Now" at 12:00, moves on after Done', async ({ page }) => {
  await openRunningAt(page, '11:40');
  await expect(page.getByTestId('up-next-countdown')).toHaveText(/^In 20 min/);
  await page.clock.runFor('05:00');
  await expect(card(page)).toBeVisible();
  await expect(upNext(page)).toHaveCount(0);
  await expect(page.getByTestId('next-action-when')).toHaveText(/^In 15 min · 12:00/i);
  await expect(page.getByTestId('next-action-meal-ingredients')).toContainText('Rolled oats');
  await page.clock.runFor('15:00');
  await expect(page.getByTestId('next-action-when')).toHaveText(/^Now · 12:00/i);
  await page.getByRole('button', { name: 'Done: Fixed lunch' }).click();
  await expect(page.getByTestId('day-progress')).toHaveText('1 of 5 done');
  await expect(page.getByTestId('next-action-title')).toHaveText('Lunch walk'); // 12:30 exercise: due from 12:00
});

test('reopening the app recomputes: no card at 07:30 becomes the due lunch at 11:50', async ({ page }) => {
  await openRunningAt(page, '07:30');
  await expect(page.getByTestId('day-progress')).toBeVisible();
  await expect(upNext(page)).toHaveCount(0);
  await page.clock.setSystemTime(FRI('11:50')); // time jumps while the app is in the background
  await resume(page);
  await expect(page.getByTestId('next-action-title')).toHaveText('Fixed lunch');
  await expect(page.getByTestId('next-action-when')).toHaveText(/^In 10 min · 12:00/i);
});

test('the day rolls over at midnight while the app stays open', async ({ page }) => {
  await openRunningAt(page, '23:58');
  await expect(page.getByText('Fri, 6 Nov')).toBeVisible();
  await page.clock.runFor('03:00');
  await expect(page.getByText('Sat, 7 Nov')).toBeVisible();
  await expect(page.getByTestId('day-progress')).toBeVisible();
});

test.describe('visual', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'baselines are kept for the phone viewport only'));
  test('up-next at 10:45 and the due card at 11:45', async ({ page }) => {
    await page.clock.setFixedTime(FRI('10:45')); // within the 60 min preview horizon (#41)
    await page.goto('/');
    await expect(upNext(page)).toBeVisible();
    await expect(page).toHaveScreenshot('up-next-friday-1045.png');
    await page.clock.setFixedTime(FRI('11:45'));
    await page.reload();
    await expect(card(page)).toBeVisible();
    await expect(page).toHaveScreenshot('up-next-friday-1145.png');
  });
});
