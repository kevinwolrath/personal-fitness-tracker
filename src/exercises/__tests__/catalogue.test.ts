/** #122 Muscle Growth: a category over the shared exercise catalogue, not a second exercise system. */
import seed from '../../../plans/seed.plan.json';
import { buildGuide } from '../guide';
import { applyConfigUpdate, parseConfigUpdate } from '../../config/update';
import { gameFrom } from '../../gamification/model';
import { addDays } from '../../plan/dates';
import type { Plan } from '../../plan/schema';
import { validatePlan } from '../../plan/validate';
import { KeyValueTrackingStore, MemoryKeyValue } from '../../storage/keyValueStore';
import type { ExerciseLog, StoreSnapshot } from '../../storage/types';
import {
  catalogueErrors,
  intensityFromRir,
  inventoryFor,
  muscleGrowthDay,
  muscleGrowthLog,
  muscleGrowthLogId,
  muscleGrowthOptions,
  progressionHint,
} from '../catalogue';
import { bundledInventory, exerciseInventory } from '../inventory';
import { exerciseState, loadExerciseHistory } from '../state';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const MON = '2026-11-02';
const shrug = { movement: 'dumbbell_shrug', name: 'Dumbbell shrug', kind: 'strength' as const, equipment: ['free_weights' as const], primary: ['upper_back'], secondary: ['forearms'], defaultDose: { sets: 3, reps: 12 }, guidance: ['Shoulders straight up, pause, lower slowly.'] };

function withGrowth(exercise: Record<string, unknown>): Plan {
  const raw = clone(seed) as any;
  raw.formatVersion = 8;
  raw.exercise = { ...raw.exercise, ...exercise };
  const r = validatePlan(raw);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.plan;
}
const growth = (targets: string[], exercises: { movement: string; sets?: number; reps?: number; loadKg?: number }[], extra: Record<string, unknown> = {}) =>
  withGrowth({ customExercises: [shrug], muscleGrowth: { enabled: true, targets, exercises, ...extra } });

describe('the shared catalogue', () => {
  it('#151 offers the supinated curl only when eligible, without changing the seed routine', async () => {
    const movement = 'supinated_cross_body_dumbbell_curl';
    const parsed = parseConfigUpdate(JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, exercise: { muscleGrowth: { enabled: true, targets: ['biceps'], exercises: [{ movement, sets: 3, reps: 10, loadKg: 7 }] } } } }));
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
    const result = applyConfigUpdate(clone(seed), parsed.update);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    expect(result.nextRaw.activities).toEqual(seed.activities);
    expect(result.nextRaw.schedule).toEqual(seed.schedule);
    expect(JSON.stringify(seed)).not.toContain(movement);
    const plan = result.plan;
    expect(muscleGrowthOptions(plan, ['biceps']).find(o => o.exercise.movement === movement)?.match).toBe('primary');
    expect(muscleGrowthOptions(plan, ['forearms']).find(o => o.exercise.movement === movement)?.match).toBe('secondary');
    const noGear = clone(plan);
    noGear.exercise!.equipment = [];
    expect(muscleGrowthOptions(noGear, ['biceps']).some(o => o.exercise.movement === movement)).toBe(false);
    noGear.exercise!.equipment = [{ type: 'dumbbells' }];
    expect(muscleGrowthOptions(noGear, ['biceps']).some(o => o.exercise.movement === movement)).toBe(true);
    noGear.exercise!.limitations = [{ movement, status: 'avoid' }];
    expect(muscleGrowthOptions(noGear, ['biceps']).some(o => o.exercise.movement === movement)).toBe(false);
    const row = muscleGrowthDay(plan, MON, [])!.rows[0];
    expect(row.planned).toEqual({ sets: 3, reps: 10, loadKg: 7 });
    const store = new KeyValueTrackingStore(new MemoryKeyValue());
    await store.addExerciseLog(muscleGrowthLog(row, MON, `${MON}T12:00:00+11:00`, 'done'));
    const history = await loadExerciseHistory(store, plan, MON);
    const state = exerciseState(plan, history, { now: `${MON}T20:00:00+11:00`, today: MON }, inventoryFor(plan));
    expect(state.coverage.find(c => c.muscle === 'biceps')!.volume).toBe(3);
    expect(state.coverage.find(c => c.muscle === 'forearms')!.volume).toBe(1.5);
  });
  it('adds custom exercises to the same inventory, with the same shape; muscle groups stay the 14 bundled ones', () => {
    const plain = withGrowth({});
    expect(inventoryFor(plain).exercises).toEqual(bundledInventory.exercises);
    expect(exerciseInventory.muscleGroups).toHaveLength(14);
    expect(exerciseInventory.muscleGroups.map((m) => m.id)).not.toContain('traps');

    const p = growth(['biceps', 'upper_back'], []);
    const inv = inventoryFor(p);
    expect(inv.muscleGroups).toEqual(exerciseInventory.muscleGroups); // upper traps are Upper back: no 15th group
    expect(inv.exercises.find((e) => e.movement === 'dumbbell_shrug')).toEqual({ movement: 'dumbbell_shrug', name: 'Dumbbell shrug', kind: 'strength', equipment: ['free_weights'], primary: ['upper_back'], secondary: ['forearms'], defaultDose: { sets: 3, reps: 12 } });
    expect(inv.exercises.filter((e) => e.movement === 'hammer_curl')).toHaveLength(1);
  });

  it('rejects duplicates of built-in exercises, unknown muscles, and routines that use unknown, avoided or off-target movements', () => {
    expect(catalogueErrors(withGrowth({ customExercises: [{ ...shrug, movement: 'hammer_curl' }] }))[0]).toMatch(/already a built-in exercise/);
    expect(catalogueErrors(withGrowth({ customExercises: [{ ...shrug, name: 'Lat pulldown' }] }))[0]).toMatch(/already a built-in exercise/);
    expect(catalogueErrors(withGrowth({ customExercises: [{ ...shrug, primary: ['neck'] }] }))[0]).toMatch(/unknown muscle group "neck"/);
    // Upper traps are Upper back (#126): "traps" is not a group, and the error says where it belongs.
    expect(catalogueErrors(withGrowth({ customExercises: [{ ...shrug, primary: ['traps'] }] }))[0]).toMatch(/"traps" is counted as "upper_back"/);
    expect(catalogueErrors(withGrowth({ muscleGrowth: { enabled: true, targets: ['traps'], exercises: [] } }))[0]).toMatch(/muscleGrowth\.targets\[0\]: "traps" is counted as "upper_back"/);
    expect(catalogueErrors(growth(['biceps'], [{ movement: 'nordic_curl' }]))[0]).toMatch(/not in the exercise catalogue/);
    expect(catalogueErrors(growth(['biceps'], [{ movement: 'leg_extension' }]))[0]).toMatch(/doesn't work a target/);
    const avoided = growth(['biceps'], [{ movement: 'hammer_curl' }]);
    avoided.exercise!.limitations = [{ movement: 'hammer_curl', status: 'avoid' }];
    expect(catalogueErrors(avoided)[0]).toMatch(/marked "avoid"/);
    expect(catalogueErrors(growth(['biceps', 'upper_back'], [{ movement: 'hammer_curl' }, { movement: 'dumbbell_shrug' }]))).toEqual([]);
  });

  it('offers only exercises for the targets, with the user equipment; different targets give different lists', () => {
    const p = growth(['biceps'], []);
    const biceps = muscleGrowthOptions(p, ['biceps']).map((o) => [o.exercise.movement, o.match]);
    expect(biceps[0]).toEqual(['hammer_curl', 'primary']);
    expect(biceps.map(([m]) => m)).toEqual(expect.arrayContaining(['lat_pulldown', 'one_arm_kettlebell_row']));
    expect(biceps.map(([m]) => m)).not.toContain('knuckle_push_up');
    expect(muscleGrowthOptions(p, ['upper_back']).map((o) => o.exercise.movement)).toEqual(expect.arrayContaining(['one_arm_kettlebell_row', 'dumbbell_shrug']));
    // An avoided movement is never offered.
    const noCurl = growth(['biceps'], []);
    noCurl.exercise!.limitations = [{ movement: 'hammer_curl', status: 'avoid' }];
    expect(muscleGrowthOptions(noCurl, ['biceps']).map((o) => o.exercise.movement)).not.toContain('hammer_curl');
    // Without the equipment, a custom exercise isn't offered either.
    const noWeights = growth(['upper_back'], []);
    noWeights.exercise!.equipment = noWeights.exercise!.equipment!.filter((e) => e.type !== 'free_weights');
    expect(muscleGrowthOptions(noWeights, ['upper_back']).map((o) => o.exercise.movement)).not.toContain('dumbbell_shrug');
  });
});

describe("today's Muscle Growth checklist", () => {
  const p = growth(['biceps', 'upper_back'], [{ movement: 'hammer_curl', sets: 3, reps: 12, loadKg: 10 }, { movement: 'dumbbell_shrug' }], { when: 'lunch' });

  it('lists the routine with planned doses; done and skipped are distinct and saved per date', () => {
    const day = muscleGrowthDay(p, MON, [])!;
    expect(day.offered).toBe(true);
    expect(day.rows.map((r) => [r.movement, r.status, r.planned])).toEqual([
      ['hammer_curl', 'pending', { sets: 3, reps: 12, loadKg: 10 }],
      ['dumbbell_shrug', 'pending', { sets: 3, reps: 12 }],
    ]);
    const done = muscleGrowthLog(day.rows[0], MON, 't1', 'done');
    const skipped = muscleGrowthLog(day.rows[1], MON, 't2', 'skipped');
    expect(done).toMatchObject({ id: muscleGrowthLogId(MON, 'hammer_curl'), routine: 'muscle_growth', status: 'done', sets: 3, reps: 12, loadKg: 10 });
    expect(skipped).toMatchObject({ id: muscleGrowthLogId(MON, 'dumbbell_shrug'), status: 'skipped', sets: 0, reps: null, loadKg: null });
    const after = muscleGrowthDay(p, MON, [done, skipped])!;
    expect(after.rows.map((r) => r.status)).toEqual(['done', 'skipped']);
    expect([after.done, after.skipped, after.remaining]).toEqual([1, 1, 0]);
    // Another date is untouched.
    expect(muscleGrowthDay(p, addDays(MON, 1), [done, skipped])!.rows.map((r) => r.status)).toEqual(['pending', 'pending']);
  });

  it('a correction replaces the record (same id), never adds one', () => {
    const row = muscleGrowthDay(p, MON, [])!.rows[0];
    expect(muscleGrowthLog(row, MON, 'a', 'skipped').id).toBe(muscleGrowthLog(row, MON, 'b', 'done', { sets: 2, reps: 10, rir: 1 }).id);
    expect(muscleGrowthLog(row, MON, 'b', 'done', { sets: 2, reps: 10, rir: 1 })).toMatchObject({ sets: 2, reps: 10, rir: 1, intensity: 'hard', loadKg: null });
    expect([0, 2, 4, null].map(intensityFromRir)).toEqual(['hard', 'moderate', 'light', null]);
  });

  it('changing targets changes the checklist; history still shows what was logged', () => {
    const done = muscleGrowthLog(muscleGrowthDay(p, MON, [])!.rows[1], MON, 't', 'done');
    const bicepsOnly = growth(['biceps'], [{ movement: 'hammer_curl' }, { movement: 'lat_pulldown' }]);
    expect(muscleGrowthDay(bicepsOnly, addDays(MON, 1), [])!.rows.map((r) => r.movement)).toEqual(['hammer_curl', 'lat_pulldown']);
    const past = muscleGrowthDay(bicepsOnly, MON, [done])!;
    expect(past.rows.map((r) => [r.movement, r.status, r.inRoutine])).toEqual([
      ['hammer_curl', 'pending', true],
      ['lat_pulldown', 'pending', true],
      ['dumbbell_shrug', 'done', false],
    ]);
  });

  it('only on the configured days; off means nothing new is offered', () => {
    const tueThu = growth(['biceps'], [{ movement: 'hammer_curl' }], { days: ['tue', 'thu'] });
    expect(muscleGrowthDay(tueThu, MON, [])!.offered).toBe(false);
    expect(muscleGrowthDay(tueThu, addDays(MON, 1), [])!.rows).toHaveLength(1);
    const off = withGrowth({ muscleGrowth: { enabled: false, targets: ['biceps'], exercises: [{ movement: 'hammer_curl' }] } });
    expect(muscleGrowthDay(off, MON, [])).toMatchObject({ offered: false, rows: [] });
    expect(muscleGrowthDay(withGrowth({}), MON, [])).toBeNull();
  });
});

describe('shared accounting', () => {
  const p = growth(['biceps', 'upper_back'], [{ movement: 'hammer_curl', sets: 3, reps: 12 }, { movement: 'dumbbell_shrug', sets: 3, reps: 12 }]);
  const at = (d: string) => `${d}T12:30:00+11:00`;

  it('completed items add muscle load like any exercise (both categories); skipped items add none', async () => {
    const store = new KeyValueTrackingStore(new MemoryKeyValue());
    const rows = muscleGrowthDay(p, MON, [])!.rows;
    await store.addExerciseLog(muscleGrowthLog(rows[0], MON, at(MON), 'done'));
    await store.addExerciseLog(muscleGrowthLog(rows[1], MON, at(MON), 'skipped'));
    // An evening hammer curl outside Muscle Growth: the same muscles, counted together.
    await store.addExerciseLog({ id: 'evening', movement: 'hammer_curl', date: MON, at: `${MON}T19:00:00+11:00`, sets: 2, reps: 12, seconds: null, intensity: null });
    const history = await loadExerciseHistory(store, p, MON);
    expect(history.entries.map((e) => e.movement).sort()).toEqual(['hammer_curl', 'hammer_curl']);
    const state = exerciseState(p, history, { now: `${MON}T20:00:00+11:00`, today: MON }, inventoryFor(p));
    const biceps = state.coverage.find((c) => c.muscle === 'biceps')!;
    const upperBack = state.coverage.find((c) => c.muscle === 'upper_back')!;
    expect(biceps.volume).toBe(5); // 3 + 2 sets, from both categories
    expect(upperBack.volume).toBe(0); // the skipped shrug: no work
    expect(biceps.status).toBe('recovering'); // > 2 effective sets today: a recovery window, not "8 hours later is fine"
  });

  it('skipped items never count for XP or progress', () => {
    const snap: StoreSnapshot = { plans: [], activityLogs: [], observations: [], dayOverrides: [], quickLogs: [], imports: [], configChanges: [], completionEvents: [], daySnapshots: [], muscleReports: [], mealLogs: [], exerciseLogs: [] };
    const base = { movement: 'dumbbell_shrug', at: 't', seconds: null, intensity: null, routine: 'muscle_growth' as const };
    const early: ExerciseLog = { ...base, id: 'a', date: '2026-09-01', sets: 3, reps: 10, status: 'done' };
    const skipped: ExerciseLog = { ...base, id: 'b', date: '2026-10-15', sets: 3, reps: 20, status: 'skipped' };
    const g = gameFrom({ ...snap, exerciseLogs: [early, skipped] }, p, '2026-10-20');
    expect(g.achievements.find((a) => a.id === 'performance')!.unlocked).toBe(false);
    const g2 = gameFrom({ ...snap, exerciseLogs: [early, { ...skipped, status: 'done' }] }, p, '2026-10-20');
    expect(g2.achievements.find((a) => a.id === 'performance')!.unlocked).toBe(true);
  });

  it('suggests gradual progression only after two easy sessions, and never changes the routine', () => {
    const planned = { sets: 3, reps: 12, loadKg: 10 };
    const log = (date: string, rir: number | null, reps = 12): ExerciseLog => ({ id: date, movement: 'hammer_curl', date, at: 't', sets: 3, reps, seconds: null, intensity: null, routine: 'muscle_growth', status: 'done', loadKg: 10, rir });
    expect(progressionHint('hammer_curl', planned, [log('2026-10-30', 3)], MON)).toBeNull();
    expect(progressionHint('hammer_curl', planned, [log('2026-10-28', 3), log('2026-10-30', 1)], MON)).toBeNull();
    expect(progressionHint('hammer_curl', planned, [log('2026-10-28', 3), log('2026-10-30', 2, 10)], MON)).toBeNull();
    expect(progressionHint('hammer_curl', planned, [log('2026-10-28', 3), log('2026-10-30', null)], MON)).toBeNull();
    expect(progressionHint('hammer_curl', planned, [log('2026-10-28', 3), log('2026-10-30', 2)], MON)).toMatch(/at 10 kg.*small step up/);
  });
});

describe('configuration', () => {
  it('Configure with AI can set up Muscle Growth and custom exercises; the result is formatVersion 8', () => {
    const update = JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, exercise: { customExercises: [shrug], muscleGrowth: { enabled: true, targets: ['biceps', 'upper_back'], exercises: [{ movement: 'hammer_curl' }, { movement: 'dumbbell_shrug' }], when: 'lunch' } } } });
    const parsed = parseConfigUpdate(update);
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
    const applied = applyConfigUpdate(clone(seed), parsed.update);
    if (!applied.ok) throw new Error(applied.errors.join('\n'));
    expect(applied.nextRaw.formatVersion).toBe(8);
    expect(applied.plan.exercise?.muscleGrowth?.targets).toEqual(['biceps', 'upper_back']);
    // The schedule, rest days and the resistance session are untouched.
    expect(applied.nextRaw.schedule).toEqual((seed as any).schedule);
    expect(applied.nextRaw.activities).toEqual((seed as any).activities);
    expect((applied.nextRaw as any).exercise.restDays).toEqual((seed as any).exercise.restDays);
  });

  it('an off-target or unknown movement is rejected with a path, and nothing is applied', () => {
    const bad = parseConfigUpdate(JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, exercise: { muscleGrowth: { enabled: true, targets: ['biceps'], exercises: [{ movement: 'leg_extension' }] } } } }));
    if (!bad.ok) throw new Error('should parse');
    const r = applyConfigUpdate(clone(seed), bad.update);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/^fitnessConfigUpdate\.exercise\.muscleGrowth\.exercises\[0\]\.movement/);
  });

  it('a formatVersion 7 plan cannot carry the new fields', () => {
    const raw = clone(seed) as any;
    raw.exercise.muscleGrowth = { enabled: true, targets: ['biceps'], exercises: [] };
    expect(validatePlan(raw).ok).toBe(false);
  });
});

describe('older plans and data (#126: v8 only if old plans migrate safely)', () => {
  it('a formatVersion 7 plan still loads unchanged and has no Muscle Growth until the user sets it up', () => {
    const r = validatePlan(clone(seed));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.formatVersion).toBe(7);
      expect(muscleGrowthDay(r.plan, MON, [])).toBeNull();
      expect(inventoryFor(r.plan)).toEqual({ ...bundledInventory, exercises: bundledInventory.exercises });
    }
  });

  it('free exercise logs saved before #122 (no routine or status) still count as done work', async () => {
    const store = new KeyValueTrackingStore(new MemoryKeyValue());
    await store.addExerciseLog({ id: 'old', movement: 'hammer_curl', date: MON, at: `${MON}T07:00:00+11:00`, sets: 2, reps: 12, seconds: null, intensity: null });
    const p = validatePlan(clone(seed));
    if (!p.ok) throw new Error('seed');
    const history = await loadExerciseHistory(store, p.plan, MON);
    expect(history.entries.map((e) => e.movement)).toEqual(['hammer_curl']);
  });
});

it('#153 adds a guide without invalidating or overriding an existing custom kettlebell shrug', () => {
  const custom = { ...shrug, movement: 'kettlebell_shrug', name: 'Kettlebell shrug', equipment: ['kettlebell'], defaultDose: { sets: 2, reps: 12 } };
  const plan = withGrowth({ customExercises: [custom], muscleGrowth: { enabled: true, targets: ['upper_back'], exercises: [{ movement: custom.movement, sets: 2, reps: 12 }] } });
  expect(catalogueErrors(plan)).toEqual([]);
  expect(inventoryFor(plan).exercises.filter(entry => entry.movement === custom.movement)).toEqual([expect.objectContaining({ movement: custom.movement, name: custom.name, defaultDose: custom.defaultDose })]);
  const guide = buildGuide({ movement: custom.movement, label: custom.name, sets: 2, reps: 12 }, plan.exercise);
  expect(guide.steps.map(step => step.image)).toEqual(['kettlebell-shrug-1', 'kettlebell-shrug-2']);
  const parsed = parseConfigUpdate(JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, exercise: { muscleGrowth: plan.exercise!.muscleGrowth } } }));
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
  const applied = applyConfigUpdate(plan, parsed.update);
  expect(applied.ok).toBe(true);
  if (applied.ok) expect(applied.plan.exercise!.customExercises).toEqual(plan.exercise!.customExercises);
});
