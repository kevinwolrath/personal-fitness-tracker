import seed from '../../../plans/seed.plan.json';
import { KeyValueTrackingStore, MemoryKeyValue } from '../../storage/keyValueStore';
import { loadActivePlan } from '../bootstrap';

const fresh = () => new KeyValueTrackingStore(new MemoryKeyValue());

it('installs the bundled seed plan on a fresh install', async () => {
  const store = fresh();
  const plan = await loadActivePlan(store);
  expect(plan.id).toBe(seed.id);
  expect((await store.getActivePlan())?.revision).toBe(seed.revision);
});

it('keeps tracking data when a newer seed revision replaces the plan', async () => {
  const store = fresh();
  await loadActivePlan(store);
  await store.setActivity(seed.id, '2026-11-02', 'lunch', { activityId: 'lunch', status: 'done', count: 0, labelSnapshot: 'x', updatedAt: 't' });
  const plan = await loadActivePlan(store, { ...seed, revision: seed.revision + 1, title: 'Updated' });
  expect(plan.title).toBe('Updated');
  expect((await store.getDay(seed.id, '2026-11-02')).activities.lunch.status).toBe('done');
});

it('does not overwrite an imported plan with a different id', async () => {
  const store = fresh();
  const other = { ...seed, id: 'imported-plan', title: 'Imported' };
  await store.setActivePlan({ planId: other.id, revision: 1, formatVersion: 1, json: JSON.stringify(other), importedAt: 't' });
  expect((await loadActivePlan(store)).title).toBe('Imported');
});

it('refuses an invalid seed', async () => {
  await expect(loadActivePlan(fresh(), { ...seed, formatVersion: 9 })).rejects.toThrow(/seed plan is invalid/);
});
