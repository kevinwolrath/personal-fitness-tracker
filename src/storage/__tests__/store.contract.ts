import type { ActivityLog, TrackingStore } from '../types';

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
export function describeTrackingStore(name: string, setup: () => Promise<{ store: TrackingStore; reopen: () => Promise<TrackingStore> }>) {
  describe(`TrackingStore: ${name}`, () => {
    let store: TrackingStore;
    let reopen: () => Promise<TrackingStore>;
    beforeEach(async () => {
      ({ store, reopen } = await setup());
    });

    it('starts empty', async () => {
      expect(await store.getActivePlan()).toBeNull();
      expect(await store.getDay('p', '2026-11-02')).toEqual({ activities: {}, dayTypeOverride: null, measurements: [], quickLogs: [] });
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

    it('records measurements and finds the latest on or before a date', async () => {
      const m = (id: string, date: string, value: number, recordedAt: string) => ({ id, planId: 'p', measurementId: 'weight', date, value, recordedAt });
      await store.addMeasurement(m('a', '2026-11-01', 98.4, '2026-11-01T07:00:00Z'));
      await store.addMeasurement(m('b', '2026-11-02', 98.1, '2026-11-02T07:00:00Z'));
      await store.addMeasurement(m('c', '2026-11-02', 98.0, '2026-11-02T07:05:00Z'));
      await store.addMeasurement(m('d', '2026-11-04', 97.6, '2026-11-04T07:00:00Z'));

      expect((await store.latestMeasurement('p', 'weight', '2026-11-03'))?.id).toBe('c');
      expect((await store.latestMeasurement('p', 'weight', '2026-11-01'))?.value).toBe(98.4);
      expect(await store.latestMeasurement('p', 'weight', '2026-10-31')).toBeNull();
      expect(await store.latestMeasurement('p', 'waist', '2026-11-04')).toBeNull();
      expect((await store.getDay('p', '2026-11-02')).measurements.map((x) => x.id)).toEqual(['b', 'c']);

      // Correcting history: remove a past entry and add a new one.
      await store.removeMeasurement('a');
      await store.addMeasurement(m('e', '2026-11-01', 98.3, '2026-11-05T09:00:00Z'));
      expect((await store.latestMeasurement('p', 'weight', '2026-11-01'))?.value).toBe(98.3);
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
      await store.addMeasurement({ id: 'm', planId: 'p', measurementId: 'weight', date: '2026-11-02', value: 97.9, recordedAt: 't' });
      await store.addQuickLog({ id: 'q', planId: 'p', quickLogId: 'hunger', date: '2026-11-02', at: 't' });

      const again = await reopen();
      expect((await again.getActivePlan())?.planId).toBe('p');
      const day = await again.getDay('p', '2026-11-02');
      expect(day.activities.walk.status).toBe('done');
      expect(day.dayTypeOverride).toBe('office');
      expect(day.measurements[0].value).toBe(97.9);
      expect(day.quickLogs[0].id).toBe('q');
    });
  });
}
