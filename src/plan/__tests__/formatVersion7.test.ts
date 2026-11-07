import Ajv2020 from 'ajv/dist/2020';
import contract from '../../../docs/design-contracts/plan.schema.json';
import seed from '../../../plans/seed.plan.json';
import { KeyValueTrackingStore, MemoryKeyValue } from '../../storage/keyValueStore';
import { loadActivePlan } from '../bootstrap';
import { validatePlan } from '../validate';

/** #56: formatVersion 7 adds `exercise.restDays` and activity `movement`. Both validators agree. */

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
const contractValidate = ajv.compile(contract);
const clone = (): any => JSON.parse(JSON.stringify(seed));
const both = (p: unknown) => ({ contract: contractValidate(p), runtime: validatePlan(p).ok });

describe('exercise.restDays', () => {
  it('the shipped seed rests on Friday only: Tue, Thu and Sun are not inferred from the schedule', () => {
    const r = validatePlan(seed);
    expect(r.ok && r.plan.exercise?.restDays).toEqual(['fri']);
  });

  it('is optional: a plan without it is valid and has no rest days', () => {
    const p = clone();
    delete p.exercise.restDays;
    expect(both(p)).toEqual({ contract: true, runtime: true });
    const r = validatePlan(p);
    expect(r.ok && r.plan.exercise?.restDays).toBeUndefined();
  });

  it('each weekday once, and only real weekdays', () => {
    const dup = clone();
    dup.exercise.restDays = ['fri', 'fri'];
    expect(both(dup)).toEqual({ contract: false, runtime: false });
    const bad = clone();
    bad.exercise.restDays = ['friday'];
    expect(both(bad)).toEqual({ contract: false, runtime: false });
  });

  it('needs formatVersion 7', () => {
    const p = clone();
    p.formatVersion = 6;
    for (const a of p.activities) delete a.movement;
    const r = validatePlan(p);
    expect(r.ok ? [] : r.errors.join('\n')).toMatch(/"exercise.restDays" needs formatVersion 7/);
  });
});

describe('activity movement', () => {
  it('links the seed’s conditioning activities to their inventory movements', () => {
    const r = validatePlan(seed);
    const links = r.ok ? Object.fromEntries(r.plan.activities.filter((a) => a.movement).map((a) => [a.id, a.movement])) : {};
    expect(links).toEqual({ 'vr-boxing': 'vr_boxing', 'heavy-bag': 'heavy_bag', 'battle-ropes': 'battle_ropes' });
  });

  it('must be a movement id, and needs formatVersion 7', () => {
    const bad = clone();
    bad.activities[0].movement = 'VR Boxing';
    expect(both(bad)).toEqual({ contract: false, runtime: false });
    const old = clone();
    old.formatVersion = 6;
    delete old.exercise.restDays;
    const r = validatePlan(old);
    expect(r.ok ? [] : r.errors.join('\n')).toMatch(/"movement" needs formatVersion 7/);
  });
});

describe('the seed update reaches untouched seed installs only', () => {
  it('an install still on the previous seed revision gets rest days, the one-arm row and the links', async () => {
    const store = new KeyValueTrackingStore(new MemoryKeyValue());
    const previous = { ...clone(), revision: seed.revision - 1, formatVersion: 4 };
    delete previous.exercise.restDays;
    for (const a of previous.activities) delete a.movement;
    // The previous seed prescribed the cable row.
    const row = previous.activities.find((a: any) => a.id === 'resistance').session.exercises.find((e: any) => e.movement === 'one_arm_kettlebell_row');
    Object.assign(row, { movement: 'cable_row', label: 'Cable row (Fortis)' });
    expect(validatePlan(previous).ok).toBe(true);
    await store.setActivePlan({ planId: seed.id, revision: previous.revision, formatVersion: 4, json: JSON.stringify(previous), importedAt: 't', origin: 'seed' });
    const plan = (await loadActivePlan(store))!;
    expect(plan.revision).toBe(seed.revision);
    expect(plan.exercise?.restDays).toEqual(['fri']);
    expect(plan.activities.find((a) => a.id === 'resistance')!.session!.exercises.map((e) => e.movement)).not.toContain('cable_row');
  });

  it('a plan the user configured is never overwritten', async () => {
    const store = new KeyValueTrackingStore(new MemoryKeyValue());
    const mine = { ...clone(), revision: 3, formatVersion: 4 };
    delete mine.exercise.restDays;
    for (const a of mine.activities) delete a.movement;
    await store.setActivePlan({ planId: seed.id, revision: 3, formatVersion: 4, json: JSON.stringify(mine), importedAt: 't', origin: 'config' });
    expect((await loadActivePlan(store))!.exercise?.restDays).toBeUndefined();
  });
});
