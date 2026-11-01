import { expect, test, type Page } from '@playwright/test';
import { HISTORY_DAY, MONDAY, SATURDAY, THURSDAY, historyObservations, chooseFromMenu, openAt, seedPlan, seedRecords } from './helpers';

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
      const inStrict = [...strict].some((id) => el.closest(`[data-testid="${id}"]`));
      if (isLeafText && el.scrollWidth > el.clientWidth + 1 && (style.textOverflow !== 'ellipsis' || inStrict)) {
        problems.push(`clipped text: "${describe(el)}" needs ${el.scrollWidth}px, has ${el.clientWidth}px`);
      }
      // Content spilling out of a parent that clips (overflow hidden), e.g. a card.
      const parent = el.parentElement;
      if (parent && getComputedStyle(parent).overflowX === 'hidden') {
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
  for (const name of [/^Hammer curl/, /^Overhead press/, /^Lat pulldown/]) {
    await page.getByTestId('next-action-session').getByRole('button', { name }).click();
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
