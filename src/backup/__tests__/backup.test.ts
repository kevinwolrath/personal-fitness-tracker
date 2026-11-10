/** #128 Full offline backup and restore: round trip, safety and coverage. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { BACKUP_PREFERENCE_KEYS } from '../../platform/preferences';
import { KeyValueTrackingStore, MemoryKeyValue } from '../../storage/keyValueStore';
import { STORE_TABLES, SqliteTrackingStore, type SqlDatabase } from '../../storage/sqliteStore';
import type { StoreSnapshot, TrackingStore } from '../../storage/types';
import { ATTACHMENT_REF, BACKUP_VERSION, readBackup } from '../archive';
import { createBackup, previewBackup, restoreBackup } from '../service';
import { sha256 } from '../sha256';
import { MemoryDevice, richHistory } from './fixture';

const META = { createdAt: '2026-11-10T09:00:00.000+11:00', today: '2026-11-10', appVersion: '0.1.0' };

function nodeSqlite(db: DatabaseSync): SqlDatabase {
  return {
    execAsync: async (sql) => void db.exec(sql),
    runAsync: async (sql, params) => db.prepare(sql).run(...params),
    getAllAsync: async <T,>(sql: string, params: (string | number | null)[]) => db.prepare(sql).all(...params) as T[],
    getFirstAsync: async <T,>(sql: string, params: (string | number | null)[]) => (db.prepare(sql).get(...params) as T | undefined) ?? null,
  };
}
const stores: [string, () => Promise<TrackingStore>][] = [
  ['SQLite (Android/iOS)', () => SqliteTrackingStore.open(nodeSqlite(new DatabaseSync(':memory:')))],
  ['key-value (web)', async () => new KeyValueTrackingStore(new MemoryKeyValue())],
];

/** Canonical form for comparison: attachment URIs replaced by the attachment's bytes checksum. */
async function canonical(s: StoreSnapshot, device: MemoryDevice) {
  const sum = (uri: string) => {
    const b = device.files.get(uri);
    return b ? `sha256:${sha256(b)}` : `missing:${uri}`;
  };
  return JSON.parse(
    JSON.stringify({
      ...s,
      mealLogs: (s.mealLogs ?? []).map((m) => ({ ...m, photos: m.photos.map((p) => ({ ...p, uri: sum(p.uri) })) })),
      imports: s.imports.map((i) => ({ ...i, assets: i.assets.map((a) => ({ ...a, storedUri: a.storedUri ? sum(a.storedUri) : null })) })),
    }),
  );
}

async function seeded(open: () => Promise<TrackingStore>) {
  const device = new MemoryDevice('file:///old/');
  const store = await open();
  await store.replaceAll(richHistory(device));
  return { store, device };
}

describe.each(stores)('%s', (_name, open) => {
  it('round trip: back up, wipe, restore on a fresh install → every record and every photo byte is identical', async () => {
    const a = await seeded(open);
    const expected = await canonical(await a.store.snapshot(), a.device);
    expect(expected.mealLogs.flatMap((m: any) => m.photos)).toHaveLength(6);

    const backup = await createBackup(a.store, a.device, META);
    expect(backup.fileName).toBe('body-anvil-backup-2026-11-10.zip');
    expect(backup.manifest.counts).toMatchObject({ mealPhotos: 6, importAssets: 1, mealLogs: 3, configChanges: 1 });
    expect(backup.manifest.missingAttachments).toEqual([]);

    // Fresh install on a new phone: empty store, empty device.
    const b = { store: await open(), device: new MemoryDevice('file:///new/') };
    const preview = previewBackup(backup.bytes);
    if (!preview.ok) throw new Error(preview.error);
    const r = await restoreBackup(b.store, b.device, preview, { restoreId: 'r1' });
    expect(r.ok).toBe(true);

    const restored = await b.store.snapshot();
    expect(await canonical(restored, b.device)).toEqual(expected);
    // Every photo resolves to a local file on the new device.
    for (const m of restored.mealLogs ?? []) for (const p of m.photos) expect(p.uri.startsWith('file:///new/restore-r1/meal-photos/')).toBe(true);
    // Skips, custom exercise ids, plan versions, timestamps and provenance survive (covered by equality, spot-checked here).
    expect(restored.exerciseLogs!.find((l) => l.status === 'skipped')).toMatchObject({ movement: 'dumbbell_shrug', sets: 0 });
    expect(JSON.parse(restored.plans[0].json).exercise.customExercises[0].movement).toBe('dumbbell_shrug');
    expect(restored.configChanges[0].previousPlanJson).toContain('"formatVersion": 7'.replace(': ', ':'));
    // Preferences come back; secrets and device-only state do not travel.
    expect(b.device.prefs.get('pft.gamification.v1')).toBe(a.device.prefs.get('pft.gamification.v1'));
    expect(b.device.prefs.get('pft.display.theme')).toBe('hero-forge');
    expect(b.device.prefs.has('pft.anthropic.apiKey')).toBe(false);
    expect(b.device.prefs.has('pft.healthConnect.sync')).toBe(false);
    expect(new TextDecoder().decode(backup.bytes)).not.toContain('sk-test-not-real');
  });

  it('restore over existing data replaces it (no merge, no duplicates) and deletes the replaced photos', async () => {
    const a = await seeded(open);
    const backup = await createBackup(a.store, a.device, META);
    const b = await seeded(open); // a populated phone with its own (different-bytes) photos
    await b.store.addObservations([{ ...(await b.store.snapshot()).observations[0], id: 'only-on-b', date: '2026-10-01' }]);
    const oldUris = [...b.device.files.keys()];
    const preview = previewBackup(backup.bytes);
    if (!preview.ok) throw new Error(preview.error);
    expect((await restoreBackup(b.store, b.device, preview, { restoreId: 'r2' })).ok).toBe(true);
    const after = await b.store.snapshot();
    expect(after.observations.find((o) => o.id === 'only-on-b')).toBeUndefined();
    expect(after.observations.length).toBe((await a.store.snapshot()).observations.length);
    for (const u of oldUris) expect(b.device.files.has(u)).toBe(false);
    expect(await canonical(after, b.device)).toEqual(await canonical(await a.store.snapshot(), a.device));
  });

  it('a failure while writing photos rolls everything back: data, preferences and files as before', async () => {
    const a = await seeded(open);
    const backup = await createBackup(a.store, a.device, META);
    const b = await seeded(open);
    b.device.prefs.set('pft.display.theme', 'classic');
    const before = await canonical(await b.store.snapshot(), b.device);
    const filesBefore = [...b.device.files.keys()].sort();
    b.device.failWriteAt = 3;
    const preview = previewBackup(backup.bytes);
    if (!preview.ok) throw new Error(preview.error);
    const r = await restoreBackup(b.store, b.device, preview, { restoreId: 'r3' });
    expect(r).toMatchObject({ ok: false, rolledBack: true, error: expect.stringMatching(/previous data was kept unchanged.*ran out of storage/) });
    expect(await canonical(await b.store.snapshot(), b.device)).toEqual(before);
    expect([...b.device.files.keys()].sort()).toEqual(filesBefore);
    expect(b.device.prefs.get('pft.display.theme')).toBe('classic');
  });

  it('a failure while replacing the records rolls back too (simulated mid-restore crash)', async () => {
    const a = await seeded(open);
    const backup = await createBackup(a.store, a.device, META);
    const b = await seeded(open);
    const before = await canonical(await b.store.snapshot(), b.device);
    const filesBefore = [...b.device.files.keys()].sort();
    let calls = 0;
    const flaky = new Proxy(b.store, {
      get(t, k) {
        const v = Reflect.get(t, k);
        if (k === 'replaceAll') return async (s: StoreSnapshot) => (++calls === 1 ? (await v.call(t, s), Promise.reject(new Error('crash after write'))) : v.call(t, s));
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    const preview = previewBackup(backup.bytes);
    if (!preview.ok) throw new Error(preview.error);
    const r = await restoreBackup(flaky, b.device, preview, { restoreId: 'r4' });
    expect(r).toMatchObject({ ok: false, rolledBack: true });
    expect(await canonical(await b.store.snapshot(), b.device)).toEqual(before);
    expect([...b.device.files.keys()].sort()).toEqual(filesBefore);
  });

  it('not enough storage: refused before anything changes', async () => {
    const a = await seeded(open);
    const backup = await createBackup(a.store, a.device, META);
    const b = await seeded(open);
    const before = await canonical(await b.store.snapshot(), b.device);
    b.device.free = 1024 * 1024;
    const preview = previewBackup(backup.bytes);
    if (!preview.ok) throw new Error(preview.error);
    const r = await restoreBackup(b.store, b.device, preview, { restoreId: 'r5' });
    expect(r).toMatchObject({ ok: false, rolledBack: false, error: expect.stringMatching(/Not enough free storage.*Nothing was changed/) });
    expect(await canonical(await b.store.snapshot(), b.device)).toEqual(before);
    expect(b.device.writes).toBe(0);
  });

  it('a later Health Connect sync does not duplicate restored history', async () => {
    const a = await seeded(open);
    const backup = await createBackup(a.store, a.device, META);
    const b = { store: await open(), device: new MemoryDevice('file:///new/') };
    const preview = previewBackup(backup.bytes);
    if (!preview.ok) throw new Error(preview.error);
    await restoreBackup(b.store, b.device, preview, { restoreId: 'r6' });
    const restoredSteps = (await b.store.snapshot()).observations.filter((o) => o.source.type === 'integration');
    // The sync re-reads the same day and replaces that day's integration values, as it does every time.
    await b.store.replaceIntegrationObservations('health-connect', ['2026-08-02'], ['steps'], restoredSteps.filter((o) => o.date === '2026-08-02'));
    const after = (await b.store.snapshot()).observations.filter((o) => o.source.type === 'integration' && o.date === '2026-08-02' && o.metric === 'steps');
    expect(after).toHaveLength(1);
  });
});

describe('archive validation (nothing is changed on any of these)', () => {
  let good: Uint8Array;
  beforeAll(async () => {
    const device = new MemoryDevice('file:///old/');
    const store = new KeyValueTrackingStore(new MemoryKeyValue());
    await store.replaceAll(richHistory(device));
    good = (await createBackup(store, device, META)).bytes;
  });
  const entries = () => unzipSync(good);
  const rezip = (files: Record<string, Uint8Array>) => zipSync(files);
  const manifestOf = (files: Record<string, Uint8Array>) => JSON.parse(new TextDecoder().decode(files['manifest.json']));

  it('accepts the good archive', () => expect(readBackup(good).ok).toBe(true));
  it('not a ZIP', () => expect(readBackup(strToU8('{"format":"pft-export"}'))).toMatchObject({ ok: false, error: expect.stringMatching(/not a ZIP/) }));
  it('truncated download', () => expect(readBackup(good.slice(0, Math.floor(good.length / 2)))).toMatchObject({ ok: false, error: expect.stringMatching(/damaged or incomplete/) }));
  it('newer, unsupported backup version', () => {
    const f = entries();
    f['manifest.json'] = strToU8(JSON.stringify({ ...manifestOf(f), backupVersion: BACKUP_VERSION + 1 }));
    expect(readBackup(rezip(f))).toMatchObject({ ok: false, error: expect.stringMatching(/newer version of Body Anvil.*Update the app/) });
  });
  it('tampered photo (checksum mismatch)', () => {
    const f = entries();
    const photo = Object.keys(f).find((p) => p.startsWith('attachments/meal-photos/'))!;
    f[photo] = f[photo].slice();
    f[photo][100] ^= 0xff;
    expect(readBackup(rezip(f))).toMatchObject({ ok: false, error: expect.stringMatching(/A meal photo in this backup is damaged/) });
  });
  it('missing photo', () => {
    const f = entries();
    delete f[Object.keys(f).find((p) => p.startsWith('attachments/meal-photos/'))!];
    expect(readBackup(rezip(f))).toMatchObject({ ok: false, error: expect.stringMatching(/missing a meal photo/) });
  });
  it('tampered records', () => {
    const f = entries();
    f['data/store.json'] = strToU8(new TextDecoder().decode(f['data/store.json']).replace('Chicken salad', 'Chicken salaD'));
    expect(readBackup(rezip(f))).toMatchObject({ ok: false, error: expect.stringMatching(/records file in this backup is damaged/) });
  });
  it('path traversal and unexpected files', () => {
    const f = entries();
    expect(readBackup(rezip({ ...f, '../../evil.sh': strToU8('x') }))).toMatchObject({ ok: false, error: expect.stringMatching(/unexpected file/) });
    expect(readBackup(rezip({ ...f, 'attachments/meal-photos/extra.jpg': strToU8('x') }))).toMatchObject({ ok: false, error: expect.stringMatching(/manifest doesn't list/) });
  });
  it('a record pointing at an attachment that is not in the archive', () => {
    const f = entries();
    const doc = JSON.parse(new TextDecoder().decode(f['data/store.json']));
    doc.mealLogs[0].photos[0].uri = `${ATTACHMENT_REF}attachments/meal-photos/nope.jpg`;
    f['data/store.json'] = strToU8(JSON.stringify(doc));
    const m = manifestOf(f);
    const entry = m.files.find((x: any) => x.path === 'data/store.json');
    entry.size = f['data/store.json'].length;
    entry.sha256 = sha256(f['data/store.json']);
    f['manifest.json'] = strToU8(JSON.stringify(m));
    expect(readBackup(rezip(f))).toMatchObject({ ok: false, error: expect.stringMatching(/isn't in this backup/) });
  });
});

describe('coverage guards: new storage cannot silently miss backups', () => {
  it('every SQLite table is emptied and refilled by a full restore', async () => {
    const raw = new DatabaseSync(':memory:');
    await SqliteTrackingStore.open(nodeSqlite(raw));
    const tables = (raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name).sort();
    expect(tables).toEqual([...STORE_TABLES].sort());
  });

  it('every device-storage key the app writes is classified as backed up or excluded', () => {
    const keys = new Set<string>();
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) {
          if (f !== '__tests__') walk(p);
        } else if (/\.tsx?$/.test(f)) for (const m of readFileSync(p, 'utf8').matchAll(/['"](pft\.[a-zA-Z.]+)['"]/g)) keys.add(m[1]);
      }
    };
    walk('src');
    const classified = new Set([...BACKUP_PREFERENCE_KEYS.included, ...Object.keys(BACKUP_PREFERENCE_KEYS.excluded)]);
    expect([...keys].filter((k) => !classified.has(k) && !k.startsWith('pft.test.'))).toEqual([]);
  });

  it('every snapshot list is in the backup and comes back', async () => {
    const device = new MemoryDevice('file:///old/');
    const s = richHistory(device);
    for (const [k, v] of Object.entries(s)) expect({ k, nonEmpty: Array.isArray(v) && v.length > 0 }).toEqual({ k, nonEmpty: true });
  });
});
