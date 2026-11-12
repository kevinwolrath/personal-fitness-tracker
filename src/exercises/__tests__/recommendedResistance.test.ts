import seed from '../../../plans/seed.plan.json';
import { validatePlan } from '../../plan/validate';
import { prescribeDay } from '../../prescription/prescribe';
import { MemoryKeyValue, KeyValueTrackingStore } from '../../storage/keyValueStore';
import { recommendedResistance } from '../recommendedResistance';
import { exerciseState, loadExerciseHistory, logExercise } from '../state';
import { todayWorkout, workoutToggle } from '../todayWorkout';
import { muscleGrowthDay } from '../catalogue';
import type { Inventory } from '../inventory';
import type { ExerciseEntry } from '../coverage';
import type { ActivityLog, MuscleReport } from '../../storage/types';

const date = '2026-11-12';
const now = `${date}T12:00:00+11:00`;
const inventory: Inventory = { inventoryVersion: 1, muscleGroups: [{ id: 'chest', label: 'Chest' }, { id: 'upper_back', label: 'Upper back' }, { id: 'biceps', label: 'Biceps' }], exercises: [
  { movement: 'press', name: 'Press', kind: 'strength', primary: ['chest'], secondary: ['biceps'], equipment: [], defaultDose: { sets: 3, reps: 10 } },
  { movement: 'row', name: 'Row', kind: 'strength', primary: ['upper_back'], secondary: ['biceps'], equipment: [], defaultDose: { sets: 2, reps: 12 } },
  { movement: 'curl', name: 'Curl', kind: 'strength', primary: ['biceps'], secondary: [], equipment: ['dumbbells'], defaultDose: { sets: 2, reps: 10 } },
] };
const loaded = validatePlan({ ...seed, activities: [], requirements: [], exercise: { equipment: [{ type: 'dumbbells' }], restDays: [] } });
if (!loaded.ok) throw new Error(loaded.errors.join('\n'));
const plan = loaded.plan;
let n = 0;
const entry = (movement: string, day: string, sets = 1): ExerciseEntry => ({ id: `e${n++}`, movement, date: day, at: `${day}T08:00:00+11:00`, sets, reps: 10, source: 'free' });
const history = [entry('press', '2026-11-01'), entry('row', '2026-11-08', 2)];
function run(entries = history, options: { plan?: typeof plan; reports?: MuscleReport[]; logs?: Record<string, ActivityLog> } = {}) {
  const p = options.plan ?? plan;
  const records = { activities: options.logs ?? {}, dayTypeOverride: null, observations: [], quickLogs: [] };
  const items = prescribeDay(p, date, records).items;
  const state = exerciseState(p, { entries, reports: options.reports ?? [] }, { today: date, now }, inventory);
  const workout = todayWorkout({ plan: p, date, items, logs: records.activities, freeLogs: [], state, inventory });
  return recommendedResistance({ plan: p, date, state, workout, growth: muscleGrowthDay(p, date, [], inventory), inventory, logs: records.activities });
}

it('explains weighted recorded volume, frequency and pending work for one group', () => {
  expect(run()).toMatchObject({ kind: 'ready', muscle: 'chest', volume: 0, trainingDays: 0, planned: 0 });
  expect(run()).toHaveProperty('reason', expect.stringContaining('0 recorded effective sets across 0 training days'));
  const result = run([entry('press', '2026-11-01'), entry('press', '2026-11-08', 4)]);
  expect(result).toMatchObject({ kind: 'ready', muscle: 'upper_back' });
});

it('secondary activation and repeated-date deduplication count through the shared model', () => {
  const e = entry('press', '2026-11-08', 2);
  const entries = [entry('row', '2026-11-01'), e, e];
  const p = { ...plan, exercise: { ...plan.exercise, limitations: [{ movement: 'row', status: 'avoid' as const }] } };
  const result = run(entries, { plan: p });
  expect(result).toMatchObject({ kind: 'ready', muscle: 'biceps', volume: 1, trainingDays: 1 });
});

it('frequency distinguishes equal volume, so ranking is more than fewest sets', () => {
  const entries = [entry('press', '2026-11-01'), entry('press', '2026-11-07', 2), entry('row', '2026-11-07'), entry('row', '2026-11-08')];
  const p = { ...plan, exercise: { ...plan.exercise, limitations: [{ movement: 'curl', status: 'avoid' as const }] } };
  // Chest and upper back have 2 effective sets each; chest has only one recent recorded day.
  expect(run(entries, { plan: p })).toMatchObject({ kind: 'ready', muscle: 'chest', trainingDays: 1 });
});

it('excludes recovery, soreness and injury in secondary as well as primary muscles', () => {
  const fresh = [...history, entry('curl', date, 3)];
  expect(run(fresh)).toMatchObject({ kind: 'empty' });
  for (const kind of ['sore', 'injured'] as const) {
    expect(run(history, { reports: [{ id: kind, muscle: 'biceps', kind, at: now, clearedAt: null }] })).toMatchObject({ kind: 'empty' });
  }
});

it('never asserts a group for sparse/future history, absent data, or configured rest days', () => {
  for (const entries of [[], [history[0]], [entry('press', '2026-11-20'), history[0]]]) expect(run(entries)).toMatchObject({ kind: 'empty', reason: expect.stringContaining('More recorded') });
  expect(run(history, { plan: { ...plan, exercise: { ...plan.exercise, restDays: ['thu'] } } })).toMatchObject({ kind: 'empty', reason: expect.stringContaining('Rest day') });
});

it('accounts for scheduled workload and keeps scheduled/routine movements out of extras', () => {
  const p: typeof plan = { ...plan, activities: [{ id: 'strength', kind: 'exercise', label: 'Strength', required: true, flexible: false, tracking: { type: 'check' }, session: { exercises: [{ movement: 'press', sets: 6, reps: 10 }] } }] };
  expect(run(history, { plan: p })).toMatchObject({ kind: 'ready', muscle: 'upper_back' });
  const routine = { ...plan, exercise: { ...plan.exercise, muscleGrowth: { enabled: true, targets: ['chest'], exercises: [{ movement: 'press', sets: 6, reps: 10 }] } } };
  expect(run(history, { plan: routine })).toMatchObject({ kind: 'ready', muscle: 'upper_back' });
  const r = run(history, { plan: routine });
  if (r.kind === 'ready') expect(r.rows.map(row => row.movement)).not.toContain('press');
});

it('My Gym access, avoid and caution use the existing eligibility result', () => {
  const p = { ...plan, exercise: { equipment: [], limitations: [{ movement: 'press', status: 'avoid' as const }, { movement: 'row', status: 'caution' as const }] } };
  const r = run(history, { plan: p });
  expect(r.kind).toBe('ready');
  if (r.kind === 'ready') {
    expect(r.rows.map(row => row.movement)).not.toEqual(expect.arrayContaining(['curl', 'press']));
    expect(r.rows[0].caution).toBe(true);
  }
});

it('uses the chosen session variant and never offers skipped scheduled movements as extras', () => {
  const p: typeof plan = { ...plan, activities: [{ id: 'strength', kind: 'exercise', label: 'Strength', required: true, flexible: false, tracking: { type: 'check' }, session: { exercises: [{ movement: 'press', sets: 6, reps: 10 }], short: { exercises: [{ movement: 'row', sets: 6, reps: 10 }] } } }] };
  const log: ActivityLog = { activityId: 'strength', status: 'pending', variant: 'short', count: 0, updatedAt: now, labelSnapshot: 'Strength' };
  expect(run(history, { plan: p, logs: { strength: log } })).toMatchObject({ kind: 'ready', muscle: 'chest' });
  const result = run(history, { plan: p, logs: { strength: { ...log, status: 'skipped' } } });
  if (result.kind === 'ready') expect(result.rows.map(row => row.movement)).not.toContain('row');
});

it('does not count completed scheduled work again as a pending projection', () => {
  const p: typeof plan = { ...plan, activities: [{ id: 'strength', kind: 'exercise', label: 'Strength', required: true, flexible: false, tracking: { type: 'check' }, session: { exercises: [{ movement: 'press', sets: 6, reps: 10 }] } }] };
  const result = run([...history, entry('press', date, 6)], { plan: p, logs: { strength: { activityId: 'strength', status: 'done', count: 0, updatedAt: now, labelSnapshot: 'Strength' } } });
  // All choices also involve biceps, which is recovering from secondary load: none is recommended.
  expect(result).toMatchObject({ kind: 'empty' });
});

it('optional logging/retries use the existing identity, count once, and undo restores history', async () => {
  const store = new KeyValueTrackingStore(new MemoryKeyValue());
  const r = run();
  if (r.kind !== 'ready') throw new Error('Expected recommendation');
  const action = workoutToggle(r.rows[0], date);
  if (action.kind !== 'log') throw new Error('Expected existing extra log');
  for (let i = 0; i < 2; i++) await logExercise(store, { id: action.id, movement: r.rows[0].movement, date, at: now, ...action.dose }, inventory);
  expect(await store.exerciseLogs({ from: date, to: date })).toHaveLength(1);
  expect((await loadExerciseHistory(store, plan, date)).entries).toHaveLength(1);
  expect((await store.planHistory(plan.id)).activityLogs).toHaveLength(0);
  await store.removeExerciseLog(action.id);
  expect((await loadExerciseHistory(store, plan, date)).entries).toHaveLength(0);
});
