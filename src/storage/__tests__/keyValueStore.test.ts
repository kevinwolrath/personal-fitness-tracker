import { KeyValueTrackingStore, MemoryKeyValue, STORAGE_KEY } from '../keyValueStore';
import { describeTrackingStore } from './store.contract';

describeTrackingStore('key-value (web)', async () => {
  const kv = new MemoryKeyValue();
  return { store: new KeyValueTrackingStore(kv), reopen: async () => new KeyValueTrackingStore(kv) };
}, async () => new KeyValueTrackingStore(new MemoryKeyValue()));

it('recovers from corrupt stored data instead of crashing', async () => {
  const kv = new MemoryKeyValue();
  kv.setItem(STORAGE_KEY, '{not json');
  expect(await new KeyValueTrackingStore(kv).getActivePlan()).toBeNull();
});

it('reads a document written before #56: no exercise logs or muscle reports yet, everything else intact', async () => {
  const kv = new MemoryKeyValue();
  kv.setItem(STORAGE_KEY, JSON.stringify({
    version: 1, plan: null, activities: { 'p|2026-10-01': { walk: { activityId: 'walk', status: 'done', count: 0, labelSnapshot: 'Walk', updatedAt: 't' } } },
    overrides: {}, observations: [], quickLogs: [], imports: [], configChanges: [], completionEvents: [], daySnapshots: {},
  }));
  const store = new KeyValueTrackingStore(kv);
  expect(await store.exerciseLogs()).toEqual([]);
  expect(await store.muscleReports()).toEqual([]);
  expect((await store.getDay('p', '2026-10-01')).activities.walk.status).toBe('done');
  await store.addExerciseLog({ id: 'x', movement: 'plank', date: '2026-10-02', at: 't', sets: 2, reps: null, seconds: 30, intensity: null });
  expect((await store.snapshot()).activityLogs).toHaveLength(1);
});
