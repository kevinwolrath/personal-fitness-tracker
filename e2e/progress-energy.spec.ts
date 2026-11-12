import { expect, test, type Page } from '@playwright/test';
import seed from '../plans/seed.plan.json';
import { MONDAY, openAt, row, seedPlan } from './helpers';

/**
 * Progress energy audit: with Health Connect connected, steps AND active energy are imported. Energy burned
 * appears as an estimate (resting + active) once height and age are known, the balance uses finished days with a
 * logged meal, and ticking a planned meal on Today counts it as eaten at the plan's estimate (#154).
 */

const SAMSUNG = 'com.sec.android.app.shealth';
const days = ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'];
const fixture = {
  availability: 'available', grantOnRequest: ['steps', 'active_energy', 'exercise', 'weight', 'body_fat', 'sleep'], granted: [],
  data: {
    steps: days.map((date) => ({ date, value: 8000, origins: [SAMSUNG] })),
    activeKcal: days.map((date) => ({ date, value: 450, origins: [SAMSUNG] })),
    weight: [{ id: 'w1', time: '2026-10-30T07:00:00+11:00', kg: 95.5, origin: SAMSUNG }],
  },
};

async function connectAndOpenProgress(page: Page) {
  await page.addInitScript((json) => localStorage.getItem('pft.test.healthConnect') || localStorage.setItem('pft.test.healthConnect', json), JSON.stringify(fixture));
  await openAt(page, MONDAY);
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByTestId('menu-health-connect').click();
  await page.getByRole('button', { name: 'Connect Health Connect' }).click();
  await expect(page.getByTestId('hc-sync-status')).toContainText('Last synced today');
  await page.getByTestId('modal-dismiss').click();
  await page.goto('/progress');
  await expect(page.getByTestId('progress-summary')).toBeVisible();
}

test('with height and age: imported active energy shows as estimated burned; no eaten until a meal is logged', async ({ page }) => {
  await seedPlan(page, { ...seed, profile: { ...((seed as any).profile ?? {}), heightCm: 182, age: 44, gender: 'male' } });
  await connectAndOpenProgress(page);
  const energy = page.getByTestId('chart-energy');
  await energy.scrollIntoViewIfNeeded();
  await expect(energy).toContainText('Burned (estimate: resting + active)');
  await expect(energy).toContainText('— eaten');
  await expect(energy).toContainText('Nothing eaten is recorded yet: tick meals you ate on Today');
  await expect(page.getByTestId('chart-energy-balance-empty')).toContainText('Needs what you ate');

  // A meal actually eaten on a finished day: the balance appears.
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('pft:tracking:v1')!);
    d.mealLogs = [{ id: 'm1', date: '2026-10-31', at: '2026-10-31T12:00:00+11:00', planId: null, activityId: null, replacedLabel: null, name: 'Protein shake', items: [{ name: 'Protein shake', quantity: 1, unit: 'glass', energyKj: 1000, proteinG: 30, carbsG: null, fatG: null }], aiTotals: null, confidence: null, assumptions: [], uncertainties: [], source: 'manual', schemaVersion: null, edited: false, photos: [], recordedAt: '2026-10-31T12:05:00+11:00', updatedAt: '2026-10-31T12:05:00+11:00' }];
    localStorage.setItem('pft:tracking:v1', JSON.stringify(d));
  });
  await page.reload();
  await expect(page.getByTestId('chart-energy-balance')).not.toContainText('Needs');
  await expect(page.getByTestId('chart-protein')).toContainText('30 g a day');
  if (test.info().project.name === 'phone') {
    await page.getByTestId('chart-energy').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'docs/design/progress-energy/energy-charts.png' });
  }
});

test('without height or age: says what to add, never shows active energy as total burned', async ({ page }) => {
  await seedPlan(page, { ...seed, profile: undefined });
  await connectAndOpenProgress(page);
  const energy = page.getByTestId('chart-energy');
  await energy.scrollIntoViewIfNeeded();
  await expect(page.getByTestId('chart-energy-empty')).toContainText("can't be estimated without your");
  await expect(page.getByTestId('chart-energy-empty')).toContainText('Edit setup answers');
  if (test.info().project.name === 'phone') await page.screenshot({ path: 'docs/design/progress-energy/energy-missing-profile.png' });
});

test('#154: ticking lunch on Today counts it as eaten on Today and Progress; unticking takes it back', async ({ page }) => {
  await seedPlan(page, seed);
  await openAt(page, MONDAY);
  await expect(page.getByTestId('eaten')).toHaveCount(0);
  const lunch = row(page, 'lunch').getByRole('checkbox');
  await lunch.click();
  await expect(page.getByTestId('eaten')).toContainText('Eaten ≈ 1,780 kJ · 42 g protein');
  await expect(page.getByTestId('eaten')).toContainText('from 1 ticked meal at plan estimates');
  await page.goto('/progress');
  const protein = page.getByTestId('chart-protein');
  await protein.scrollIntoViewIfNeeded();
  await expect(protein).toContainText('42 g');
  await expect(protein).not.toContainText('Protein appears here');

  await page.goto('/');
  await row(page, 'lunch').getByRole('checkbox').click(); // untick
  await expect(page.getByTestId('eaten')).toHaveCount(0);
  await page.goto('/progress');
  await expect(page.getByTestId('chart-protein')).toContainText('Protein appears here when you tick meals you ate on Today');
});
