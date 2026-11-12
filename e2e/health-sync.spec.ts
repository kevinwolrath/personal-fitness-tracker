import { expect, test, type Page } from '@playwright/test';
import { FakeHealthServer } from '../src/healthSync/__tests__/fakeServer';
import { MONDAY, openAt, seedRecords } from './helpers';

/** #134, #163: Health data sync against a strict fake of the deployed Worker's contract (no real server, fictional data). */

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

test('sync my data: confirm what is sent, link, then upload again; nothing local changes', async ({ page }) => {
  const server = new FakeHealthServer();
  await route(page, server);
  await seedRecords(page, { observations: [weigh('2026-10-30', 92.4), weigh('2026-11-01', 92.1)] });
  await openAt(page, MONDAY);
  // The data ID is made at startup; wait for it so the comparison below covers sync alone.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('pft:tracking:v1') ?? '')).toContain('healthSync.userId');
  const before = await page.evaluate(() => localStorage.getItem('pft:tracking:v1'));
  await open(page);
  // #146: the server address comes from the build (E2E_API_URL); there is no address field.
  await expect(page.getByTestId('health-sync-url')).toHaveCount(0);
  await expect(page.getByLabel('Server address')).toHaveCount(0);
  // #136: no key entry anywhere; the key comes from the build.
  await expect(page.getByTestId('enrollment-key-input')).toHaveCount(0);
  await expect(page.getByTestId('health-sync-link-state')).toHaveText('Your first sync links this phone to the server.');

  await page.getByTestId('health-sync-prepare').click();
  // The snapshot covers through today (plan targets are dated today).
  await expect(page.getByTestId('health-sync-contents')).toContainText('2026-10-30 to 2026-11-02');
  await page.screenshot({ path: 'docs/design/issue-134/sync-confirm.png', fullPage: true });
  await expect(page.getByTestId('health-sync-confirm')).toContainText('Not sent: Your name');
  expect(server.requests).toHaveLength(0); // nothing sent before the tap
  await page.getByTestId('health-sync-upload').click();
  await expect(page.getByTestId('health-sync-notice')).toHaveText('Linked and uploaded');
  await expect(page.getByTestId('health-sync-status')).toContainText('This phone is linked.');
  expect(server.users.size).toBe(1);

  await page.getByTestId('health-sync-prepare').click();
  await page.getByTestId('health-sync-upload').click();
  await expect(page.getByTestId('health-sync-notice')).toHaveText('Uploaded');
  const put = server.requests.find((q) => q.method === 'PUT')!;
  const token = [...server.users.values()][0].ownerToken;
  expect(put.url).not.toContain(token);
  expect(put.body).not.toContain(token);

  await page.getByTestId('health-sync-view').click();
  await expect(page.getByTestId('health-sync-remote')).toContainText('2026-10-30 to 2026-11-02');
  expect(await page.evaluate(() => localStorage.getItem('pft:tracking:v1'))).toBe(before);
  // The owner token is never part of a backup's preferences or the tracking data.
  expect(before).not.toContain(token);
});

test('share my details: choose scope, preview exactly what is shared, create, copy and revoke a read-only link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const server = new FakeHealthServer();
  await route(page, server);
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
  await expect(page.getByTestId('share-link')).toContainText(`${BASE}/api/body-anvil/v1/shared/`);
  const shared = server.shares[0];
  expect(shared.scope).toEqual({ range: 7, categories: ['measurements'], format: 'records', expiresIn: 86400 });
  const read = await (await server.fetch(`${BASE}/api/body-anvil/v1/shared/${shared.token}`, { method: 'GET', headers: {} })).text();
  expect(read).toContain('2026-10-30');
  expect(read).not.toContain('2026-08-01');
  await page.getByTestId('share-copy').click();
  await expect(page.getByTestId('health-sync-notice')).toContainText('Copied the link');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('Read the JSON at this link');
  expect(clip).toContain(`${BASE}/api/body-anvil/v1/shared/${shared.token}`);
  expect(clip).not.toContain([...server.users.values()][0].ownerToken);
  await page.screenshot({ path: 'docs/design/issue-134/share-link.png', fullPage: true });

  await page.getByRole('button', { name: 'Revoke now' }).click();
  await expect(page.getByTestId('health-sync-notice')).toHaveText('Link revoked');
  expect(shared.revoked).toBe(true);
  await expect(page.getByTestId('share-links')).toHaveCount(0);
});

test('offline: the error is shown and nothing is marked as synced', async ({ page }) => {
  const server = new FakeHealthServer();
  await route(page, server);
  await openAt(page, MONDAY);
  await open(page);
  server.offline = true;
  await page.getByTestId('health-sync-prepare').click();
  await page.getByTestId('health-sync-upload').click();
  await expect(page.getByTestId('health-sync-error')).toContainText('Couldn’t reach the server');
  await expect(page.getByTestId('health-sync-status')).toContainText('Not synced yet');
  await page.screenshot({ path: 'docs/design/issue-134/sync-error.png', fullPage: true });
});

test('#136 build enrollment key: sent on enroll and its retries only; a rejected key is explained; never stored or shown', async ({ page }) => {
  const server = new FakeHealthServer();
  await route(page, server);
  await page.addInitScript(() => {
    localStorage.setItem('pft.healthSync.url', 'https://legacy-typed.example.test'); // left by #134's address field
    localStorage.setItem('pft.healthSync.enrollmentKey', 'legacy-typed-placeholder'); // left by the first #136 version
  });
  await seedRecords(page, { observations: [weigh('2026-11-01', 92.1)] });
  await openAt(page, MONDAY);
  await open(page);
  // The legacy typed key and address are deleted and never used: requests go to the build's address only.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('pft.healthSync.enrollmentKey'))).toBeNull();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('pft.healthSync.url'))).toBeNull();

  // The server rejects the build's key: explained, nothing linked, nothing local changed.
  const accepted = server.enrollmentKey;
  server.enrollmentKey = 'f'.repeat(64);
  await page.getByTestId('health-sync-prepare').click();
  await page.getByTestId('health-sync-upload').click();
  await expect(page.getByTestId('health-sync-error')).toContainText('didn’t accept this app’s enrollment key');
  await expect(page.getByTestId('health-sync-link-state')).toHaveText('Your first sync links this phone to the server.');
  expect(await page.evaluate(() => localStorage.getItem('pft.healthSync.pending'))).toBeTruthy();
  await page.screenshot({ path: 'docs/design/issue-136/rejected-key.png', fullPage: true });

  // Retry (e.g. after the Worker secret is fixed): same retry key, key sent again, one link.
  server.enrollmentKey = accepted;
  await page.getByTestId('health-sync-prepare').click();
  await page.getByTestId('health-sync-upload').click();
  await expect(page.getByTestId('health-sync-notice')).toHaveText('Linked and uploaded');
  const enrolls = server.requests.filter((q) => q.url.endsWith('/enroll'));
  expect(enrolls).toHaveLength(2);
  expect(enrolls.map((q) => q.headers['X-Enrollment-Key'])).toEqual([accepted, accepted]);
  expect(new Set(enrolls.map((q) => JSON.parse(q.body!).retryKey)).size).toBe(1);

  // Ordinary sync, server view and sharing never carry it.
  await page.getByTestId('health-sync-prepare').click();
  await page.getByTestId('health-sync-upload').click();
  await expect(page.getByTestId('health-sync-notice')).toHaveText('Uploaded');
  await page.getByTestId('health-sync-view').click();
  await expect(page.getByTestId('health-sync-remote')).toBeVisible();
  for (const q of server.requests.filter((q) => !q.url.endsWith('/enroll'))) {
    expect(q.headers['X-Enrollment-Key']).toBeUndefined();
    expect(q.body ?? '').not.toContain(accepted);
  }
  expect(server.requests.every((q) => q.url.startsWith(`${BASE}/api/body-anvil/v1/`))).toBe(true);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(stored).not.toContain(accepted);
  expect(await page.getByTestId('health-sync-sheet').innerText()).not.toContain(accepted);
});

test('#168 share everything: one tap syncs, links all history for 24 hours and hands the message over', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const server = new FakeHealthServer();
  await route(page, server);
  await seedRecords(page, { observations: [weigh('2026-08-01', 95), weigh('2026-10-30', 92.4), weigh('2026-11-01', 92.1)] });
  await openAt(page, MONDAY);
  await open(page);
  if (test.info().project.name === 'phone') await page.screenshot({ path: 'docs/design/issue-168/after-home.png' });
  await expect(page.getByTestId('health-sync-share')).toHaveText('Advanced sharing');
  await page.getByTestId('health-sync-share-everything').click();
  // The browser has no share sheet here, so the message is copied (the Android build opens the system share sheet).
  await expect(page.getByTestId('health-sync-notice')).toHaveText('Copied the link and instructions. Paste them into your AI chat.');
  expect(server.users.size).toBe(1);
  const share = server.shares[0];
  expect(share.scope).toEqual({ range: 'all', categories: ['measurements', 'activity', 'sleep', 'nutrition', 'training', 'plan'], format: 'records', expiresIn: 86400 });
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain(`${BASE}/api/body-anvil/v1/shared/${share.token}`);
  const read = await (await server.fetch(`${BASE}/api/body-anvil/v1/shared/${share.token}`, { method: 'GET', headers: {} })).text();
  expect(read).toContain('2026-08-01'); // all history, not the last 30 days
  expect(read).toContain('weightTarget'); // plan targets included
  await expect(page.getByTestId('everything-link')).toContainText('All your history');
  if (test.info().project.name === 'phone') await page.screenshot({ path: 'docs/design/issue-168/after-link.png' });
  await page.getByTestId('everything-revoke').click();
  await expect(page.getByTestId('health-sync-notice')).toHaveText('Link revoked');
  expect(share.revoked).toBe(true);
});
