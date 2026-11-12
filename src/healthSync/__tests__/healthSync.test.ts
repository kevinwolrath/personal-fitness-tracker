import { MemoryDevice, richHistory } from '../../backup/__tests__/fixture';
import { KeyValueTrackingStore, MemoryKeyValue } from '../../storage/keyValueStore';
import { healthSyncClient, normalizeBaseUrl, SyncError, type ShareScope } from '../client';
import { buildSnapshot } from '../payload';
import {
  aiInstruction, createShareLink, credentialFor, ensureUserId, forgetLegacySettings, inspectRemote, LEGACY_ENROLLMENT_KEY, LEGACY_SERVER_URL,
  listShareLinks, NO_ENROLLMENT_KEY, previewShare, revokeShareLink, SECRET_KEYS, syncNow, syncStatus, USER_ID_KEY, type SyncDeps,
} from '../service';
import { BACKUP_PREFERENCE_KEYS } from '../../platform/preferences';
import { FakeHealthServer, MemorySecrets, validateSnapshot } from './fakeServer';

/**
 * #134, #163: the app side of health data sync, against a strict fake of the deployed Worker's contract
 * (questspirestudio worker/index.mjs). Fictional data only.
 */

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
  let keys = 0;
  const deps: SyncDeps = {
    store,
    client: healthSyncClient(BASE, server.fetch),
    secrets,
    now: () => new Date(server.now).toISOString(),
    today: TODAY,
    appVersion: '0.1.0',
    // Upper case on purpose: the Worker only accepts lowercase, so the app must lowercase it.
    uuid: () => `ABCDEF00-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
    randomKey: () => (++keys).toString(16).padStart(64, 'a'),
    enrollmentKey: server.enrollmentKey, // #136: built into the app (a placeholder here)
  };
  return { store, server, secrets, deps, history };
}
const token = (s: MemorySecrets) => JSON.parse(s.map.get(SECRET_KEYS.credential)!).ownerToken as string;
const enrolls = (s: FakeHealthServer) => s.requests.filter((q) => q.url.endsWith('/enroll'));
const SCOPE: ShareScope = { range: 30, categories: ['measurements', 'nutrition'], format: 'records', expiresIn: 3600 };

describe('data ID', () => {
  it('is made once and reused (a restart keeps it), and sent in lowercase', async () => {
    const { store, deps, server } = await setup();
    const a = await ensureUserId(store, deps.uuid);
    expect(await ensureUserId(store, deps.uuid)).toBe(a);
    await syncNow(deps);
    expect(JSON.parse(enrolls(server)[0].body!).uuid).toBe(a.toLowerCase());
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

describe('snapshot (the Worker’s wire format)', () => {
  it('the full history passes the Worker’s validation: only its keys, metrics, units and sources', async () => {
    const { store } = await setup();
    const s = buildSnapshot(await store.snapshot(), { today: TODAY, appVersion: '0.1.0' });
    expect(() => validateSnapshot(s)).not.toThrow();
    expect(Object.keys(s).sort()).toEqual(['appVersion', 'coverage', 'records', 'schemaVersion']);
    expect(s.records.length).toBeGreaterThan(50);
    expect([...new Set(s.records.map((r) => r.category))].sort()).toEqual(['activity', 'measurements', 'nutrition', 'plan', 'training']);
    expect(s.records.filter((r) => r.source === 'plan').map((r) => r.date)).toEqual([TODAY, TODAY, TODAY]);
    expect(s.coverage).toEqual({ from: s.records[0].date, to: TODAY });
  });

  it('carries no name, free text or identifiers: dated numbers only', async () => {
    const { store, history } = await setup();
    const json = JSON.stringify(buildSnapshot(await store.snapshot(), { today: TODAY, appVersion: '0.1.0' }));
    expect(json).not.toContain('Fictional Name');
    for (const m of history.mealLogs ?? []) expect(json).not.toContain(`"${m.name}"`);
    for (const r of JSON.parse(json).records) expect(Object.values(r).every((v) => typeof v === 'number' || /^[\w-]+$/.test(String(v)))).toBe(true);
  });

  it('energy is sent in kcal, sleep in minutes, body fat in %; inferred values are left out', async () => {
    const { store } = await setup();
    const snap = await store.snapshot();
    const o = (metric: string, value: number, kind: 'observed' | 'inferred' = 'observed') =>
      ({ ...snap.observations[0], id: `x-${metric}-${kind}`, metric, value, kind, date: '2026-08-20' }) as (typeof snap.observations)[number];
    snap.observations.push(o('energy_intake', 8368), o('active_energy', 2092), o('sleep_duration', 420), o('body_fat', 24.5), o('weight', 90, 'inferred'));
    const s = buildSnapshot(snap, { today: TODAY, appVersion: '0.1.0' });
    expect(() => validateSnapshot(s)).not.toThrow();
    const on = (metric: string) => s.records.filter((r) => r.date === '2026-08-20' && r.metric === metric && r.source !== 'app');
    expect(on('energy')).toEqual([expect.objectContaining({ category: 'nutrition', value: 2000 })]);
    expect(on('activeEnergy')).toEqual([expect.objectContaining({ category: 'activity', value: 500 })]);
    expect(on('duration')).toEqual([expect.objectContaining({ category: 'sleep', value: 420 })]);
    expect(on('bodyFat')).toEqual([expect.objectContaining({ category: 'measurements', value: 24.5 })]);
    expect(on('weight').map((r) => r.value)).not.toContain(90);
  });

  it('a day total and that day’s meals are never both sent (no double counting)', async () => {
    const { store } = await setup();
    const s = buildSnapshot(await store.snapshot(), { today: TODAY, appVersion: '0.1.0' });
    const energy = s.records.filter((r) => r.metric === 'energy');
    const byDate = new Map<string, number>();
    for (const r of energy) byDate.set(r.date, (byDate.get(r.date) ?? 0) + (r.source === 'app' ? 100 : 1));
    for (const n of byDate.values()) expect(n === 100 || n < 100).toBe(true);
  });

  it('a version that isn’t major.minor.patch is sent as 0.0.0 (the Worker rejects anything else)', async () => {
    const { store } = await setup();
    expect(buildSnapshot(await store.snapshot(), { today: TODAY, appVersion: '1.0' }).appVersion).toBe('0.0.0');
  });
});

describe('Sync my data', () => {
  it('first use links with the full history (uuid, a 64-hex retry key, the snapshot); the token goes to secure storage only', async () => {
    const { deps, server, secrets, store } = await setup();
    const r = await syncNow(deps);
    expect(r).toMatchObject({ ok: true, linked: true });
    const sent = JSON.parse(enrolls(server)[0].body!);
    expect(Object.keys(sent).sort()).toEqual(['retryKey', 'snapshot', 'uuid']);
    expect(sent.retryKey).toMatch(/^[0-9a-f]{64}$/);
    const userId = (await store.getMeta(USER_ID_KEY))!.toLowerCase();
    expect(await credentialFor(secrets, userId)).toEqual({ userId, ownerToken: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(secrets.map.has(SECRET_KEYS.pending)).toBe(false);
    expect(await syncStatus(secrets)).toMatchObject({ ok: true, message: 'Linked and uploaded' });
  });

  it('later syncs replace the snapshot with the token in the Authorization header only, and are repeatable', async () => {
    const { deps, server, secrets } = await setup();
    await syncNow(deps);
    expect(await syncNow(deps)).toMatchObject({ ok: true, linked: false });
    expect(await syncNow(deps)).toMatchObject({ ok: true });
    const puts = server.requests.filter((q) => q.method === 'PUT');
    expect(puts).toHaveLength(2);
    expect(puts[0].body).toBe(puts[1].body);
    for (const q of server.requests) expect(q.url + (q.body ?? '')).not.toContain(token(secrets));
    expect(puts[0].headers.Authorization).toBe(`Bearer ${token(secrets)}`);
  });

  it('an interrupted first link is retried with the same retry key; the retry uploads the latest data', async () => {
    const { deps, server } = await setup();
    server.dropNextEnrollResponse = true;
    expect(await syncNow(deps)).toMatchObject({ ok: false, error: { kind: 'offline' } });
    expect(await syncNow(deps)).toMatchObject({ ok: true, linked: true });
    const [a, b] = enrolls(server).map((q) => JSON.parse(q.body!).retryKey);
    expect(a).toBe(b);
    expect(server.users.size).toBe(1);
    expect(server.requests.at(-1)!.method).toBe('PUT'); // 200 retry: the stored snapshot is the first attempt's
  });

  it('a pending retry key from the old format (not 64 hex) is replaced, not sent', async () => {
    const { deps, server, secrets, store } = await setup();
    const id = (await ensureUserId(store, deps.uuid)).toLowerCase();
    await secrets.set(SECRET_KEYS.pending, JSON.stringify({ userId: id, secret: 'old-base64url-secret' }));
    expect(await syncNow(deps)).toMatchObject({ ok: true });
    expect(JSON.parse(enrolls(server)[0].body!).retryKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a data ID linked elsewhere (409) is explained and nothing is saved', async () => {
    const { deps, server, secrets, store } = await setup();
    const id = (await ensureUserId(store, deps.uuid)).toLowerCase();
    server.users.set(id, { retryKey: 'f'.repeat(64), ownerToken: 'f'.repeat(64), snapshot: '{}', checksum: 'x', revision: 'r', updatedAt: 't' });
    const r = await syncNow(deps);
    expect(r).toMatchObject({ ok: false, error: { kind: 'conflict' } });
    expect(secrets.map.has(SECRET_KEYS.credential)).toBe(false);
  });

  it('a rejected owner token (403), offline, rate limit and server errors are reported with the last success kept', async () => {
    const { deps, server, secrets } = await setup();
    await syncNow(deps);
    const ok = (await syncStatus(secrets))!.lastSuccessAt;
    server.offline = true;
    expect(await syncNow(deps)).toMatchObject({ ok: false, error: { kind: 'offline' } });
    server.offline = false;
    server.failNext = 429;
    expect(await syncNow(deps)).toMatchObject({ ok: false, error: { kind: 'rateLimited', retryAfterSeconds: 60 } });
    server.failNext = 500;
    expect(await syncNow(deps)).toMatchObject({ ok: false, error: { kind: 'server' } });
    for (const u of server.users.values()) u.ownerToken = '0'.repeat(64);
    expect(await syncNow(deps)).toMatchObject({ ok: false, error: { kind: 'auth' } });
    expect((await syncStatus(secrets))!.lastSuccessAt).toBe(ok);
  });

  it('the server rejecting the data (400) is explained, not shown as offline', async () => {
    const { deps, server } = await setup();
    server.failNext = 400;
    expect(await syncNow(deps)).toMatchObject({ ok: false, error: { kind: 'invalid', message: expect.stringMatching(/rejected the data/) } });
  });

  it('a token stored for a different data ID is never used', async () => {
    const { deps, secrets, server } = await setup();
    await secrets.set(SECRET_KEYS.credential, JSON.stringify({ userId: '11111111-1111-4111-8111-111111111111', ownerToken: 'a'.repeat(64) }));
    await syncNow(deps);
    expect(server.requests[0].url).toMatch(/\/enroll$/);
  });

  it('looking at the server copy never changes local data', async () => {
    const { deps, store } = await setup();
    await syncNow(deps);
    const before = JSON.stringify(await store.snapshot());
    const remote = await inspectRemote(deps);
    expect(remote.updatedAt).toBeTruthy();
    expect((remote.snapshot as { records: unknown[] }).records.length).toBeGreaterThan(0);
    expect(JSON.stringify(await store.snapshot())).toBe(before);
  });
});

describe('Share my details', () => {
  it('previews the server’s projection, creates a link to exactly that, lists it on the phone, and revokes it', async () => {
    const { deps, server } = await setup();
    await syncNow(deps);
    const p = await previewShare(deps, SCOPE);
    expect(p.revision).toMatch(/^[0-9a-f]{32}$/);
    const link = await createShareLink(deps, SCOPE, p.revision!);
    expect(link.url).toMatch(/\/shared\/[0-9a-f]{64}$/);
    const read = await server.fetch(link.url, { method: 'GET', headers: {} });
    expect(JSON.parse(await read.text())).toEqual(p.data);
    expect((await listShareLinks(deps)).map((l) => l.id)).toEqual([link.id]);
    await revokeShareLink(deps, link.id);
    expect(await listShareLinks(deps)).toEqual([]);
    expect((await server.fetch(link.url, { method: 'GET', headers: {} })).status).toBe(404);
  });

  it('a sync between preview and create is caught (409): the link is never made from data that wasn’t shown', async () => {
    const { deps } = await setup();
    await syncNow(deps);
    const p = await previewShare(deps, SCOPE);
    await syncNow(deps);
    await expect(createShareLink(deps, SCOPE, p.revision!)).rejects.toMatchObject({ kind: 'conflict' });
  });

  it('before linking, the preview is worked out on the phone (for Share as text) and has no revision', async () => {
    const { deps, server } = await setup();
    const p = await previewShare(deps, SCOPE);
    expect(p.revision).toBeNull();
    expect((p.data as { data: { category: string }[] }).data.every((r) => SCOPE.categories.includes(r.category as never))).toBe(true);
    expect(server.requests).toHaveLength(0);
  });

  it('expired links drop off the list; a revoked link that is already gone is just removed', async () => {
    const { deps, server } = await setup();
    await syncNow(deps);
    const link = await createShareLink(deps, SCOPE, (await previewShare(deps, SCOPE)).revision!);
    server.shares.length = 0; // gone on the server
    await revokeShareLink(deps, link.id);
    expect(await listShareLinks(deps)).toEqual([]);
    await createShareLink(deps, SCOPE, (await previewShare(deps, SCOPE)).revision!);
    server.now += 2 * 3600 * 1000;
    expect(await listShareLinks(deps)).toEqual([]);
  });

  it('the AI message has the link and instruction, never the owner token', async () => {
    const { deps, secrets } = await setup();
    await syncNow(deps);
    const link = await createShareLink(deps, SCOPE, (await previewShare(deps, SCOPE)).revision!);
    const msg = aiInstruction(link.url, link.expiresAt);
    expect(msg).toContain(link.url);
    expect(msg).not.toContain(token(secrets));
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

  it('#155: a base URL that already ends in the API path is used without doubling it', () => {
    expect(normalizeBaseUrl('https://questspire.example/api/body-anvil/v1')).toBe('https://questspire.example');
    expect(normalizeBaseUrl('https://questspire.example/api/body-anvil/v1/')).toBe('https://questspire.example');
    expect(normalizeBaseUrl('https://questspire.example/base/api/body-anvil/v1')).toBe('https://questspire.example/base');
  });

  it('a missing address and an unreadable reply are clear errors', async () => {
    const { deps } = await setup();
    const r = await syncNow({ ...deps, client: healthSyncClient('', async () => { throw new Error('unused'); }) });
    expect(r).toMatchObject({ ok: false, error: { kind: 'config' } });
    const bad = healthSyncClient(BASE, async () => ({ status: 200, headers: { get: () => null }, text: async () => '<html>' }));
    await expect(bad.putSnapshot({ userId: 'u', ownerToken: 't' }, buildSnapshot(await deps.store.snapshot(), { today: TODAY, appVersion: '0.1.0' }))).rejects.toMatchObject({ kind: 'badResponse' });
  });
});

describe('enrollment key from the build (#136)', () => {
  it('missing from the build: the first link stops with a clear message and sends nothing; the user is never asked', async () => {
    const { deps, server } = await setup();
    expect(await syncNow({ ...deps, enrollmentKey: '' })).toMatchObject({ ok: false, error: { kind: 'config', message: NO_ENROLLMENT_KEY } });
    expect(server.requests).toHaveLength(0);
  });

  it('missing from the build does not affect a phone that is already linked', async () => {
    const { deps } = await setup();
    await syncNow(deps);
    expect(await syncNow({ ...deps, enrollmentKey: '' })).toMatchObject({ ok: true, linked: false });
  });

  it('sent only as X-Enrollment-Key on enroll; never on PUT, GET or share requests, URLs or bodies', async () => {
    const { deps, server } = await setup();
    await syncNow(deps);
    await syncNow(deps);
    await inspectRemote(deps);
    await createShareLink(deps, SCOPE, (await previewShare(deps, SCOPE)).revision!);
    for (const q of server.requests) {
      const isEnroll = q.url.endsWith('/enroll');
      expect(q.headers['X-Enrollment-Key']).toBe(isEnroll ? server.enrollmentKey : undefined);
      expect(q.url + (q.body ?? '')).not.toContain(server.enrollmentKey);
    }
  });

  it('wrong key (401): explained, nothing saved; a corrected build retries the same enrollment', async () => {
    const { deps, server, secrets } = await setup();
    const r = await syncNow({ ...deps, enrollmentKey: 'f'.repeat(64) });
    expect(r).toMatchObject({ ok: false, error: { kind: 'enrollmentKey' } });
    expect(secrets.map.has(SECRET_KEYS.credential)).toBe(false);
    const pending = secrets.map.get(SECRET_KEYS.pending);
    expect(await syncNow(deps)).toMatchObject({ ok: true, linked: true });
    expect(JSON.parse(enrolls(server)[1].body!).retryKey).toBe(JSON.parse(pending!).secret);
  });

  it('enrollment switched off on the server (503) is explained', async () => {
    const { deps, server } = await setup();
    server.failNext = 503;
    expect(await syncNow(deps)).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
  });

  it('never in the database, snapshots, the status record, secure storage or console output', async () => {
    const { deps, server, store, secrets } = await setup();
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));
    try {
      await syncNow({ ...deps, enrollmentKey: 'f'.repeat(64) });
      await syncNow(deps);
      for (const spy of spies) for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(server.enrollmentKey);
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

it('SyncError is an Error', () => expect(new SyncError('offline', 'x')).toBeInstanceOf(Error));
