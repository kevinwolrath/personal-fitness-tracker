import { equipmentCatalogue, setEquipmentSelection } from '../src/equipment/catalogue';
import seed from '../plans/seed.plan.json';
import { expect, test, type Page } from '@playwright/test';
import { HISTORY_DAY, MONDAY, SATURDAY, THURSDAY, historyObservations, chooseFromMenu, openAt, openWorkoutSheet, seedPlan, seedRecords, workoutSheet } from './helpers';

/**
 * Responsive sweep (contract 05): every width from a small Android phone to a desktop browser.
 * Catches content pushed outside its container or clipped text, not just page-level scroll.
 */
const WIDTHS = [320, 340, 360, 375, 390, 412, 430, 500, 768, 1280];

test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'the sweep sets its own viewports'));

async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const strict = new Set(['date-button', 'day-title']); // must never truncate, even with an ellipsis
    const frame = document.querySelector('[data-testid="phone-frame"]')!.getBoundingClientRect();
    const problems: string[] = [];
    const describe = (el: Element) =>
      (el.getAttribute('aria-label') || el.getAttribute('data-testid') || el.textContent || el.tagName).trim().slice(0, 40);

    if (document.documentElement.scrollWidth > window.innerWidth) problems.push(`page scrolls horizontally`);
    if (frame.width > 430.5) problems.push(`phone frame is ${frame.width}px wide`);

    for (const el of document.querySelectorAll('[data-testid="phone-frame"] *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.position === 'fixed') continue;
      // Anything outside the frame horizontally is cut off on a real phone. Pages of a horizontal
      // scroller (the exercise guide pager) are scrolled out of view, not cut off: the scroller itself is checked.
      const inScroller = (() => {
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          if (['auto', 'scroll'].includes(getComputedStyle(a).overflowX)) return true;
        }
        return false;
      })();
      if (!inScroller && (r.left < frame.left - 0.5 || r.right > frame.right + 0.5)) {
        problems.push(`outside frame: "${describe(el)}" ${Math.round(r.left)}–${Math.round(r.right)} vs ${Math.round(frame.left)}–${Math.round(frame.right)}`);
      }
      // Text wider than its own box is clipped (unless deliberately truncated with an ellipsis).
      const isLeafText = el.childElementCount === 0 && (el.textContent ?? '').trim() !== '';
      // Row times are strict too (#34): "12:00 P…" is never acceptable.
      const inStrict = [...strict].some((id) => el.closest(`[data-testid="${id}"]`)) || !!el.closest('[data-testid^="time-"]');
      if (isLeafText && el.scrollWidth > el.clientWidth + 1 && (style.textOverflow !== 'ellipsis' || inStrict)) {
        problems.push(`clipped text: "${describe(el)}" needs ${el.scrollWidth}px, has ${el.clientWidth}px`);
      }
      // Content spilling out of a parent that clips (overflow hidden), e.g. a card.
      const parent = el.parentElement;
      // Inside an <svg>, content beyond the viewBox is cropped by design (#81's muscle map crops its artwork this
      // way); the <svg> element itself is still checked against its parent.
      const inSvg = el.tagName.toLowerCase() !== 'svg' && !!el.closest('svg');
      if (parent && !inSvg && getComputedStyle(parent).overflowX === 'hidden') {
        const p = parent.getBoundingClientRect();
        if (r.right > p.right + 0.5 || r.left < p.left - 0.5) problems.push(`spills out of parent: "${describe(el)}"`);
      }
    }
    return [...new Set(problems)];
  });
}

for (const [day, time] of [['Monday', MONDAY], ['Thursday', THURSDAY], ['Saturday', SATURDAY]] as const) {
  test(`${day}: no clipped or overflowing content at any width`, async ({ page }) => {
    await openAt(page, time);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(50); // let layout settle
      expect(await layoutProblems(page), `at ${width}px`).toEqual([]);
    }
  });
}

test('weight logged with a long value still fits at the narrowest width', async ({ page }) => {
  await openAt(page, MONDAY);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.getByTestId('measurement-weight').click();
  await page.getByTestId('measure-input').fill('188.88');
  await page.getByRole('button', { name: 'Save' }).click();
  expect(await layoutProblems(page)).toEqual([]);
});

test('a full historical day (many sources, long labels, past-year date) fits at every width', async ({ page }) => {
  await seedRecords(page, { observations: historyObservations });
  await openAt(page, MONDAY);
  await page.goto(`/?date=${HISTORY_DAY}`);
  await expect(page.getByTestId('recorded')).toBeVisible();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(50);
    expect(await layoutProblems(page), `at ${width}px`).toEqual([]);
  }
});

test('the jump-to-date sheet fits at the narrowest width', async ({ page }) => {
  await seedRecords(page, { observations: historyObservations });
  await openAt(page, MONDAY);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.getByTestId('date-button').click();
  await expect(page.getByRole('button', { name: /First entry/ })).toBeVisible();
  expect(await layoutProblems(page)).toEqual([]);
});

test('the AI configuration screen (with a preview and errors) fits at every width', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openAt(page, MONDAY);
  await chooseFromMenu(page, 'Configure with AI');
  const combined = require('node:fs').readFileSync('fixtures/config/combined.update.json', 'utf8');
  await page.getByLabel('AI update').fill(combined);
  await page.getByRole('button', { name: 'Check update' }).click();
  await expect(page.getByTestId('config-preview')).toBeVisible();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(50);
    expect(await layoutProblems(page), `preview at ${width}px`).toEqual([]);
  }
  await page.getByTestId('preview-nutrition').getByRole('button').first().click(); // the longest lines, opened
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(50);
    expect(await layoutProblems(page), `open section at ${width}px`).toEqual([]);
  }
  await page.getByRole('button', { name: 'Change update' }).click();
  await page.getByLabel('AI update').fill('{"fitnessConfigUpdate":{"schemaVersion":1,"exercise":{"equipment":[{"type":"a_very_long_unknown_equipment_type_name"}]}}}');
  await page.getByRole('button', { name: 'Check update' }).click();
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await layoutProblems(page), 'errors at 320px').toEqual([]);
});

test('evening next-action card with alternatives and a part-done requirement fits at every width', async ({ page }) => {
  const done = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { activityId: id, status: 'done', count: 0, labelSnapshot: id, updatedAt: 't' }]));
  await seedRecords(page, {
    activities: {
      'weight-loss-v1|2026-11-02': {
        ...done(['school-run-am', 'lunch', 'school-run-pm', 'snack', 'dinner']),
        'vr-boxing': { activityId: 'vr-boxing', status: 'pending', count: 2, labelSnapshot: 'VR boxing', updatedAt: 't', requirementId: 'hard-conditioning' },
      },
    },
  });
  await openAt(page, '2026-11-02T20:00:00+11:00');
  await expect(page.getByTestId('next-action')).toBeVisible();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(50);
    expect(await layoutProblems(page), `at ${width}px`).toEqual([]);
  }
});

test('the exercise guide (long instructions, substitution note, caution) fits at every width', async ({ page }) => {
  await seedPlan(page, require('../fixtures/plans/prescription-example.plan.json'));
  await openAt(page, '2026-11-02T15:00:00+11:00');
  await openWorkoutSheet(page);
  for (const name of ['Hammer curls. Show how', 'Overhead press. Show how', 'Lat pulldown. Show how']) {
    await workoutSheet(page).getByRole('button', { name }).click();
    await expect(page.getByTestId('exercise-guide')).toBeVisible();
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(50);
      expect(await layoutProblems(page), `${name} at ${width}px`).toEqual([]);
    }
    await page.getByRole('button', { name: 'Close guide' }).click();
  }
});

test('the app menu and the export confirmation fit at every width', async ({ page }) => {
  await openAt(page, MONDAY);
  await page.getByRole('button', { name: 'Menu' }).click();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(50);
    expect(await layoutProblems(page), `menu at ${width}px`).toEqual([]);
  }
  await page.getByTestId('app-menu').getByRole('button', { name: 'Export all data' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(50);
    expect(await layoutProblems(page), `confirm at ${width}px`).toEqual([]);
  }
});

test('meal details (sheet and "Do this next" card) fit at every width', async ({ page }) => {
  await openAt(page, '2026-11-02T12:10:00+11:00'); // lunch is next
  await expect(page.getByTestId('next-action-meal')).toBeVisible();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(50);
    expect(await layoutProblems(page), `card at ${width}px`).toEqual([]);
  }
  await page.getByTestId('activity-lunch').getByRole('button', { name: 'Fixed lunch details' }).click();
  await expect(page.getByTestId('meal-details')).toBeVisible();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 700 });
    await page.waitForTimeout(50);
    expect(await layoutProblems(page), `sheet at ${width}px`).toEqual([]);
    // The sheet's actions stay reachable: the content scrolls inside the sheet.
    await page.getByTestId('item-sheet-scroll').evaluate((el) => (el as HTMLElement).scrollTo({ top: 10000, behavior: 'instant' }));
    await expect(page.getByRole('button', { name: 'Mark done' })).toBeInViewport();
    await page.getByTestId('item-sheet-scroll').evaluate((el) => (el as HTMLElement).scrollTo({ top: 0, behavior: 'instant' }));
  }
});

test('energy in both units (#39): the Daily Log, a recorded value and the Settings sheet fit at every width', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pft.display.energy', 'both'));
  await seedRecords(page, {
    observations: [
      {
        id: 'te', date: '2026-11-02', metric: 'total_energy', value: 13180, unit: 'kJ', kind: 'observed', label: null, note: null,
        recordedAt: '2026-11-02T08:00:00+11:00',
        source: { type: 'screenshot', app: 'samsung-health', capturedAt: null, confidence: 0.9, importId: 'imp', assetId: 'a', evidence: '3,150 cal', edited: false },
      },
    ],
  });
  await openAt(page, '2026-11-02T12:10:00+11:00'); // lunch is next: its energy line is on the card
  await expect(page.getByTestId('next-action-meal-nutrition')).toHaveText('≈ 1,780 kJ / 425 kcal · 42 g protein');
  await expect(page.getByTestId('recorded-total_energy')).toContainText('13,180 kJ / 3,150 kcal');
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 1400 });
    await page.waitForTimeout(50);
    expect(await layoutProblems(page), `day at ${width}px`).toEqual([]);
  }
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByTestId('menu-settings').click();
  await expect(page.getByTestId('settings-sheet')).toBeVisible();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 700 });
    await page.waitForTimeout(50);
    expect(await layoutProblems(page), `settings at ${width}px`).toEqual([]);
  }
});

test('Health Connect (#36): the sheet in every state and an imported day fit at every width', async ({ page }) => {
  const SH = 'com.sec.android.app.shealth';
  const fixture = {
    availability: 'available',
    grantOnRequest: ['steps', 'active_energy', 'exercise', 'weight', 'body_fat', 'sleep'],
    granted: [],
    data: {
      steps: [{ date: '2026-11-02', value: 18342, origins: [SH] }],
      activeKcal: [{ date: '2026-11-02', value: 3150, origins: [SH] }],
      exercise: [
        { id: 'e1', start: '2026-11-02T07:00:00+11:00', end: '2026-11-02T08:52:00+11:00', origin: 'com.example.very.long.package.name.tracker', title: 'Outdoor bike ride with the kids around the lake' },
        { id: 'e2', start: '2026-11-02T18:00:00+11:00', end: '2026-11-02T18:40:00+11:00', origin: SH, exerciseType: 70 },
      ],
      weight: [{ id: 'w', time: '2026-11-02T06:58:00+11:00', kg: 101.35, origin: 'com.garmin.android.apps.connectmobile' }],
      sleep: [{ id: 's', start: '2026-11-01T22:00:00+11:00', end: '2026-11-02T07:10:00+11:00', origin: SH }],
    },
  };
  await page.addInitScript((json) => localStorage.getItem('pft.test.healthConnect') || localStorage.setItem('pft.test.healthConnect', json), JSON.stringify(fixture));
  await page.addInitScript(() => localStorage.setItem('pft.display.energy', 'both'));
  await openAt(page, MONDAY);
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByTestId('menu-health-connect').click();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(50);
    expect(await layoutProblems(page), `connect sheet at ${width}px`).toEqual([]);
  }
  await page.getByRole('button', { name: 'Connect Health Connect' }).click();
  await expect(page.getByTestId('hc-today-exercise')).toContainText('2 workouts');
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(50);
    expect(await layoutProblems(page), `connected sheet at ${width}px`).toEqual([]);
  }
  // Six types and the notes are taller than a small phone: the sheet scrolls, so its actions stay reachable (#46).
  await page.setViewportSize({ width: 360, height: 640 });
  await page.waitForTimeout(100);
  const manage = page.getByRole('button', { name: 'Manage in Health Connect' });
  await manage.scrollIntoViewIfNeeded();
  expect(await page.getByTestId('health-connect-sheet').evaluate((el) => (el as HTMLElement).scrollTop)).toBeGreaterThan(0); // the sheet scrolled
  await expect(manage).toBeInViewport();
  await page.getByTestId('modal-dismiss').click();
  await expect(page.getByTestId('recorded-steps')).toContainText('18,342');
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 1600 });
    await page.waitForTimeout(50);
    expect(await layoutProblems(page), `day at ${width}px`).toEqual([]);
  }
});

test('times never truncate: uppercase AM/PM and a larger system text size, at every width (#34)', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'en-US', timezoneId: 'Australia/Melbourne', isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await openAt(page, MONDAY);
  await expect(page.getByTestId('time-lunch')).toHaveText('12:00 PM');
  // A larger system font (Android's font scale ≈ 1.3) on the time text.
  await page.addStyleTag({ content: '[data-testid^="time-"] { font-size: 18px !important; }' });
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(50);
    expect(await layoutProblems(page), `at ${width}px`).toEqual([]);
  }
  await context.close();
});

test.describe('first-run setup (#49)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('every setup step fits at every width, with 44 px touch targets', async ({ page }) => {
    await page.clock.setFixedTime(new Date(THURSDAY));
    await page.goto('/');
    const primary = page.getByTestId('setup-primary');
    const steps: [string, () => Promise<void>][] = [
      ['about', async () => {
        await page.getByTestId('gender-other').click();
        await page.getByTestId('age-60_plus').click();
        await page.getByTestId('weight-100_plus').click();
      }],
      ['goals', async () => {
        await page.getByRole('checkbox', { name: 'Faster weight loss' }).click();
        await page.getByRole('checkbox', { name: 'Improve cardio' }).click();
        await page.getByTestId('equipment-weights').click();
        await page.getByTestId('limit-knees').click();
        await page.getByTestId('diet-gluten_free').click();
      }],
      ['review', async () => {}],
      ['review', async () => page.getByTestId('tab-meals').click()],
      ['swap', async () => page.getByRole('button', { name: 'Swap breakfast' }).click()],
    ];
    for (const [step, answer] of steps) {
      await answer();
      await expect(page.getByTestId(`setup-${step}`)).toBeVisible();
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 800 });
        await page.waitForTimeout(50);
        expect(await layoutProblems(page), `${step} at ${width}px`).toEqual([]);
      }
      const small = await page.evaluate(() =>
        [...document.querySelectorAll('[role="button"], [role="radio"], [role="checkbox"], button')]
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && (r.width < 44 || r.height < 44))
          .map(({ el, r }) => `${el.getAttribute('aria-label') ?? el.textContent} ${Math.round(r.width)}×${Math.round(r.height)}`),
      );
      expect(small, `${step} touch targets`).toEqual([]);
      if (step === 'about' || step === 'goals') await primary.click();
    }
  });
});

test('Progress (#52) fits at every width, with the Edit charts sheet open too', async ({ page }) => {
  await seedRecords(page, {
    observations: Array.from({ length: 40 }, (_, i) => ({
      id: `w${i}`, date: `2026-10-${String((i % 30) + 1).padStart(2, '0')}`, metric: 'weight', value: 99 - i * 0.05, unit: 'kg', kind: 'observed', label: null, note: null,
      source: { type: 'manual', app: null, capturedAt: null, confidence: null, importId: null, assetId: null, evidence: null, edited: false }, recordedAt: '2026-10-01T07:00:00Z',
    })),
  });
  await openAt(page, MONDAY);
  await page.getByTestId('tab-bar').getByRole('tab', { name: 'Progress' }).click();
  await expect(page.getByTestId('chart-weight')).toBeVisible();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(300); // charts re-measure their width after a resize (onLayout)
    expect(await layoutProblems(page), `progress at ${width}px`).toEqual([]);
  }
  await page.getByTestId('edit-charts').click();
  await page.setViewportSize({ width: 320, height: 800 });
  await page.waitForTimeout(300);
  expect(await layoutProblems(page), 'edit charts at 320px').toEqual([]);
});

test('My Gym groups, search and image details fit every supported width (#158)', async ({ page }) => {
  test.setTimeout(90_000);
  await seedPlan(page, { ...seed, formatVersion: 9, exercise: { ...seed.exercise, equipment: setEquipmentSelection([], equipmentCatalogue.items.map(item => item.id), true) } });
  await openAt(page, MONDAY);
  await chooseFromMenu(page, 'My Gym');
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByTestId('gym-search').fill('dumbbells');
    expect(await layoutProblems(page), `My Gym at ${width}`).toEqual([]);
    await page.getByRole('button', { name: 'Details for Adjustable dumbbells', exact: true }).click();
    await expect(page.getByTestId('gym-detail')).toBeVisible();
    expect(await layoutProblems(page), `My Gym details at ${width}`).toEqual([]);
    await page.getByRole('button', { name: 'Back to My Gym', exact: true }).click();
  }
});

test('Recommended Resistance Training (#157) collapsed and expanded rows fit every supported width', async ({ page }) => {
  await seedPlan(page, { ...seed, exercise: { ...seed.exercise, equipment: [{ type: 'dumbbells' }, { type: 'resistance_bands' }] } });
  await seedRecords(page, { exerciseLogs: [
    { id: 'old', movement: 'hammer_curl', date: '2026-10-20', at: '2026-10-20T09:00:00+11:00', sets: 2, reps: 10, seconds: null, intensity: null },
    { id: 'recent', movement: 'standing_calf_raise', date: '2026-10-29', at: '2026-10-29T09:00:00+11:00', sets: 2, reps: 15, seconds: null, intensity: null },
  ] });
  await openAt(page, THURSDAY);
  const card = page.getByTestId('recommended-resistance');
  await expect(card.getByTestId('recommended-muscle')).toBeVisible();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 844 });
    await card.scrollIntoViewIfNeeded();
    expect(await layoutProblems(page), `recommendation collapsed at ${width}`).toEqual([]);
    await card.getByRole('button', { name: 'Recommended Resistance Training', exact: true }).click();
    await expect(card.getByTestId('recommended-exercises')).toBeVisible();
    expect(await layoutProblems(page), `recommendation expanded at ${width}`).toEqual([]);
    await card.locator('[data-testid^="recommendation-row-"]').last().getByRole('button', { name: /^Log optional/ }).scrollIntoViewIfNeeded();
    await card.getByRole('button', { name: 'Recommended Resistance Training', exact: true }).click();
  }
});
