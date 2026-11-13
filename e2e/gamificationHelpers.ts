import { expect, type Page } from '@playwright/test';
import { journeyPlan } from '../fixtures/gamification/journey';
import { gameFrom } from '../src/gamification/model';
import type { StoreSnapshot } from '../src/storage/types';
import { leaveSettings, openPreferences } from './helpers';

/** Shared by the #73 journey assertions and the #121 visual replay: the same real UI, the same fixture. */
/** ☰ → Settings → App preferences, where the Quests switch lives (#174). */
export async function settings(page: Page) {
  await openPreferences(page);
}
/** Close the open sheet; with none open, back out of Settings to the main screen (#174). */
export async function close(page: Page) {
  const sheet = page.locator('[role="dialog"]').getByTestId('modal-dismiss');
  if (await sheet.count()) await sheet.last().click();
  else await leaveSettings(page);
}
/** Write a fixture checkpoint into isolated browser storage at a fixed synthetic date, then boot the app on it. */
export async function install(page: Page, s: StoreSnapshot, date: string) {
  await page.clock.setFixedTime(new Date(`${date}T12:30:00+10:00`));
  await page.evaluate(({ s, p }) => {
    const activities: Record<string, Record<string, unknown>> = {};
    for (const { planId, date, ...l } of s.activityLogs) (activities[`${planId}|${date}`] ??= {})[l.activityId] = l;
    localStorage.setItem('pft:tracking:v1', JSON.stringify({ version: 1, plan: { planId: p.id, revision: p.revision, formatVersion: p.formatVersion, json: JSON.stringify(p), origin: 'import', importedAt: new Date().toISOString() }, activities, overrides: {}, observations: s.observations, quickLogs: s.quickLogs, imports: s.imports, configChanges: s.configChanges, completionEvents: s.completionEvents, daySnapshots: {}, exerciseLogs: s.exerciseLogs, muscleReports: s.muscleReports, mealLogs: s.mealLogs }));
  }, { s, p: journeyPlan });
  await page.goto('/');
  await page.reload();
  await expect(page.getByTestId('day-progress')).toBeVisible();
}
/** The rendered level and XP must equal the pure projection of the same records. */
export async function expectXP(page: Page, s: StoreSnapshot, date: string) {
  const g = gameFrom(s, journeyPlan, date);
  await expect(page.getByTestId('game-level')).toHaveText(`Level ${g.level} · ${g.xp} XP`);
  return g;
}
export async function gallery(page: Page) {
  await page.getByTestId('open-achievements').click();
  await expect(page.getByTestId('achievement-gallery')).toBeVisible();
}
