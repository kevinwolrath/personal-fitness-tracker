import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import seed from '../plans/seed.plan.json';
import { MONDAY, seedPlan } from './helpers';

/**
 * #120 PoC: an update opened from a link (personalfitnesstracker://configure?v=1&update=…, on the web
 * /configure?v=1&update=…) is untrusted. It is checked and previewed like a paste, and applied only on confirm.
 */

const json = (name: string) => JSON.stringify(JSON.parse(readFileSync(`fixtures/config/${name}.update.json`, 'utf8')));
const linkPath = (update: string, v = '1') => `/configure?v=${v}&update=${encodeURIComponent(update)}`;
const storedPlan = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('pft:tracking:v1')!).plan);
const applyButton = (page: Page) => page.getByRole('button', { name: /^Apply \d+ changes?$/ });
const { exercise: _exercise, ...unconfigured } = seed as any;

async function openLink(page: Page, path: string) {
  await page.clock.setFixedTime(new Date(MONDAY));
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Configure with AI' })).toBeVisible();
}

test('a link opens the preview; nothing changes until Apply; opening it again has nothing to apply', async ({ page }) => {
  await seedPlan(page, unconfigured);
  await openLink(page, linkPath(json('real-world-exercise')));
  await expect(page.getByTestId('config-link-note')).toContainText('Opened from a link');
  await expect(page.getByTestId('config-preview')).toContainText('What changes');
  await expect(page.getByTestId('preview-exercise')).toBeVisible();
  const before = await storedPlan(page);
  expect(page.url()).not.toContain('update='); // read once, then cleared from the route
  await page.waitForTimeout(300);
  expect(await storedPlan(page)).toEqual(before); // never applied on arrival

  await applyButton(page).click();
  await expect(page.getByTestId('summary-exercise')).toContainText('Avoid biceps curl');
  const after = await storedPlan(page);
  expect(after.revision).toBe(before.revision + 1);

  // The same link again (repeat tap): previewed again, and there is nothing left to change.
  await openLink(page, linkPath(json('real-world-exercise')));
  await expect(page.getByRole('button', { name: 'Nothing to apply' })).toBeDisabled();
  expect((await storedPlan(page)).revision).toBe(after.revision);
});

test('a tampered link is rejected by the normal importer and changes nothing', async ({ page }) => {
  await openLink(page, linkPath(json('lunch').replace('"schemaVersion":1', '"schemaVersion":1,"admin":true')));
  await expect(page.getByTestId('config-errors')).toContainText("This update can't be used");
  await expect(page.getByTestId('config-preview')).toHaveCount(0);
  await expect(applyButton(page)).toHaveCount(0);
});

test('a cut-off link reports what was wrong; an unknown link version is refused with a way forward', async ({ page }) => {
  await openLink(page, linkPath(json('lunch').slice(0, 80)));
  await expect(page.getByTestId('config-errors')).toBeVisible();
  await expect(applyButton(page)).toHaveCount(0);

  await openLink(page, linkPath(json('lunch'), '9'));
  await expect(page.getByTestId('config-link-note')).toContainText('v=9');
  await expect(page.getByTestId('config-link-note')).toContainText('use Paste instead');
  await expect(page.getByTestId('config-preview')).toHaveCount(0);
});

test('fallback: copy the update, then the explicit Paste button reads the clipboard (no automatic reading)', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openLink(page, '/configure');
  await page.evaluate((t) => navigator.clipboard.writeText(`Here is your update:\n\n${t}`), json('lunch'));
  await expect(page.getByLabel('AI update')).toHaveValue(''); // nothing is read until Paste
  await page.getByRole('button', { name: 'Paste' }).click();
  await page.getByRole('button', { name: 'Check update' }).click();
  await expect(page.getByTestId('config-preview')).toBeVisible();
});
