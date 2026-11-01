import seed from '../../../plans/seed.plan.json';
import { manualSource } from '../../observations/types';
import { KeyValueTrackingStore, MemoryKeyValue } from '../../storage/keyValueStore';
import { buildExport, exportSchema, toSnapshot } from '../exportFormat';

async function populatedStore() {
  const store = new KeyValueTrackingStore(new MemoryKeyValue());
  await store.setActivePlan({ planId: seed.id, revision: 1, formatVersion: 1, json: JSON.stringify(seed), importedAt: '2026-01-02T08:00:00+11:00' });
  // Oldest record is years back: no lookback window may cut it off.
  await store.setActivity(seed.id, '2024-03-05', 'vr-boxing', { activityId: 'vr-boxing', status: 'done', count: 3, labelSnapshot: 'VR boxing', updatedAt: 't' });
  await store.setActivity(seed.id, '2026-11-01', 'resistance', { activityId: 'resistance', status: 'skipped', count: 0, labelSnapshot: 'Resistance', updatedAt: 't' });
  await store.addObservations([
    { id: 'm1', date: '2025-06-01', metric: 'weight', value: 104.2, unit: 'kg', kind: 'observed', label: null, note: 'start', source: manualSource(), recordedAt: 't' },
  ]);
  await store.saveImport(
    { id: 'imp', createdAt: '2026-11-01T16:45:00+11:00', extractor: 'anthropic:claude-opus-5-5', assets: [{ id: 'a', fileName: 'f.png', mimeType: 'image/png', capturedAt: '2026-11-01T16:39:00+11:00', storedUri: null, sourceApp: 'fitbit' }] },
    [
      { id: 's1', date: '2026-11-01', metric: 'steps', value: 13765, unit: 'count', kind: 'observed', label: null, note: null, recordedAt: 't2',
        source: { type: 'screenshot', app: 'fitbit', capturedAt: '2026-11-01T16:39:00+11:00', confidence: 0.98, importId: 'imp', assetId: 'a', evidence: '13,765', edited: false } },
      { id: 'i1', date: '2026-11-01', metric: 'weight', value: 99.8, unit: 'kg', kind: 'inferred', label: null, note: null, recordedAt: 't2',
        source: { type: 'screenshot', app: 'renpho', capturedAt: null, confidence: 0.7, importId: 'imp', assetId: 'a', evidence: '97.25 + 2.55', edited: false } },
    ],
  );
  await store.addQuickLog({ id: 'q', planId: seed.id, quickLogId: 'hunger', date: '2026-10-30', at: '2026-10-30T15:00:00+11:00' });
  await store.setDayOverride(seed.id, '2026-10-29', 'home');
  return store;
}

const meta = { exportedAt: '2026-11-01T16:50:00+11:00', today: '2026-11-01', appVersion: '0.1.0' };

it('exports the entire history, earliest record through today, versioned', async () => {
  const doc = buildExport(await (await populatedStore()).snapshot(), meta);
  expect(exportSchema.parse(doc)).toBeTruthy();
  expect(doc).toMatchObject({ format: 'pft-export', exportVersion: 1, range: { from: '2024-03-05', to: '2026-11-01' } });
  expect(doc.counts).toEqual({ observations: 3, activityLogs: 2, dayOverrides: 1, quickLogs: 1, imports: 1 });
  expect(doc.activityLogs.map((a) => [a.date, a.activityId, a.status, a.count])).toEqual([
    ['2024-03-05', 'vr-boxing', 'done', 3],
    ['2026-11-01', 'resistance', 'skipped', 0],
  ]);
  // Goals and targets come with the plan.
  expect((doc.plans[0].plan as typeof seed).goals[0].target).toBe(78);
});

it('includes provenance, timestamps, notes, and keeps inferred values marked', async () => {
  const doc = buildExport(await (await populatedStore()).snapshot(), meta);
  const byId = Object.fromEntries(doc.observations.map((o) => [o.id, o]));
  expect(byId.s1.source).toEqual({ type: 'screenshot', app: 'fitbit', capturedAt: '2026-11-01T16:39:00+11:00', confidence: 0.98, importId: 'imp', assetId: 'a', evidence: '13,765', edited: false });
  expect(byId.i1.kind).toBe('inferred');
  expect(byId.m1).toMatchObject({ note: 'start', source: { type: 'manual' } });
  expect(doc.imports[0].assets[0].sourceApp).toBe('fitbit');
});

it('round-trips: export → JSON → wipe → restore → identical data', async () => {
  const original = await (await populatedStore()).snapshot();
  const json = JSON.stringify(buildExport(original, meta));

  const parsed = toSnapshot(JSON.parse(json));
  if (!parsed.ok) throw new Error(parsed.error);
  const fresh = new KeyValueTrackingStore(new MemoryKeyValue());
  await fresh.restore(parsed.snapshot);
  const restored = await fresh.snapshot();
  expect({ ...restored, plans: [] }).toEqual({ ...original, plans: [] });
  expect(JSON.parse(restored.plans[0].json)).toEqual(JSON.parse(original.plans[0].json));
});

it('an empty store exports a valid document with no start date', async () => {
  const doc = buildExport(await new KeyValueTrackingStore(new MemoryKeyValue()).snapshot(), meta);
  expect(doc.range).toEqual({ from: null, to: '2026-11-01' });
  expect(exportSchema.safeParse(doc).success).toBe(true);
});

it('rejects a document that is not a v1 export', () => {
  expect(toSnapshot({ format: 'pft-export', exportVersion: 2 })).toMatchObject({ ok: false });
});
