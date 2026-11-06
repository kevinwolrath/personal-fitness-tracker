import seed from '../../../plans/seed.plan.json';
import { KeyValueTrackingStore, MemoryKeyValue } from '../../storage/keyValueStore';
import { installSeedPlan, loadActivePlan } from '../bootstrap';

const fresh = () => new KeyValueTrackingStore(new MemoryKeyValue());

it('a fresh install gets no plan (first-run setup creates one, #49): the bundled seed is never installed', async () => {
  const store = fresh();
  expect(await loadActivePlan(store)).toBeNull();
  expect(await store.getActivePlan()).toBeNull();
});

it('an existing install on the bundled seed keeps it, untouched', async () => {
  const store = fresh();
  await installSeedPlan(store);
  const before = await store.getActivePlan();
  expect((await loadActivePlan(store))!.id).toBe(seed.id);
  expect(await store.getActivePlan()).toEqual(before);
});

it('keeps tracking data when a newer seed revision replaces the plan', async () => {
  const store = fresh();
  await installSeedPlan(store);
  await store.setActivity(seed.id, '2026-11-02', 'lunch', { activityId: 'lunch', status: 'done', count: 0, labelSnapshot: 'x', updatedAt: 't' });
  const plan = await loadActivePlan(store, { ...seed, revision: seed.revision + 1, title: 'Updated' });
  expect(plan!.title).toBe('Updated');
  expect((await store.getDay(seed.id, '2026-11-02')).activities.lunch.status).toBe('done');
});

it('does not overwrite an imported plan with a different id', async () => {
  const store = fresh();
  const other = { ...seed, id: 'imported-plan', title: 'Imported' };
  await store.setActivePlan({ planId: other.id, revision: 1, formatVersion: 1, json: JSON.stringify(other), importedAt: 't' });
  expect((await loadActivePlan(store))!.title).toBe('Imported');
});

it('never replaces a plan created by setup, even with a newer seed', async () => {
  const store = fresh();
  const mine = { ...seed, id: seed.id, title: 'Mine' };
  await store.setActivePlan({ planId: mine.id, revision: 1, formatVersion: 4, json: JSON.stringify(mine), importedAt: 't', origin: 'onboarding' });
  expect((await loadActivePlan(store, { ...seed, revision: 99 }))!.title).toBe('Mine');
});

it('refuses an invalid seed', async () => {
  const store = fresh();
  await installSeedPlan(store);
  await expect(loadActivePlan(store, { ...seed, formatVersion: 9 })).rejects.toThrow(/seed plan is invalid/);
});
