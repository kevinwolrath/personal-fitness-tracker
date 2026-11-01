import { expect, type Page } from '@playwright/test';

/** Frozen local times (Australia/Melbourne, AEDT +11:00). */
export const MONDAY = '2026-11-02T09:00:00+11:00';
export const THURSDAY = '2026-11-05T09:00:00+11:00';
export const SATURDAY = '2026-11-07T09:00:00+11:00';

export async function openAt(page: Page, isoTime: string) {
  await page.clock.setFixedTime(new Date(isoTime));
  await page.goto('/');
  await expect(page.getByTestId('day-progress')).toBeVisible();
}

/** Activity ids rendered in a section, in order (from data-testid="activity-<id>"). */
export async function renderedActivityIds(page: Page): Promise<string[]> {
  const ids = await page.locator('[data-testid^="activity-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!));
  return ids.map((id) => id.replace('activity-', ''));
}

export const row = (page: Page, id: string) => page.getByTestId(`activity-${id}`);

/** Seed a different plan by writing the web store document before the app boots (only on first load). */
export async function seedPlan(page: Page, plan: unknown) {
  await page.addInitScript((json) => {
    const key = 'pft:tracking:v1';
    if (localStorage.getItem(key)) return;
    const p = JSON.parse(json);
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        plan: { planId: p.id, revision: p.revision, formatVersion: p.formatVersion, json, importedAt: new Date().toISOString() },
        activities: {},
        overrides: {},
        measurements: [],
        quickLogs: [],
      }),
    );
  }, JSON.stringify(plan));
}

/** Grow the viewport to the scroll content so one screenshot shows the whole day. */
export async function expandToFullDay(page: Page) {
  const height = await page.getByTestId('today-scroll').evaluate((el) => {
    const scroller = el as HTMLElement;
    return Math.ceil(window.innerHeight - scroller.clientHeight + scroller.scrollHeight);
  });
  await page.setViewportSize({ width: page.viewportSize()!.width, height });
}
