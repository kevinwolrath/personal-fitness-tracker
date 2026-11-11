import { MemoryDevice, richHistory } from '../../backup/__tests__/fixture';
import { KeyValueTrackingStore, MemoryKeyValue } from '../../storage/keyValueStore';
import { healthSyncClient, normalizeBaseUrl, SyncError } from '../client';
import { buildHealthPayload, categories, type Scope } from '../payload';
import { aiInstruction, forgetLegacySettings, LEGACY_ENROLLMENT_KEY, LEGACY_SERVER_URL, NO_ENROLLMENT_KEY, createShareLink, credentialFor, ensureUserId, inspectRemote, listShareLinks, revokeShareLink, SECRET_KEYS, syncNow, syncStatus, USER_ID_KEY, type SyncDeps } from '../service';
import { BACKUP_PREFERENCE_KEYS } from '../../platform/preferences';
import { FakeHealthServer, MemorySecrets } from './fakeServer';

/** #134: the app side of health data sync, against a fake of the documented backend contract. Fictional data only. */

const TODAY = '2026-08-30'; // the fixture's history ends 2026-08-29
const BASE = 'https://health.example.test';
let ids = 0;
async function setup() {
  const store = new KeyValueTrackingStore(new MemoryKeyValue());
  const history = richHistory(new MemoryDevice('file:///app/'));
  // A display name in the plan profile: it must never be uploaded.
  const plan = JSON.parse(history.plans[0].json);
  history.plans[0] = { ...history.plans[0], json: JSON.stringify({ ...plan, profile: { ...(plan.profile ?? {}), displayName: 'Fictional Name' } }) };
  await store.replaceAll(history);
  const server = new FakeHealthServer();
  const secrets = new MemorySecrets();
  const deps: SyncDeps = {
    store,
    client: healthSyncClient(BASE, server.fetch),
    secrets,
    now: () => server.now,
    today: TODAY,
    appVersion: '0.1.0',
    uuid: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
    randomSecret: () => `secret-${ids}-${'z'.repeat(40)}`,
    enrollmentKey: server.enrollmentKey, // #136: built into the app (a placeholder here)
  };
  return { store, server, secrets, deps, history };
}
const token = (s: MemorySecrets) => JSON.parse(s.map.get(SECRET_KEYS.credential)!).ownerToken as string;

describe('data ID', () => {
  it('is made once and reused (a restart keeps it)', async () => {
    const { store, deps } = await setup();
    const a = await ensureUserId(store, deps.uuid);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(await ensureUserId(store, deps.uuid)).toBe(a);
    expect(await store.getMeta(USER_ID_KEY)).toBe(a);
  });

  it('travels with a full backup (snapshot → replaceAll on a new phone); the key does not', async () => {
    const { store, deps, secrets } = await setup();
    await syncNow(deps);
    const id = await store.getMeta(USER_ID_KEY);
    const other = new KeyValueTrackingStore(new MemoryKeyValue());
    await other.replaceAll(await store.snapshot());
    expect(await other.getMeta(USER_ID_KEY)).toBe(id);
    expect(JSON.stringify(await store.snapshot())).not.toContain(token(secrets));
  });
});

describe('Sync my data', () => {
  it('first use links (enrolls) with the full history; the token goes to secure storage only', async () => {
    const { deps, server, secrets, store } = await setup();
    const r = await syncNow(deps);
    expect(r).toMatchObject({ ok: true, linked: true });
    const userId = (await store.getMeta(USER_ID_KEY))!;
    expect(await credentialFor(secrets, userId)).toEqual({ userId, ownerToken: expect.stringMatching(/^owner-/) });
    expect(secrets.map.has(SECRET_KEYS.pending)).toBe(false);
    const sent = JSON.parse(server.requests[0].body!);
    expect(sent.snapshot.schema).toBe('body-anvil-health');
    expect(sent.snapshot.counts.values).toBe((await store.snapshot()).observations.filter((o) => o.date <= TODAY).length);
    expect(await syncStatus(secrets)).toMatchObject({ ok: true, message: 'Linked and uploaded', lastSuccessAt: server.now });
  });

  it('later syncs replace the snapshot with the token in the Authorization header only, and are repeatable', async () => {
    const { deps, server, secrets } = await setup();
    await syncNow(deps);
    const a = await syncNow(deps);
    const b = await syncNow(deps);
    expect(a.ok && b.ok).toBe(true);
    const puts = server.requests.filter((q) => q.method === 'PUT');
    expect(puts).toHaveLength(2);
    expect(puts[0].body).toBe(puts[1].body); // same data, same document
    for (const q of server.requests) {
      expect(q.url).not.toContain(token(secrets));
      expect(q.body ?? '').not.toContain(token(secrets));
    }
    expect(puts[0].headers.Authorization).toBe(`Bearer ${token(secrets)}`);
    expect(server.users.size).toBe(1);
  });

  it('an interrupted first link is retried with the same enrollment secret: one link, no duplicate', async () => {
    const { deps, server, secrets } = await setup();
    server.dropNextEnrollResponse = true;
    const first = await syncNow(deps);
    expect(first).toMatchObject({ ok: false, error: { kind: 'offline' } });
    expect(secrets.map.has(SECRET_KEYS.pending)).toBe(true);
    const retry = await syncNow(deps);
    expect(retry).toMatchObject({ ok: true, linked: true });
    const enrolls = server.requests.filter((q) => q.url.endsWith('/enroll')).map((q) => JSON.parse(q.body!).enrollmentSecret);
    expect(new Set(enrolls).size).toBe(1);
    expect(server.users.size).toBe(1);
  });

  it('a data ID linked elsewhere (409) is explained and nothing is saved', async () => {
    const { deps, server, store, secrets } = await setup();
    const id = await ensureUserId(store, deps.uuid);
    server.users.set(id, { secret: 'another phone', token: 't'.repeat(30), snapshot: null });
    const r = await syncNow(deps);
    expect(r).toMatchObject({ ok: false, error: { kind: 'conflict', message: expect.stringContaining('already linked to another phone') } });
    expect(await credentialFor(secrets, id)).toBeNull();
  });

  it('a revoked key (401), offline, rate limit and server errors are reported with the last success kept', async () => {
    const { deps, server, secrets } = await setup();
    await syncNow(deps);
    const ok = await syncStatus(secrets);
    server.users.forEach((u) => (u.token = 'rotated-token-xxxxxxxxxxxxxxxx'));
    expect(await syncNow(deps)).toMatchObject({ ok: false, error: { kind: 'auth' } });
    server.offline = true;
    expect(await syncNow(deps)).toMatchObject({ ok: false, error: { kind: 'offline' } });
    server.offline = false;
    server.failNext = 429;
    expect(await syncNow(deps)).toMatchObject({ ok: false, error: { kind: 'rateLimited', retryAfterSeconds: 30 } });
    server.failNext = 500;
    expect(await syncNow(deps)).toMatchObject({ ok: false, error: { kind: 'server' } });
    expect(await syncStatus(secrets)).toMatchObject({ ok: false, lastSuccessAt: ok!.lastSuccessAt });
  });

  it('a token stored for a different data ID is never used', async () => {
    const { deps, secrets, store } = await setup();
    await secrets.set(SECRET_KEYS.credential, JSON.stringify({ userId: 'someone-else', ownerToken: 'x'.repeat(30) }));
    expect(await credentialFor(secrets, await ensureUserId(store, deps.uuid))).toBeNull();
  });

  it('looking at the server copy never changes local data', async () => {
    const { deps, store } = await setup();
    await syncNow(deps);
    const before = JSON.stringify(await store.snapshot());
    const remote = await inspectRemote(deps);
    expect((remote.snapshot as { schema: string }).schema).toBe('body-anvil-health');
    expect(JSON.stringify(await store.snapshot())).toBe(before);
  });
});

describe('payload', () => {
  it('keeps dates, units and provenance; leaves out the name, photos, screenshot text and credentials', async () => {
    const { history } = await setup();
    const p = buildHealthPayload(history, { generatedAt: 't', today: TODAY, appVersion: '0.1.0' });
    const text = JSON.stringify(p);
    const v = (p.body ?? [])[0];
    expect(v).toMatchObject({ date: expect.any(String), unit: expect.any(String), source: { type: expect.any(String) } });
    expect(JSON.stringify(history)).toMatch(/Fictional Name[\s\S]*|file:\/\//); // the source has them
    expect(text).not.toMatch(/Fictional Name|file:\/\/|data:image|"photos"|"evidence"|"assetId"|displayName|ownerToken/);
    expect(p.plan).toBeDefined();
    expect((p.nutrition?.meals ?? []).length).toBeGreaterThan(0);
    expect(p.omitted).toContain('Your display name');
    expect(p.scope.categories).toEqual([...categories]);
  });

  it('a scope keeps only those days and categories, with coverage dates', async () => {
    const { history } = await setup();
    const scope: Scope = { days: 7, categories: ['body'] };
    const p = buildHealthPayload(history, { generatedAt: 't', today: TODAY, appVersion: '0.1.0' }, scope);
    expect(Object.keys(p)).not.toContain('nutrition');
    expect(Object.keys(p)).not.toContain('training');
    expect(Object.keys(p)).not.toContain('plan');
    const all = buildHealthPayload(history, { generatedAt: 't', today: TODAY, appVersion: '0.1.0' });
    expect((p.body ?? []).length).toBeGreaterThan(0);
    expect((p.body ?? []).length).toBeLessThan((all.body ?? []).length);
    for (const x of p.body ?? []) expect(x.date >= '2026-08-24' && x.date <= TODAY).toBe(true);
    expect(p.coverage.requestedFrom).toBe('2026-08-24');
  });
});

describe('Share my details', () => {
  it('needs a linked phone, shares exactly the previewed document, and the link reads it until revoked', async () => {
    const { deps, server, history } = await setup();
    const scope: Scope = { days: 30, categories: ['body', 'activity'] };
    const doc = buildHealthPayload(history, { generatedAt: 't', today: TODAY, appVersion: '0.1.0' }, scope);
    await expect(createShareLink(deps, scope, 24, doc)).rejects.toMatchObject({ kind: 'auth' });
    await syncNow(deps);
    const link = await createShareLink(deps, scope, 24, doc);
    expect(link.expiresAt).toBe('2026-11-13T00:00:00.000Z'); // 24 h after the fake server's clock
    expect(link.url).not.toMatch(/owner-/);
    const read = await server.fetch(link.url, { method: 'GET', headers: {} });
    expect(read.status).toBe(200);
    expect(JSON.parse(await read.text())).toEqual(doc);
    expect(await listShareLinks(deps)).toHaveLength(1);
    await revokeShareLink(deps, link.shareId);
    expect((await server.fetch(link.url, { method: 'GET', headers: {} })).status).toBe(404);
    expect((await listShareLinks(deps))[0].revokedAt).toBe(server.now);
  });

  it('an expired link and a guessed link read nothing; links are isolated per data ID', async () => {
    const { deps, server, history } = await setup();
    await syncNow(deps);
    const doc = buildHealthPayload(history, { generatedAt: 't', today: TODAY, appVersion: '0.1.0' }, { days: 7, categories: ['body'] });
    const link = await createShareLink(deps, { days: 7, categories: ['body'] }, 1, doc);
    expect((await server.fetch(`${BASE}/s/share-guess`, { method: 'GET', headers: {} })).status).toBe(404);
    server.now = '2026-11-12T01:00:00.000Z';
    expect((await server.fetch(link.url, { method: 'GET', headers: {} })).status).toBe(404);
    const other = await setup();
    await syncNow(other.deps);
    expect(await listShareLinks(other.deps)).toEqual([]);
  });

  it('the AI message has the link and instruction, never the owner token', async () => {
    const msg = aiInstruction('https://health.example.test/s/abc', '2026-11-13T00:00:00.000Z');
    expect(msg).toContain('Read the JSON at this link');
    expect(msg).toContain('https://health.example.test/s/abc');
  });
});

describe('client', () => {
  it('accepts only https (http to a dev host only in dev builds), without credentials or query', () => {
    expect(normalizeBaseUrl('https://questspire.example/')).toBe('https://questspire.example');
    expect(normalizeBaseUrl('http://questspire.example')).toBeNull();
    expect(normalizeBaseUrl('http://localhost:8787')).toBeNull(); // release build: https only (#146)
    expect(normalizeBaseUrl('http://localhost:8787', { dev: true })).toBe('http://localhost:8787');
    expect(normalizeBaseUrl('https://u:p@questspire.example')).toBeNull();
    expect(normalizeBaseUrl('https://questspire.example?token=x')).toBeNull();
    expect(normalizeBaseUrl('not a url')).toBeNull();
  });

  it('a missing address and an unreadable reply are clear errors', async () => {
    const { deps } = await setup();
    const r = await syncNow({ ...deps, client: healthSyncClient('', async () => { throw new Error('unused'); }) });
    expect(r).toMatchObject({ ok: false, error: { kind: 'config' } });
    const bad = healthSyncClient(BASE, async () => ({ status: 200, headers: { get: () => null }, text: async () => '<html>' }));
    await expect(bad.getSnapshot({ userId: 'u', ownerToken: 't' })).rejects.toBeInstanceOf(SyncError);
  });
});

describe('enrollment key from the build (#136)', () => {
  const enrolls = (server: FakeHealthServer) => server.requests.filter((q) => q.url.endsWith('/api/body-anvil/v1/enroll'));
  const sees = (server: FakeHealthServer, text: string) =>
    server.requests.some((q) => q.url.includes(text) || (q.body ?? '').includes(text) || Object.entries(q.headers).some(([k, v]) => k !== 'X-Enrollment-Key' && v.includes(text)));

  it('missing from the build: the first link stops with a clear message and sends nothing; the user is never asked', async () => {
    const { deps, server, secrets } = await setup();
    const r = await syncNow({ ...deps, enrollmentKey: '  ' });
    expect(r).toMatchObject({ ok: false, error: { kind: 'config', message: NO_ENROLLMENT_KEY } });
    expect(server.requests).toHaveLength(0);
    expect(secrets.map.has(SECRET_KEYS.pending)).toBe(false);
  });

  it('missing from the build does not affect a phone that is already linked', async () => {
    const { deps, server } = await setup();
    await syncNow(deps);
    expect(await syncNow({ ...deps, enrollmentKey: '' })).toMatchObject({ ok: true, linked: false });
    expect(enrolls(server)).toHaveLength(1);
  });

  it('sent only as X-Enrollment-Key on enroll; never on PUT, GET or share requests, URLs or bodies', async () => {
    const { deps, server, history } = await setup();
    await syncNow(deps);
    await syncNow(deps);
    await inspectRemote(deps);
    const doc = buildHealthPayload(history, { generatedAt: 't', today: TODAY, appVersion: '0.1.0' }, { days: 7, categories: ['body'] });
    const link = await createShareLink(deps, { days: 7, categories: ['body'] }, 1, doc);
    await listShareLinks(deps);
    await revokeShareLink(deps, link.shareId);
    expect(enrolls(server)).toHaveLength(1);
    expect(enrolls(server)[0].headers['X-Enrollment-Key']).toBe(server.enrollmentKey);
    for (const q of server.requests) if (q !== enrolls(server)[0]) expect(q.headers['X-Enrollment-Key']).toBeUndefined();
    expect(sees(server, server.enrollmentKey)).toBe(false);
    expect(JSON.stringify(server.shares)).not.toContain(server.enrollmentKey);
    expect(link.url).not.toContain(server.enrollmentKey);
  });

  it('wrong key (401): explained, nothing saved or changed; a corrected build retries the same enrollment', async () => {
    const { deps, server, secrets, store } = await setup();
    await ensureUserId(store, deps.uuid);
    const before = JSON.stringify(await store.snapshot());
    const wrong = await syncNow({ ...deps, enrollmentKey: 'wrong-placeholder' });
    expect(wrong).toMatchObject({ ok: false, error: { kind: 'enrollmentKey', message: expect.stringContaining('didn’t accept this app’s enrollment key') } });
    expect(wrong.ok ? '' : wrong.error.message).not.toContain('wrong-placeholder');
    const pending = JSON.parse(secrets.map.get(SECRET_KEYS.pending)!);
    expect(JSON.stringify(await store.snapshot())).toBe(before);
    expect(await credentialFor(secrets, (await store.getMeta(USER_ID_KEY))!)).toBeNull();
    expect(await syncNow(deps)).toMatchObject({ ok: true, linked: true });
    const sent = enrolls(server).map((q) => JSON.parse(q.body!).enrollmentSecret);
    expect(sent).toEqual([pending.secret, pending.secret]); // same retry secret, X-Enrollment-Key on both
    expect(enrolls(server).every((q) => typeof q.headers['X-Enrollment-Key'] === 'string')).toBe(true);
    expect(server.users.size).toBe(1);
  });

  it('an interrupted enroll is retried with the key and the same secret', async () => {
    const { deps, server } = await setup();
    server.dropNextEnrollResponse = true;
    expect(await syncNow(deps)).toMatchObject({ ok: false, error: { kind: 'offline' } });
    expect(await syncNow(deps)).toMatchObject({ ok: true, linked: true });
    expect(enrolls(server)).toHaveLength(2);
    expect(enrolls(server).map((q) => q.headers['X-Enrollment-Key'])).toEqual([server.enrollmentKey, server.enrollmentKey]);
  });

  it('never in the database, snapshots, the status record, secure storage or console output', async () => {
    const { deps, server, store, secrets } = await setup();
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));
    try {
      await syncNow({ ...deps, enrollmentKey: 'wrong-placeholder' });
      await syncNow(deps);
      for (const spy of spies) for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toMatch(/wrong-placeholder|test-enrollment-key/);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
    expect(JSON.stringify(await store.snapshot())).not.toContain(server.enrollmentKey);
    expect(JSON.stringify([...secrets.map.values()])).not.toContain(server.enrollmentKey);
  });

  it('a key or server address typed in by earlier versions is deleted, never used, and not backed up', async () => {
    const { secrets } = await setup();
    await secrets.set(LEGACY_ENROLLMENT_KEY, 'legacy-placeholder');
    await secrets.set(LEGACY_SERVER_URL, 'https://old.example.test');
    await forgetLegacySettings(secrets);
    expect(secrets.map.has(LEGACY_ENROLLMENT_KEY)).toBe(false);
    expect(secrets.map.has(LEGACY_SERVER_URL)).toBe(false);
    expect(BACKUP_PREFERENCE_KEYS.included).not.toContain(LEGACY_ENROLLMENT_KEY);
    expect(BACKUP_PREFERENCE_KEYS.included).not.toContain(LEGACY_SERVER_URL);
  });
});
