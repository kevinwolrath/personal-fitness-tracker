import { expect, test } from '@playwright/test';
import generic from '../fixtures/plans/generic-example.plan.json';
import { MONDAY, SATURDAY, THURSDAY, expandToFullDay, openAt, renderedActivityIds, row, seedPlan, vrBoxing } from './helpers';

test.describe('seed plan resolves from JSON', () => {
  test('fresh install starts on Monday with the seed plan', async ({ page }) => {
    await openAt(page, MONDAY);
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Day type: Home day/ })).toBeVisible();
    // Grouped by part of day (contract 08); within a part, by window start then plan order.
    expect(await renderedActivityIds(page)).toEqual([
      'school-run-am', // morning
      'lunch', 'dog-walk', // midday
      'snack', 'school-run-pm', // afternoon (the snack's afternoon window opens at 14:00, the 15:15 run at 14:45)
      'dinner', // evening, after the conditioning requirement
      'resistance', // anytime
    ]);
    await expect(page.getByTestId('requirement-hard-conditioning')).toContainText('High-intensity conditioning');
    for (const part of ['Morning', 'Midday', 'Afternoon', 'Evening', 'Anytime today']) {
      await expect(page.getByRole('heading', { name: part, exact: true })).toBeVisible();
    }
    await expect(page.getByTestId('day-progress')).toHaveText('0 of 7 done');
    await expect(page.getByTestId('targets')).toContainText('Energy ≤ 7,530 kJ');
    await expect(page.getByTestId('targets')).toContainText('Protein 160–180 g');
    await expect(page.getByTestId('measurement-weight')).toBeVisible();
    await expect(page.getByTestId('measurement-waist')).toHaveCount(0);
  });

  test('Thursday renders the office day', async ({ page }) => {
    await openAt(page, THURSDAY);
    await expect(page.getByRole('button', { name: /Day type: Office day/ })).toBeVisible();
    expect(await renderedActivityIds(page)).toEqual(['lunch', 'lunch-walk', 'snack', 'dinner']);
    await expect(page.getByTestId('requirement-hard-conditioning')).toBeVisible();
    await expect(page.getByTestId('day-progress')).toHaveText('0 of 5 done');
  });

  test('Saturday renders the weekend', async ({ page }) => {
    await openAt(page, SATURDAY);
    await expect(page.getByRole('button', { name: /Day type: Weekend/ })).toBeVisible();
    expect(await renderedActivityIds(page)).toEqual(['lunch', 'snack', 'dinner', 'resistance-long', 'weekend-movement']);
    await expect(page.getByTestId('requirement-hard-conditioning')).toBeVisible();
    await expect(page.getByTestId('day-progress')).toHaveText('0 of 5 done');
  });
});

test('happy path persists across reload', async ({ page }) => {
  await openAt(page, MONDAY);

  // Complete a check activity with one tap.
  const lunch = row(page, 'lunch').getByRole('checkbox');
  await lunch.click();
  await expect(lunch).toBeChecked();

  // Advance a count activity to its target.
  const boxing = vrBoxing(page);
  for (let i = 0; i < 3; i++) await boxing.click();
  await expect(boxing).toHaveAttribute('aria-valuetext', /3 of 3 rounds/);

  // Skip via the details sheet.
  await row(page, 'resistance').getByRole('button', { name: 'Strength workout details' }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(row(page, 'resistance')).toContainText('Skipped');

  // Log a measurement.
  await page.getByTestId('measurement-weight').click();
  await page.getByTestId('measure-input').fill('97.8');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('measurement-weight')).toContainText('97.8 kg');
  await expect(page.getByTestId('measurement-weight')).toContainText('19.8 kg to go');

  // 7 required, resistance skipped → 6; lunch + boxing done.
  await expect(page.getByTestId('day-progress')).toHaveText('2 of 6 done');

  await page.reload();
  await expect(page.getByTestId('day-progress')).toHaveText('2 of 6 done');
  await expect(row(page, 'lunch').getByRole('checkbox')).toBeChecked();
  await expect(vrBoxing(page)).toHaveAttribute('aria-valuetext', /3 of 3/);
  await expect(row(page, 'resistance')).toContainText('Skipped');
  await expect(page.getByTestId('measurement-weight')).toContainText('97.8 kg');
});

test('undo: tapping a done row again, restoring a skip', async ({ page }) => {
  await openAt(page, MONDAY);
  const lunch = row(page, 'lunch').getByRole('checkbox');
  await lunch.click();
  await lunch.click();
  await expect(lunch).not.toBeChecked();

  await row(page, 'dog-walk').getByRole('button', { name: 'Dog walk details' }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, 'dog-walk')).not.toContainText('Skipped');
});

test('day-type override re-resolves the day and persists', async ({ page }) => {
  await openAt(page, THURSDAY);
  await page.getByRole('button', { name: /Day type: Office day/ }).click();
  await page.getByRole('radio', { name: 'Home day' }).click();
  expect(await renderedActivityIds(page)).toContain('school-run-am');
  await page.reload();
  await expect(page.getByRole('button', { name: /Day type: Home day/ })).toBeVisible();
  expect(await renderedActivityIds(page)).not.toContain('lunch-walk');
});

test('history can be corrected; future days are view-only', async ({ page }) => {
  await openAt(page, MONDAY);
  await page.getByRole('button', { name: 'Previous day' }).click();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.getByRole('heading', { name: 'Saturday' })).toBeVisible();
  const lunch = row(page, 'lunch').getByRole('checkbox');
  await lunch.click();
  await expect(lunch).toBeChecked();

  await page.getByRole('button', { name: 'Back to Today' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(page.getByText('Upcoming.')).toBeVisible();
  await expect(row(page, 'lunch').getByRole('checkbox')).toBeDisabled();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tomorrow' })).toBeVisible(); // reload keeps the viewed date
  await page.getByRole('button', { name: 'Back to Today' }).click();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(row(page, 'lunch').getByRole('checkbox')).toBeChecked();
});

test('flexible-meal budget renders from plan data (generic fixture)', async ({ page }) => {
  await seedPlan(page, generic);
  await openAt(page, MONDAY);
  await expect(row(page, 'dinner')).toContainText('≈ 2,900 kJ left · ≈ 10 g protein to go');
  expect(await renderedActivityIds(page)).toEqual([
    'morning-walk', 'breakfast', 'lunch', 'snack', 'dinner', 'lunch-walk', 'strength', 'evening-stretch',
  ]);
});

test.describe('phone layout rules (contract 05)', () => {
  for (const [name, time] of [['Monday', MONDAY], ['Thursday', THURSDAY], ['Saturday', SATURDAY]] as const) {
    test(`${name}: no horizontal overflow and touch targets ≥ 44 px`, async ({ page }) => {
      await openAt(page, time);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const small = await page.evaluate(() =>
        [...document.querySelectorAll('[role="button"],[role="checkbox"],[role="radio"],button')]
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && (r.width < 44 || r.height < 44))
          .map(({ el, r }) => `${el.getAttribute('aria-label')} ${Math.round(r.width)}×${Math.round(r.height)}`),
      );
      expect(small).toEqual([]);
    });
  }
});

test.describe('visual', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'baselines are kept for the phone viewport only'));
  for (const [name, time] of [['monday', MONDAY], ['thursday', THURSDAY], ['saturday', SATURDAY]] as const) {
    test(`today-${name}`, async ({ page }) => {
      await openAt(page, time);
      await expect(page).toHaveScreenshot(`today-${name}-first-screen.png`);
      await expandToFullDay(page);
      await expect(page).toHaveScreenshot(`today-${name}-full.png`);
    });
  }
  test('today-monday-in-progress', async ({ page }) => {
    await openAt(page, MONDAY);
    await row(page, 'school-run-am').getByRole('checkbox').click();
    await row(page, 'lunch').getByRole('checkbox').click();
    await vrBoxing(page).click();
    await page.getByTestId('measurement-weight').click();
    await page.getByTestId('measure-input').fill('97.8');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByTestId('day-scroll').evaluate((el) => el.scrollTo(0, 0));
    await expandToFullDay(page);
    await expect(page).toHaveScreenshot('today-monday-in-progress-full.png');
  });
  test('measure-sheet', async ({ page }) => {
    await openAt(page, MONDAY);
    await page.getByTestId('measurement-weight').click();
    await page.getByTestId('measure-input').fill('97.8');
    await expect(page).toHaveScreenshot('measure-sheet.png');
  });
  test('generic-monday-budget', async ({ page }) => {
    await seedPlan(page, generic);
    await openAt(page, MONDAY);
    await expandToFullDay(page);
    await expect(page).toHaveScreenshot('generic-monday-full.png');
  });
});
