import { mkdirSync, readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { MONDAY, openAt, openWorkoutSheet, workoutSheet } from './helpers';

const before = process.env.PFT_SCROLL_BEFORE === '1';
// Do not let the runner mask the scrollbar regression we are testing.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });
async function indicatorsHidden(page: Page) {
  if (before) return;
  const visibleIndicators = await page.locator('html, body, body *').evaluateAll(elements => elements.filter(el => {
    const style = getComputedStyle(el);
    return /auto|scroll/.test(style.overflowX + style.overflowY) &&
      (style.scrollbarWidth !== 'none' || getComputedStyle(el, '::-webkit-scrollbar').display !== 'none');
  }).map(el => el.getAttribute('data-testid') ?? el.tagName));
  expect(visibleIndicators).toEqual([]);
}
async function bottom(scroller: Locator) {
  await scroller.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => scroller.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(2);
}
async function shot(page: Page, name: string) {
  if (page.viewportSize()!.width !== 390 && !name.includes('workout')) return;
  const dir = 'docs/design/scroll-indicators/screenshots';
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/${before ? 'before' : 'after'}-${page.viewportSize()!.width}-${name}.png` });
}

test('long workout list hides indicators while wheel and keyboard can reach the bottom and Close stays fixed', async ({ page }) => {
  await openAt(page, MONDAY);
  await openWorkoutSheet(page);
  const scroll = workoutSheet(page);
  await indicatorsHidden(page);
  await expect.poll(() => scroll.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await shot(page, 'workout-top');
  const header = page.getByRole('button', { name: "Close today's workout", exact: true });
  const top = (await header.boundingBox())!.y;
  await scroll.hover();
  await page.mouse.wheel(0, 1800);
  await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await scroll.evaluate(el => { el.scrollTop = 0; });
  await scroll.focus();
  await page.keyboard.press('End');
  await expect.poll(() => scroll.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(2);
  await scroll.evaluate(el => { el.scrollTop = 0; });
  const bounds = (await scroll.boundingBox())!;
  const session = await page.context().newCDPSession(page);
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height - 40;
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 6; step++) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - step * 40 }] });
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
  await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await bottom(scroll);
  await expect(scroll.getByRole('button', { name: /full or short, skip and more/ }).last()).toBeInViewport();
  expect((await header.boundingBox())!.y).toBeCloseTo(top, 0);
  await shot(page, 'workout-bottom');
  await header.click();
  await expect(scroll).toHaveCount(0);
});

test('all routes, long sheets, nested guide pager and multiline web input follow the global rule', async ({ page }) => {
  await openAt(page, MONDAY);
  await indicatorsHidden(page);
  await shot(page, 'today');
  await bottom(page.getByTestId('day-scroll'));
  await page.getByRole('tab', { name: 'Progress' }).click();
  await expect(page.getByTestId('progress-scroll')).toBeVisible();
  await indicatorsHidden(page);
  await shot(page, 'progress');
  await page.getByRole('tab', { name: 'Today' }).click();
  for (const [menu, id] of [['settings', 'settings-sheet'], ['health-connect', 'health-connect-sheet'], ['coverage', 'coverage-sheet']]) {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByTestId(`menu-${menu}`).click();
    await expect(page.getByTestId(id)).toBeVisible();
    await indicatorsHidden(page);
    await bottom(page.getByTestId(id));
    await shot(page, menu);
    await page.locator('[role="dialog"]').last().getByTestId('modal-dismiss').click();
  }
  await openWorkoutSheet(page);
  await workoutSheet(page).getByRole('button', { name: 'Goblet squat. Show how', exact: true }).click();
  await indicatorsHidden(page);
  await page.getByRole('button', { name: 'Next step', exact: true }).click();
  await expect(page.getByTestId('guide-position')).toHaveText('2 / 2');
  await shot(page, 'guide');
  await page.getByRole('button', { name: 'Close guide', exact: true }).click();
  await page.getByRole('button', { name: "Close today's workout", exact: true }).click();
  for (const [route, id] of [['/import', 'import-scroll'], ['/configure', 'configure-scroll'], ['/setup', 'setup-scroll']]) {
    await page.goto(route);
    await expect(page.getByTestId(id)).toBeVisible();
    await indicatorsHidden(page);
    await bottom(page.getByTestId(id));
    await shot(page, route.slice(1));
    if (route === '/configure') {
      const input = page.getByTestId('config-input');
      await input.fill(Array.from({ length: 80 }, (_, i) => `line ${i}`).join('\n'));
      await input.focus();
      await page.keyboard.press('Control+End');
      await expect.poll(() => input.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
      await indicatorsHidden(page);
      await input.fill(readFileSync('fixtures/config/real-world-exercise.update.json', 'utf8'));
      await page.getByRole('button', { name: 'Check update', exact: true }).click();
      await expect(page.getByTestId('config-actions')).toBeInViewport();
    }
  }
});

test.describe('desktop browser preview', () => {
  // Playwright hides browser scrollbars by default: remove that flag so this test
  // exercises the application policy rather than the test runner's launch policy.
  test.use({ isMobile: false, hasTouch: false });
  test('desktop browser scrollbars stay hidden too', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone', 'one desktop preview is sufficient');
    await page.setViewportSize({ width: 1280, height: 844 });
    await openAt(page, MONDAY);
    await openWorkoutSheet(page);
    if (before) {
      await expect(page.locator('#body-anvil-scroll-indicators')).toHaveCount(0);
      await expect(workoutSheet(page)).not.toHaveCSS('scrollbar-width', 'none');
    }
    await indicatorsHidden(page);
    await shot(page, 'desktop-workout-top');
    await bottom(workoutSheet(page));
    await expect(workoutSheet(page).getByRole('button', { name: /full or short, skip and more/ }).last()).toBeInViewport();
    await shot(page, 'desktop-workout-bottom');
  });
});
