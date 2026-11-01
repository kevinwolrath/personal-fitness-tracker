import { manualSource, type Observation } from '../../observations/types';
import type { ActivityLog, TrackingStore } from '../types';

const obs = (id: string, metric: string, date: string, value: number, recordedAt: string, over: Partial<Observation> = {}): Observation => ({
  id,
  date,
  metric,
  value,
  unit: 'kg',
  kind: 'observed',
  label: null,
  note: null,
  source: manualSource(),
  recordedAt,
  ...over,
});

const log = (activityId: string, over: Partial<ActivityLog> = {}): ActivityLog => ({
  activityId,
  status: 'done',
  count: 0,
  labelSnapshot: activityId,
  updatedAt: '2026-11-02T08:00:00.000Z',
  ...over,
});

/**
 * Behaviour every TrackingStore implementation must share (contract 04).
 * `reopen` must return a new store over the same persisted data (simulates restart/reload).
 */
export function describeTrackingStore(
  name: string,
  setup: () => Promise<{ store: TrackingStore; reopen: () => Promise<TrackingStore> }>,
  setupEmpty: () => Promise<TrackingStore>,
) {
  describe(`TrackingStore: ${name}`, () => {
    let store: TrackingStore;
    let reopen: () => Promise<TrackingStore>;
    beforeEach(async () => {
      ({ store, reopen } = await setup());
    });

    it('starts empty', async () => {
      expect(await store.getActivePlan()).toBeNull();
      expect(await store.getDay('p', '2026-11-02')).toEqual({ activities: {}, dayTypeOverride: null, observations: [], quickLogs: [] });
    });

    it('stores and replaces the single active plan', async () => {
      await store.setActivePlan({ planId: 'p', revision: 1, formatVersion: 1, json: '{"a":1}', importedAt: 't1' });
      await store.setActivePlan({ planId: 'p', revision: 2, formatVersion: 1, json: '{"a":2}', importedAt: 't2' });
      expect(await store.getActivePlan()).toEqual({ planId: 'p', revision: 2, formatVersion: 1, json: '{"a":2}', importedAt: 't2' });
    });

    it('upserts, updates and deletes activity logs per plan + date', async () => {
      await store.setActivity('p', '2026-11-02', 'walk', log('walk'));
      await store.setActivity('p', '2026-11-02', 'box', log('box', { status: 'pending', count: 1 }));
      await store.setActivity('p', '2026-11-02', 'box', log('box', { status: 'done', count: 3 }));
      await store.setActivity('p', '2026-11-03', 'walk', log('walk', { status: 'skipped' }));
      await store.setActivity('other', '2026-11-02', 'walk', log('walk'));

      const day = await store.getDay('p', '2026-11-02');
      expect(Object.keys(day.activities).sort()).toEqual(['box', 'walk']);
      expect(day.activities.box).toMatchObject({ status: 'done', count: 3 });
      expect((await store.getDay('p', '2026-11-03')).activities.walk.status).toBe('skipped');

      await store.setActivity('p', '2026-11-02', 'walk', null);
      expect(Object.keys((await store.getDay('p', '2026-11-02')).activities)).toEqual(['box']);
    });

    it('sets and clears day-type overrides', async () => {
      await store.setDayOverride('p', '2026-11-05', 'home');
      expect((await store.getDay('p', '2026-11-05')).dayTypeOverride).toBe('home');
      await store.setDayOverride('p', '2026-11-05', 'weekend');
      expect((await store.getDay('p', '2026-11-05')).dayTypeOverride).toBe('weekend');
      await store.setDayOverride('p', '2026-11-05', null);
      expect((await store.getDay('p', '2026-11-05')).dayTypeOverride).toBeNull();
    });

    it('records observations and finds the latest observed value on or before a date', async () => {
      await store.addObservations([
        obs('a', 'weight', '2026-11-01', 98.4, '2026-11-01T07:00:00Z'),
        obs('b', 'weight', '2026-11-02', 98.1, '2026-11-02T07:00:00Z'),
        obs('c', 'weight', '2026-11-02', 98.0, '2026-11-02T07:05:00Z'),
        obs('d', 'weight', '2026-11-04', 97.6, '2026-11-04T07:00:00Z'),
        obs('s', 'steps', '2026-11-02', 13765, '2026-11-02T20:00:00Z', { unit: 'count' }),
      ]);
      expect((await store.latestObservation('weight', '2026-11-03'))?.id).toBe('c');
      expect((await store.latestObservation('weight', '2026-11-01'))?.value).toBe(98.4);
      expect(await store.latestObservation('weight', '2026-10-31')).toBeNull();
      expect(await store.latestObservation('waist', '2026-11-04')).toBeNull();
      expect((await store.getDay('p', '2026-11-02')).observations.map((x) => x.id)).toEqual(['b', 'c', 's']);

      // Correcting history: remove a past entry and add a new one.
      await store.removeObservation('a');
      await store.addObservations([obs('e', 'weight', '2026-11-01', 98.3, '2026-11-05T09:00:00Z')]);
      expect((await store.latestObservation('weight', '2026-11-01'))?.value).toBe(98.3);
    });

    it('never returns an inferred value as the latest measurement', async () => {
      await store.addObservations([
        obs('real', 'weight', '2026-11-01', 97.25, '2026-11-01T07:00:00Z'),
        obs('calc', 'weight', '2026-11-01', 99.8, '2026-11-01T07:01:00Z', { kind: 'inferred' }),
      ]);
      expect((await store.latestObservation('weight', '2026-11-01'))?.id).toBe('real');
      // …but it is still stored, distinguishable, and visible on its day.
      const day = await store.getDay('p', '2026-11-01');
      expect(day.observations.find((o) => o.id === 'calc')?.kind).toBe('inferred');
    });

    it('saves an import session with its observations and full provenance', async () => {
      const session = {
        id: 'imp1',
        createdAt: '2026-11-01T16:45:00+11:00',
        extractor: 'anthropic:claude-opus-5-5',
        assets: [
          { id: 'a1', fileName: 'fitbit.png', mimeType: 'image/png', capturedAt: '2026-11-01T16:39:00+11:00', storedUri: null, sourceApp: 'fitbit' },
          { id: 'a2', fileName: 'scale.png', mimeType: 'image/png', capturedAt: null, storedUri: 'file:///x/a2.png', sourceApp: 'renpho' },
        ],
      };
      const fromFitbit = obs('o1', 'steps', '2026-11-01', 13765, '2026-11-01T16:45:00+11:00', {
        unit: 'count',
        source: { type: 'screenshot', app: 'fitbit', capturedAt: '2026-11-01T16:39:00+11:00', confidence: 0.98, importId: 'imp1', assetId: 'a1', evidence: '13,765 steps', edited: false },
      });
      const fromScale = obs('o2', 'weight', '2026-11-01', 97.3, '2026-11-01T16:45:00+11:00', {
        source: { type: 'screenshot', app: 'renpho', capturedAt: null, confidence: 0.9, importId: 'imp1', assetId: 'a2', evidence: '97.25 kg', edited: true },
      });
      await store.saveImport(session, [fromFitbit, fromScale]);

      const again = await reopen();
      const day = await again.getDay('p', '2026-11-01');
      expect(day.observations).toEqual([fromFitbit, fromScale]); // two source apps, same day, provenance intact
      expect((await again.snapshot()).imports).toEqual([session]);
    });

    it('snapshot holds everything; restore into an empty store reproduces it exactly', async () => {
      await store.setActivePlan({ planId: 'p', revision: 2, formatVersion: 1, json: '{"id":"p"}', importedAt: 't' });
      await store.setActivity('p', '2025-12-31', 'walk', log('walk', { status: 'skipped' }));
      await store.setActivity('p', '2026-11-02', 'box', log('box', { status: 'pending', count: 2 }));
      await store.setDayOverride('p', '2026-11-02', 'office');
      await store.addObservations([obs('w', 'weight', '2026-11-02', 97.9, 't1', { note: 'after run', label: null })]);
      await store.addQuickLog({ id: 'q', planId: 'p', quickLogId: 'hunger', date: '2026-11-02', at: '2026-11-02T10:00:00+11:00' });
      await store.saveImport({ id: 'i', createdAt: 't2', extractor: 'x', assets: [] }, []);

      const snap = await store.snapshot();
      expect(snap.activityLogs.map((a) => a.date)).toEqual(['2025-12-31', '2026-11-02']); // no lookback limit
      const target = await setupEmpty();
      await target.restore(snap);
      expect(await target.snapshot()).toEqual(snap);
      // Restore is idempotent (ids are stable).
      await target.restore(snap);
      expect(await target.snapshot()).toEqual(snap);
    });

    it('adds and removes quick logs, ordered by time', async () => {
      await store.addQuickLog({ id: 'q2', planId: 'p', quickLogId: 'hunger', date: '2026-11-02', at: '2026-11-02T14:05:00+11:00' });
      await store.addQuickLog({ id: 'q1', planId: 'p', quickLogId: 'hunger', date: '2026-11-02', at: '2026-11-02T10:42:00+11:00' });
      expect((await store.getDay('p', '2026-11-02')).quickLogs.map((q) => q.id)).toEqual(['q1', 'q2']);
      await store.removeQuickLog('q1');
      expect((await store.getDay('p', '2026-11-02')).quickLogs.map((q) => q.id)).toEqual(['q2']);
    });

    it('persists everything across reopen (restart / reload)', async () => {
      await store.setActivePlan({ planId: 'p', revision: 1, formatVersion: 1, json: '{}', importedAt: 't' });
      await store.setActivity('p', '2026-11-02', 'walk', log('walk'));
      await store.setDayOverride('p', '2026-11-02', 'office');
      await store.addObservations([obs('m', 'weight', '2026-11-02', 97.9, 't')]);
      await store.addQuickLog({ id: 'q', planId: 'p', quickLogId: 'hunger', date: '2026-11-02', at: 't' });

      const again = await reopen();
      expect((await again.getActivePlan())?.planId).toBe('p');
      const day = await again.getDay('p', '2026-11-02');
      expect(day.activities.walk.status).toBe('done');
      expect(day.dayTypeOverride).toBe('office');
      expect(day.observations[0].value).toBe(97.9);
      expect(day.quickLogs[0].id).toBe('q');
    });
  });
}
