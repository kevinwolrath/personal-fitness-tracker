import { expect, test, type Page } from '@playwright/test';
import { FakeHealthServer } from '../src/healthSync/__tests__/fakeServer';
import { MONDAY, openAt, seedRecords } from './helpers';

/** #134: Health data sync against a fake of the documented backend (no real server, fictional data). */

const BASE = 'https://health.example.test';
const src = { type: 'manual', app: null, capturedAt: null, confidence: null, importId: null, assetId: null, evidence: null, edited: false };
const weigh = (date: string, value: number) => ({ id: `w-${date}`, date, metric: 'weight', value, unit: 'kg', kind: 'observed', label: null, note: null, source: src, recordedAt: `${date}T07:00:00Z` });

async function route(page: Page, server: FakeHealthServer) {
  await page.route(`${BASE}/**`, async (r) => {
    const req = r.request();
    try {
      const res = await server.fetch(req.url(), { method: req.method(), headers: await req.allHeaders().then((h) => ({ ...h, Authorization: h.authorization ?? '', ...(h['x-enrollment-key'] ? { 'X-Enrollment-Key': h['x-enrollment-key'] } : {}) })), body: req.postData() ?? undefined });
      await r.fulfill({ status: res.status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: await res.text() });
    } catch {
      await r.abort('failed');
    }
  });
}
async function open(page: Page) {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByTestId('menu-health-sync').click();
  await expect(page.getByTestId('health-sync-sheet')).toBeVisible();
}

test('sync my data: set the address, confirm what is sent, link, then upload again; nothing local changes', async ({ page }) => {
  const server = new FakeHealthServer();
  await route(page, server);
  await seedRecords(page, { observations: [weigh('2026-10-30', 92.4), weigh('2026-11-01', 92.1)] });
  await openAt(page, MONDAY);
  // The data ID is made at startup; wait for it so the comparison below covers sync alone.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('pft:tracking:v1') ?? '')).toContain('healthSync.userId');
  const before = await page.evaluate(() => localStorage.getItem('pft:tracking:v1'));
  await open(page);
  await expect(page.getByTestId('health-sync-prepare')).toBeDisabled();
  await page.getByTestId('health-sync-url').fill('http://not-secure.example');
  await page.getByTestId('health-sync-url-save').click();
  await expect(page.getByTestId('health-sync-error')).toContainText('https://');
  await page.getByTestId('health-sync-url').fill(`${BASE}/`);
  await page.getByTestId('health-sync-url-save').click();
  await expect(page.getByTestId('health-sync-notice')).toHaveText('Server address saved');
  // #136: the enrollment key is typed once, masked, and never shown again.
  await expect(page.getByTestId('enrollment-key-input')).toHaveAttribute('type', 'password');
  await page.getByTestId('enrollment-key-input').fill(server.enrollmentKey);
  await page.getByTestId('enrollment-key-save').click();
  await expect(page.getByTestId('enrollment-key')).toContainText('Saved on this phone.');
  await expect(page.getByTestId('enrollment-key-input')).toHaveCount(0);
  expect(await page.getByTestId('health-sync-sheet').innerText()).not.toContain(server.enrollmentKey);

  await page.getByTestId('health-sync-prepare').click();
  await expect(page.getByTestId('health-sync-contents')).toContainText('2026-10-30 to 2026-11-01');
  await page.screenshot({ path: 'docs/design/issue-134/sync-confirm.png', fullPage: true });
  await expect(page.getByTestId('health-sync-confirm')).toContainText('Not sent: Your display name');
  expect(server.requests).toHaveLength(0); // nothing sent before the tap
  await page.getByTestId('health-sync-upload').click();
  await expect(page.getByTestId('health-sync-notice')).toHaveText('Linked and uploaded');
  await expect(page.getByTestId('health-sync-status')).toContainText('This phone is linked.');
  expect(server.users.size).toBe(1);

  await page.getByTestId('health-sync-prepare').click();
  await page.getByTestId('health-sync-upload').click();
  await expect(page.getByTestId('health-sync-notice')).toHaveText('Uploaded');
  const put = server.requests.find((q) => q.method === 'PUT')!;
  const token = [...server.users.values()][0].token;
  expect(put.url).not.toContain(token);
  expect(put.body).not.toContain(token);

  await page.getByTestId('health-sync-view').click();
  await expect(page.getByTestId('health-sync-remote')).toContainText('2026-10-30 to 2026-11-01');
  expect(await page.evaluate(() => localStorage.getItem('pft:tracking:v1'))).toBe(before);
  // The owner token is never part of a backup's preferences or the tracking data.
  expect(before).not.toContain(token);
});

test('share my details: choose scope, preview exactly what is shared, create, copy and revoke a read-only link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const server = new FakeHealthServer();
  await route(page, server);
  await page.addInitScript(([b, k]) => { localStorage.setItem('pft.healthSync.url', b); localStorage.setItem('pft.healthSync.enrollmentKey', k); }, [BASE, server.enrollmentKey]);
  await seedRecords(page, { observations: [weigh('2026-08-01', 95), weigh('2026-10-30', 92.4), weigh('2026-11-01', 92.1)] });
  await openAt(page, MONDAY);
  await open(page);
  await page.getByTestId('health-sync-prepare').click();
  await page.getByTestId('health-sync-upload').click();
  await expect(page.getByTestId('health-sync-notice')).toHaveText('Linked and uploaded');

  await page.getByTestId('health-sync-share').click();
  await page.getByRole('radio', { name: '7 days' }).click();
  for (const c of ['activity', 'sleep', 'nutrition', 'training']) await page.getByTestId(`share-category-${c}`).click();
  await page.getByTestId('share-preview').click();
  await expect(page.getByTestId('share-contents')).toContainText('2026-10-30 to 2026-11-01');
  await expect(page.getByTestId('share-contents')).toContainText('Body measurements');
  await page.getByRole('button', { name: 'Show the data' }).click();
  await expect(page.getByTestId('share-json')).not.toContainText('2026-08-01');
  await page.getByTestId('share-create').click();
  await expect(page.getByTestId('share-link')).toContainText(`${BASE}/s/`);
  const shared = server.shares[0];
  expect(shared.scope).toEqual({ days: 7, categories: ['body'] });
  expect(JSON.stringify(shared.document)).not.toContain('2026-08-01');
  await page.getByTestId('share-copy').click();
  await expect(page.getByTestId('health-sync-notice')).toContainText('Copied the link');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('Read the JSON at this link');
  expect(clip).toContain(`${BASE}/s/${shared.token}`);
  expect(clip).not.toContain([...server.users.values()][0].token);
  await page.screenshot({ path: 'docs/design/issue-134/share-link.png', fullPage: true });

  await page.getByRole('button', { name: 'Revoke now' }).click();
  await expect(page.getByTestId('health-sync-notice')).toHaveText('Link revoked');
  expect(shared.revokedAt).not.toBeNull();
  await expect(page.getByTestId('share-links')).toContainText('revoked');
});

test('offline: the error is shown and nothing is marked as synced', async ({ page }) => {
  const server = new FakeHealthServer();
  await route(page, server);
  await page.addInitScript(([b, k]) => { localStorage.setItem('pft.healthSync.url', b); localStorage.setItem('pft.healthSync.enrollmentKey', k); }, [BASE, server.enrollmentKey]);
  await openAt(page, MONDAY);
  await open(page);
  server.offline = true;
  await page.getByTestId('health-sync-prepare').click();
  await page.getByTestId('health-sync-upload').click();
  await expect(page.getByTestId('health-sync-error')).toContainText('Couldn’t reach the server');
  await expect(page.getByTestId('health-sync-status')).toContainText('Not synced yet');
  await page.screenshot({ path: 'docs/design/issue-134/sync-error.png', fullPage: true });
});

test('#136 enrollment key: asked for before the first sync; a wrong key is explained and fixed without losing anything', async ({ page }) => {
  const server = new FakeHealthServer();
  await route(page, server);
  await page.addInitScript((b) => localStorage.setItem('pft.healthSync.url', b), BASE);
  await seedRecords(page, { observations: [weigh('2026-11-01', 92.1)] });
  await openAt(page, MONDAY);
  await open(page);
  await page.getByTestId('health-sync-prepare').click();
  await expect(page.getByTestId('health-sync-error')).toContainText('Enter the enrollment key before your first sync');
  expect(server.requests).toHaveLength(0);

  await page.getByTestId('enrollment-key-input').fill('wrong-placeholder');
  await page.getByTestId('enrollment-key-save').click();
  await page.getByTestId('health-sync-prepare').click();
  await page.getByTestId('health-sync-upload').click();
  await expect(page.getByTestId('health-sync-error')).toContainText('didn’t accept the enrollment key');
  await expect(page.getByTestId('enrollment-key-input')).toBeVisible(); // offered to edit
  const pending = await page.evaluate(() => localStorage.getItem('pft.healthSync.pending'));
  expect(pending).toBeTruthy();
  await page.screenshot({ path: 'docs/design/issue-136/wrong-key.png', fullPage: true });

  await page.getByTestId('enrollment-key-input').fill(server.enrollmentKey);
  await page.getByTestId('enrollment-key-save').click();
  await page.getByTestId('health-sync-prepare').click();
  await page.getByTestId('health-sync-upload').click();
  await expect(page.getByTestId('health-sync-notice')).toHaveText('Linked and uploaded');
  const enrolls = server.requests.filter((q) => q.url.endsWith('/enroll'));
  expect(new Set(enrolls.map((q) => JSON.parse(q.body!).enrollmentSecret)).size).toBe(1); // same retry secret
  expect(server.users.size).toBe(1);

  // Linked: the key can be removed; syncing still works without it, and it was only ever sent on enroll.
  await expect(page.getByTestId('enrollment-key')).toContainText('This phone is linked');
  await page.screenshot({ path: 'docs/design/issue-136/linked-remove-key.png', fullPage: true });
  await page.getByTestId('enrollment-key-remove').click();
  await expect(page.getByTestId('health-sync-notice')).toHaveText('Enrollment key removed from this phone');
  expect(await page.evaluate(() => localStorage.getItem('pft.healthSync.enrollmentKey'))).toBeNull();
  await page.getByTestId('health-sync-prepare').click();
  await page.getByTestId('health-sync-upload').click();
  await expect(page.getByTestId('health-sync-notice')).toHaveText('Uploaded');
  for (const q of server.requests.filter((q) => !q.url.endsWith('/enroll'))) expect(q.headers['X-Enrollment-Key']).toBeUndefined();
  const tracking = await page.evaluate(() => localStorage.getItem('pft:tracking:v1'));
  expect(tracking).not.toContain(server.enrollmentKey);
});
