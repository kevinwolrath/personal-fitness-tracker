import { expect, test, type Page } from '@playwright/test';
import { MONDAY, SATURDAY, THURSDAY, openAt } from './helpers';

/**
 * Responsive sweep (contract 05): every width from a small Android phone to a desktop browser.
 * Catches content pushed outside its container or clipped text, not just page-level scroll.
 */
const WIDTHS = [320, 340, 360, 375, 390, 412, 430, 500, 768, 1280];

test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone', 'the sweep sets its own viewports'));

async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
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
      // Anything outside the frame horizontally is cut off on a real phone.
      if (r.left < frame.left - 0.5 || r.right > frame.right + 0.5) {
        problems.push(`outside frame: "${describe(el)}" ${Math.round(r.left)}–${Math.round(r.right)} vs ${Math.round(frame.left)}–${Math.round(frame.right)}`);
      }
      // Text wider than its own box is clipped (unless deliberately truncated with an ellipsis).
      const isLeafText = el.childElementCount === 0 && (el.textContent ?? '').trim() !== '';
      if (isLeafText && el.scrollWidth > el.clientWidth + 1 && style.textOverflow !== 'ellipsis') {
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
