import seed from '../../../plans/seed.plan.json';
import { addDays } from '../../plan/dates';
import type { Plan } from '../../plan/schema';
import { validatePlan } from '../../plan/validate';
import { advance, setDone, snapshotOf } from '../../prescription/completion';
import { sessionProgress, tickExercise } from '../../prescription/exercises';
import { prescribeDay } from '../../prescription/prescribe';
import { KeyValueTrackingStore, MemoryKeyValue } from '../../storage/keyValueStore';
import type { ActivityLog, TrackingStore } from '../../storage/types';
import { exerciseState, loadExerciseHistory, logExercise, reportMuscle } from '../state';

/** #56 step 4: history from the store (sessions, conditioning, free logs) feeds coverage, suggestions and session order. */

const plan: Plan = (() => {
  const r = validatePlan(seed);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.plan;
})();
const MON = '2026-11-02'; // strength day (resistance), home
const at = (date: string, hhmm: string) => `${date}T${hhmm}:00+11:00`;

/** Do what the app does for one completion: prescribe the day, apply the change, store state + event + snapshot together. */
async function complete(store: TrackingStore, date: string, activityId: string, now: string, apply: (ctx: any, item: any) => { log: ActivityLog | null; event: any }) {
  const day = await store.getDay(plan.id, date);
  const p = prescribeDay(plan, date, day);
  const item = p.items.find((i) => i.key === activityId || i.options.some((o) => o.id === activityId))!;
  const c = apply({ planId: plan.id, date, now, current: day.activities[activityId], item }, item);
  const next = { ...day, activities: { ...day.activities, ...(c.log ? { [activityId]: c.log } : {}) } };
  await store.logCompletion(plan.id, date, activityId, c.log, c.event, snapshotOf(prescribeDay(plan, date, next), plan.id, plan.revision, now));
}
const strength = plan.activities.find((a) => a.id === 'resistance')!;
const tick = (store: TrackingStore, date: string, key: string, now: string) =>
  complete(store, date, 'resistance', now, (ctx, item) => tickExercise(ctx, strength, item.session, key, true));

let store: TrackingStore;
beforeEach(() => {
  store = new KeyValueTrackingStore(new MemoryKeyValue());
});

it('#79 retries the same submitted exercise ID without duplicating volume, including a rest day', async () => {
  const input = { id: 'stable-form-submission', movement: 'kettlebell_squat', date: '2026-11-06', at: at('2026-11-06', '18:00'), sets: 2, reps: 8 };
  await logExercise(store, input); await logExercise(store, input);
  expect(await store.exerciseLogs()).toHaveLength(1);
  const state = exerciseState(plan, await loadExerciseHistory(store, plan, input.date), { now: input.at, today: input.date });
  expect(state.restDay).toBe(true);
  expect(state.coverage.find(m => m.muscle === 'quadriceps')!.volume).toBe(2);
});

describe('loading history from the store', () => {
  it('session ticks carry the prescribed dose (from the day snapshot) and their tick time', async () => {
    await tick(store, MON, 'full:0:kettlebell_squat', at(MON, '07:10'));
    await tick(store, MON, 'full:1:chest_press', at(MON, '07:20'));
    const { entries } = await loadExerciseHistory(store, plan, MON);
    expect(entries.map((e) => [e.movement, e.sets, e.reps, e.at, e.source])).toEqual([
      ['kettlebell_squat', 3, 10, at(MON, '07:10'), 'session'],
      ['chest_press', 3, 10, at(MON, '07:20'), 'session'],
    ]);
  });

  it('a workout marked done as a whole counts every exercise of its version', async () => {
    await complete(store, MON, 'resistance', at(MON, '18:00'), (ctx) => setDone(ctx, strength, true));
    const { entries } = await loadExerciseHistory(store, plan, MON);
    expect(entries.map((e) => e.movement)).toEqual(['kettlebell_squat', 'chest_press', 'lat_pulldown', 'one_arm_kettlebell_row', 'hammer_curl']);
  });

  it('conditioning activities count once, by rounds or by their planned minutes', async () => {
    const vr = plan.activities.find((a) => a.id === 'vr-boxing')!;
    for (const m of ['19:00', '19:04', '19:08']) await complete(store, MON, 'vr-boxing', at(MON, m), (ctx) => advance(ctx, vr));
    const bag = plan.activities.find((a) => a.id === 'heavy-bag')!;
    await complete(store, addDays(MON, 1), 'heavy-bag', at(addDays(MON, 1), '19:00'), (ctx) => advance(ctx, bag));
    const { entries } = await loadExerciseHistory(store, plan, addDays(MON, 1));
    expect(entries.map((e) => [e.movement, e.sets, e.minutes, e.source])).toEqual([
      ['vr_boxing', 3, undefined, 'activity'], // rounds; no planned duration: the default round length applies
      ['heavy_bag', 1, 12, 'activity'],
    ]);
  });

  it('a skipped conditioning activity counts nothing', async () => {
    const ropes = plan.activities.find((a) => a.id === 'battle-ropes')!;
    await complete(store, MON, 'battle-ropes', at(MON, '19:00'), (ctx) => setDone(ctx, ropes, true));
    await complete(store, MON, 'battle-ropes', at(MON, '19:01'), (ctx) => setDone(ctx, ropes, false));
    expect((await loadExerciseHistory(store, plan, MON)).entries).toEqual([]);
  });

  it('free logs, session ticks and conditioning on the same day are each counted once; reloading changes nothing', async () => {
    await tick(store, MON, 'full:1:chest_press', at(MON, '07:20'));
    await logExercise(store, { movement: 'chest_press', date: MON, at: at(MON, '20:00'), sets: 2, reps: 12 });
    const once = await loadExerciseHistory(store, plan, MON);
    expect(once.entries.map((e) => `${e.source}:${e.movement}`)).toEqual(['free:chest_press', 'session:chest_press']);
    expect(await loadExerciseHistory(store, plan, MON)).toEqual(once);
  });

  it('older days without structured snapshots fall back to the plan’s doses; legacy cable-row ticks are kept but not counted', async () => {
    await store.setActivity(plan.id, MON, 'resistance', {
      activityId: 'resistance', status: 'pending', count: 0, labelSnapshot: 'Strength workout', updatedAt: at(MON, '08:00'), variant: 'full',
      exercisesDone: ['full:0:kettlebell_squat', 'full:3:cable_row'],
    });
    const { entries } = await loadExerciseHistory(store, plan, MON);
    expect(entries.map((e) => [e.movement, e.sets])).toEqual([['kettlebell_squat', 3]]);
    expect((await store.getDay(plan.id, MON)).activities.resistance.exercisesDone).toContain('full:3:cable_row'); // data intact
  });

  it('reads only the last 60 days', async () => {
    await logExercise(store, { movement: 'plank', date: addDays(MON, -61), at: at(addDays(MON, -61), '07:00'), sets: 2, seconds: 30 });
    await logExercise(store, { movement: 'plank', date: addDays(MON, -60), at: at(addDays(MON, -60), '07:00'), sets: 2, seconds: 30 });
    expect((await loadExerciseHistory(store, plan, MON)).entries).toHaveLength(1);
  });
});

describe('logging and reports', () => {
  it('only inventory movements and whole sets can be logged', async () => {
    await expect(logExercise(store, { movement: 'biceps_curl', date: MON, at: at(MON, '07:00'), sets: 3 })).rejects.toThrow(/not in the exercise inventory/);
    await expect(logExercise(store, { movement: 'plank', date: MON, at: at(MON, '07:00'), sets: 0 })).rejects.toThrow(/sets/);
  });

  it('a report makes the muscle unavailable until cleared', async () => {
    const id = await reportMuscle(store, 'shoulders', 'sore', at(MON, '07:00'));
    const now = { now: at(MON, '12:00'), today: MON };
    const status = async () => exerciseState(plan, await loadExerciseHistory(store, plan, MON), now).coverage.find((c) => c.muscle === 'shoulders')!.status;
    expect(await status()).toBe('unavailable');
    await store.clearMuscleReport(id, at(MON, '11:00'));
    expect(await status()).not.toBe('unavailable');
    await expect(reportMuscle(store, 'neck', 'sore', at(MON, '07:00'))).rejects.toThrow(/not a muscle group/);
  });
});

describe('exercise state', () => {
  const FRI = '2026-11-06';
  const todaySessions = (date: string) =>
    prescribeDay(plan, date, { activities: {}, dayTypeOverride: null, observations: [], quickLogs: [] })
      .items.filter((i) => i.session)
      .map((i) => ({ activityId: i.key, session: i.session! }));

  it('Friday is a rest day; exercise can still be logged and counts', async () => {
    await logExercise(store, { movement: 'standing_calf_raise', date: FRI, at: at(FRI, '07:00'), sets: 3, reps: 15 });
    const s = exerciseState(plan, await loadExerciseHistory(store, plan, FRI), { now: at(FRI, '12:00'), today: FRI });
    expect(s.restDay).toBe(true);
    expect(s.coverage.find((c) => c.muscle === 'calves')!.volume).toBe(3);
    expect(exerciseState(plan, { entries: [], reports: [] }, { now: at('2026-11-05', '12:00'), today: '2026-11-05' }).restDay).toBe(false); // Thursday
  });

  it('first use: today’s session keeps the plan order', async () => {
    const s = exerciseState(plan, await loadExerciseHistory(store, plan, MON), { now: at(MON, '06:00'), today: MON, todaySessions: todaySessions(MON) });
    expect(s.enoughHistory).toBe(false);
    expect(s.sessionOrders.resistance).toEqual({ full: [0, 1, 2, 3, 4], short: [0, 1, 2] });
  });

  it('with history, the order follows priority, and ticking today never reshuffles it', async () => {
    // Two weeks ago something was logged (history long enough); last Thursday chest was trained hard.
    await logExercise(store, { movement: 'plank', date: addDays(MON, -14), at: at(addDays(MON, -14), '07:00'), sets: 1, seconds: 30 });
    await logExercise(store, { movement: 'chest_press', date: addDays(MON, -4), at: at(addDays(MON, -4), '07:00'), sets: 6, reps: 10 });
    const state = async (now: string) => exerciseState(plan, await loadExerciseHistory(store, plan, MON), { now, today: MON, todaySessions: todaySessions(MON) });
    const before = (await state(at(MON, '06:00'))).sessionOrders.resistance.full!;
    const labels = before.map((i) => strength.session!.exercises[i].movement);
    expect(labels.indexOf('chest_press')).toBe(labels.length - 1); // chest is at target: last
    await tick(store, MON, `full:${before[0]}:${labels[0]}`, at(MON, '07:00'));
    expect((await state(at(MON, '07:05'))).sessionOrders.resistance.full).toEqual(before);
    // The order is display only: keys and ticks are unchanged.
    const progress = sessionProgress(strength.session! as any, (await store.getDay(plan.id, MON)).activities.resistance, { full: before });
    expect(progress.rows.at(-1)).toMatchObject({ key: `full:${before[0]}:${labels[0]}`, done: true });
    expect(progress.next!.exercise.movement).toBe(labels[1]);
  });

  it('suggestions use the configured equipment and never include conditioning or avoided movements', async () => {
    const s = exerciseState(plan, await loadExerciseHistory(store, plan, MON), { now: at(MON, '06:00'), today: MON });
    const moves = s.suggestions.map((x) => x.exercise.movement);
    expect(moves).not.toEqual(expect.arrayContaining(['vr_boxing']));
    expect(moves).not.toContain('leg_extension'); // legacy multi-gym stations need explicit confirmation
    expect(moves).toContain('kettlebell_squat');
    expect(moves).not.toContain('biceps_curl');
  });
});
