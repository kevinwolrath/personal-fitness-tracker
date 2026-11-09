import { expect, test, type Page } from '@playwright/test';
import { presetApiKey, stubClaude } from './claudeStub';
import { HISTORY_DAY, MONDAY, expandToFullDay, exportAllData, historyObservations, importScreenshots, openAt, row, seedRecords, vrBoxing } from './helpers';

/** Issue #6: one continuous Daily Log; Today is just the current date. */

const title = (page: Page) => page.getByRole('heading').first();
const dateButton = (page: Page) => page.getByTestId('date-button');

async function jumpTo(page: Page, date: string) {
  await dateButton(page).click();
  await page.getByLabel('Choose a date').fill(date);
}

test('stepping back walks through the log with relative titles', async ({ page }) => {
  await openAt(page, MONDAY); // Mon 2 Nov 2026
  await expect(title(page)).toHaveText('Today');
  await expect(page.getByRole('button', { name: 'Back to Today' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(title(page)).toHaveText('Yesterday');
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(title(page)).toHaveText('Saturday');
  await expect(page.getByRole('button', { name: /Day type: Weekend/ })).toBeVisible(); // same view, resolved for that date
  await expect(page.getByRole('button', { name: 'Back to Today' })).toBeVisible();

  await page.getByRole('button', { name: 'Back to Today' }).click();
  await expect(title(page)).toHaveText('Today');
});

test('jump straight to a date months back, then return to Today', async ({ page }) => {
  await openAt(page, MONDAY);
  await jumpTo(page, '2026-03-11'); // a Wednesday: home day with resistance
  await expect(title(page)).toHaveText('11 March');
  await expect(dateButton(page)).toContainText('Wed, 11 Mar');
  await expect(page.getByRole('button', { name: /Day type: Home day/ })).toBeVisible();
  await expect(page.getByTestId('today-workout')).toContainText('Strength workout · plan'); // on Today's workout (#56)
  expect(new URL(page.url()).searchParams.get('date')).toBe('2026-03-11');

  // The date survives a reload (it lives in the URL).
  await page.reload();
  await expect(title(page)).toHaveText('11 March');

  // Previous year shows the year.
  await jumpTo(page, '2025-12-25');
  await expect(title(page)).toHaveText('25 December 2025');

  await page.getByRole('button', { name: 'Back to Today' }).click();
  await expect(title(page)).toHaveText('Today');
  expect(new URL(page.url()).searchParams.get('date')).toBeNull();
});

test('shortcuts include the first entry in the log', async ({ page }) => {
  await openAt(page, MONDAY);
  await jumpTo(page, '2026-01-20');
  await row(page, 'lunch').getByRole('checkbox').click(); // oldest record
  await page.getByRole('button', { name: 'Back to Today' }).click();

  await dateButton(page).click();
  await page.getByRole('button', { name: /First entry/ }).click();
  await expect(title(page)).toHaveText('20 January');
  await expect(row(page, 'lunch').getByRole('checkbox')).toBeChecked();

  await dateButton(page).click();
  await page.getByRole('button', { name: 'Yesterday' }).click();
  await expect(title(page)).toHaveText('Yesterday');
});

test('a historical day is fully correctable and stays corrected', async ({ page }) => {
  await openAt(page, MONDAY);
  await jumpTo(page, '2026-09-14');

  await vrBoxing(page).click();
  await vrBoxing(page).click();
  await page.getByTestId('measurement-weight').click();
  await page.getByTestId('measure-input').fill('101.4');
  await page.getByRole('button', { name: 'Save' }).click();

  await page.getByRole('button', { name: 'Back to Today' }).click();
  // Today's weight tile shows the most recent earlier value, from that historical entry.
  await expect(page.getByTestId('measurement-weight')).toContainText('101.4 kg');

  await page.reload();
  await jumpTo(page, '2026-09-14');
  await expect(vrBoxing(page)).toHaveAttribute('aria-valuetext', /2 of 3/);
  await expect(page.getByTestId('measurement-weight')).toContainText('101.4 kg');

  // Correct the weight: newest entry for the day wins.
  await page.getByTestId('measurement-weight').click();
  await page.getByTestId('measure-input').fill('100.9');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('measurement-weight')).toContainText('100.9 kg');
});

test('future days are view-only', async ({ page }) => {
  await openAt(page, MONDAY);
  await jumpTo(page, '2026-12-01');
  await expect(page.getByText('Upcoming.')).toBeVisible();
  await expect(row(page, 'lunch').getByRole('checkbox')).toBeDisabled();
});

test('imported observations land on their effective date and can be corrected there', async ({ page }) => {
  await presetApiKey(page);
  await stubClaude(page);
  await openAt(page, MONDAY);

  // Imported from Today, but the screen is for Tue 27 Oct.
  await importScreenshots(page, ['e2e/fixtures/fitbit-last-week.png']);
  await page.getByRole('button', { name: 'Read 1 screenshot' }).click();
  await page.getByRole('button', { name: 'Save 3 values' }).click();

  await expect(title(page)).toHaveText('Today');
  await expect(page.getByTestId('recorded')).toHaveCount(0); // nothing for today

  await jumpTo(page, '2026-10-27');
  const recorded = page.getByTestId('recorded');
  await expect(recorded).toContainText('Steps');
  await expect(recorded).toContainText('9,120');
  await expect(recorded).toContainText('Readiness');
  await expect(recorded).toContainText('Weights');
  await expect(recorded).toContainText('35 min');
  await expect(recorded).toContainText('Fitbit screenshot');

  // Correct an imported value on that day; provenance records the edit.
  await page.getByTestId('recorded-steps').click();
  await expect(page.getByText('“9,120”')).toBeVisible();
  await page.getByTestId('observation-input').fill('9210');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('recorded-steps')).toContainText('9,210');
  await expect(page.getByTestId('recorded-steps')).toContainText('edited');

  // Remove one.
  await page.getByTestId('recorded-readiness_score').click();
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByTestId('recorded-readiness_score')).toHaveCount(0);

  // The same canonical store feeds the export.
  const doc = await exportAllData(page);
  const steps = doc.observations.find((o: any) => o.metric === 'steps');
  expect(steps).toMatchObject({ date: '2026-10-27', value: 9210, source: { app: 'fitbit', edited: true } });
  expect(doc.observations.some((o: any) => o.metric === 'readiness_score')).toBe(false);
  expect(doc.range.from).toBe('2026-10-27');
});

test('activity history the plan no longer schedules stays visible on its day', async ({ page }) => {
  await openAt(page, MONDAY);
  await row(page, 'school-run-am').getByRole('checkbox').click(); // home-day activity
  await page.getByRole('button', { name: /Day type: Home day/ }).click();
  await page.getByRole('radio', { name: 'Office day' }).click(); // the day turns out to be an office day
  await expect(page.getByTestId('activity-school-run-am')).toHaveCount(0);
  await expect(page.getByTestId('history-school-run-am')).toContainText('School run');
  await expect(page.getByTestId('history-school-run-am')).toContainText('Done');
});

test.describe('visual', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'baselines are kept for the phone viewport only'));
  test('history-day', async ({ page }) => {
    await seedRecords(page, {
      observations: historyObservations,
      activities: { [`weight-loss-v1|${HISTORY_DAY}`]: { 'vr-boxing': { activityId: 'vr-boxing', status: 'done', count: 3, labelSnapshot: 'VR boxing', updatedAt: 't' } } },
    });
    await openAt(page, MONDAY);
    await page.goto(`/?date=${HISTORY_DAY}`);
    await expect(page.getByTestId('recorded')).toBeVisible();
    await expandToFullDay(page);
    await expect(page).toHaveScreenshot('history-day-full.png');
  });
  test('jump-sheet', async ({ page }) => {
    await seedRecords(page, { observations: historyObservations });
    await openAt(page, MONDAY);
    await page.getByTestId('date-button').click();
    await expect(page.getByRole('button', { name: /First entry/ })).toBeVisible();
    await expect(page).toHaveScreenshot('jump-sheet.png');
  });
});
