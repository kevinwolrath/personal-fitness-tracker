import { setEquipmentSelection } from '../../equipment/catalogue';
import example from '../../../fixtures/plans/prescription-example.plan.json';
import seed from '../../../plans/seed.plan.json';
import type { Plan } from '../../plan/schema';
import { validatePlan } from '../../plan/validate';
import { setDone, setSkipped } from '../../prescription/completion';
import { chooseVariant, tickExercise } from '../../prescription/exercises';
import { prescribeDay } from '../../prescription/prescribe';
import { KeyValueTrackingStore, MemoryKeyValue } from '../../storage/keyValueStore';
import type { ActivityLog, DayRecords, ExerciseLog } from '../../storage/types';
import { exerciseState, loadExerciseHistory, logExercise } from '../state';
import { doseFor, oneTapLogId, todayWorkout, workoutToggle, type WorkoutStateInput } from '../todayWorkout';

/** #56 layout A: Today's workout lists every eligible strength exercise plus today's plan, with counts and one-tap ticks. */

const load = (raw: unknown): Plan => {
  const r = validatePlan(raw);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.plan;
};
const confirmedSeed = { ...seed, formatVersion: 9, exercise: { ...seed.exercise, equipment: setEquipmentSelection(seed.exercise.equipment as any, ['multi_gym_chest_press', 'multi_gym_lat_pulldown', 'multi_gym_leg_extension'], true) } };
const plan = load(confirmedSeed);
const MON = '2026-11-02'; // strength (resistance) day
const TUE = '2026-11-03'; // no strength in the plan
const FRI = '2026-11-06'; // configured rest day
const records = (activities: Record<string, ActivityLog> = {}): DayRecords => ({ activities, dayTypeOverride: null, observations: [], quickLogs: [] });
const free = (movement: string, id = `f-${movement}`, date = MON): ExerciseLog => ({ id, movement, date, at: `${date}T12:00:00+11:00`, sets: 3, reps: 10, seconds: null, intensity: null });

function workout(date: string, opts: { logs?: Record<string, ActivityLog>; freeLogs?: ExerciseLog[]; state?: WorkoutStateInput | null; p?: Plan } = {}) {
  const p = opts.p ?? plan;
  const prescription = prescribeDay(p, date, records(opts.logs ?? {}));
  return todayWorkout({ plan: p, date, items: prescription.items, logs: opts.logs ?? {}, freeLogs: opts.freeLogs ?? [], state: opts.state ?? null, restDay: (p.exercise?.restDays ?? []).includes('fri') && date === FRI });
}
const strength = plan.activities.find((a) => a.id === 'resistance')!;
const sessionItem = () => prescribeDay(plan, MON, records()).items.find((i) => i.key === 'resistance')!;
const ctx = (current?: ActivityLog) => ({ planId: plan.id, date: MON, now: `${MON}T08:00:00+11:00`, current, item: sessionItem() });

describe('what is listed', () => {
  it('every eligible strength exercise, plus today’s planned ones; never conditioning', () => {
    const w = workout(MON);
    expect(w.total).toBe(21); // the seed owns every piece of equipment: all 13 strength exercises
    expect(w.rows.map((r) => r.movement)).not.toEqual(expect.arrayContaining(['vr_boxing']));
    expect(w.rows.filter((r) => r.plan).map((r) => r.movement)).toEqual(['kettlebell_squat', 'chest_press', 'lat_pulldown', 'one_arm_kettlebell_row', 'hammer_curl']);
  });

  it('days without strength in the plan still list the whole inventory, none of it planned', () => {
    const w = workout(TUE);
    expect(w.total).toBe(21);
    expect(w.rows.some((r) => r.plan)).toBe(false);
    expect(w.sessions).toEqual([]);
  });

  it('no equipment configured: bodyweight only; an avoided movement is never offered; plan exercises are always listed', () => {
    const bare = load({ ...seed, exercise: { ...seed.exercise, equipment: [], limitations: [{ movement: 'plank', status: 'avoid' }] } });
    const w = workout(TUE, { p: bare });
    expect(w.rows.map((r) => r.movement).sort()).toEqual(['bodyweight_squat', 'dead_bug', 'glute_bridge', 'knuckle_push_up', 'reverse_lunge', 'standing_calf_raise', 'straight_leg_raise']);
    expect(workout(MON, { p: bare }).rows.filter((r) => r.plan)).toHaveLength(5); // the plan still prescribes its session
  });

  it('no standard biceps curl; hammer curls present; caution is carried', () => {
    const w = workout(TUE, { p: load({ ...seed, exercise: { ...seed.exercise, limitations: [...seed.exercise.limitations, { movement: 'overhead_press', status: 'caution' }] } }) });
    expect(w.rows.map((r) => r.movement)).not.toContain('biceps_curl');
    expect(w.rows.map((r) => r.movement)).toContain('hammer_curl');
    expect(w.rows.find((r) => r.movement === 'overhead_press')!.caution).toBe(true);
  });

  it('a skipped session is not prescribed: its exercises become ordinary rows', () => {
    const skipped = setSkipped(ctx(), true);
    expect(workout(MON, { logs: { resistance: skipped.log! } }).rows.some((r) => r.plan)).toBe(false);
  });
});

describe('guides', () => {
  it('a planned row carries its prescribed exercise: substitution and caution reach the guide', () => {
    const ex = load(example);
    const items = prescribeDay(ex, MON, records()).items;
    const w = todayWorkout({ plan: ex, date: MON, items, logs: {}, freeLogs: [], state: null });
    const curl = w.rows.find((r) => r.movement === 'hammer_curl')!;
    expect(curl.prescribed).toMatchObject({ movement: 'hammer_curl', substitutedFor: 'Biceps curl' });
    expect(w.rows.find((r) => r.movement === 'overhead_press')).toMatchObject({ caution: true, prescribed: expect.objectContaining({ caution: true }) });
    expect(workout(TUE).rows.every((r) => r.prescribed === null)).toBe(true);
  });
});

describe('doses', () => {
  it('today’s prescribed dose wins, then the plan’s dose anywhere, then the inventory default', () => {
    const w = workout(MON);
    expect(w.rows.find((r) => r.movement === 'hammer_curl')!.doseLabel).toBe('2 × 12'); // today's session
    expect(workout(TUE).rows.find((r) => r.movement === 'chest_press')!.doseLabel).toBe('3 × 10'); // the plan's session
    expect(w.rows.find((r) => r.movement === 'standing_calf_raise')!.doseLabel).toBe('3 × 15'); // inventory default
    expect(w.rows.find((r) => r.movement === 'plank')!.doseLabel).toBe('1 × 20 s');
    expect(doseFor('unknown_move', plan)).toEqual({ sets: 1 });
  });

  it('the short version prescribes its own doses and exercises', () => {
    const short = chooseVariant(ctx(), strength, sessionItem().session!, 'short')!;
    const logs = { resistance: short.log! };
    const w = workout(MON, { logs });
    expect(w.rows.filter((r) => r.plan).map((r) => [r.movement, r.doseLabel])).toEqual([
      ['kettlebell_squat', '2 × 10'], ['chest_press', '2 × 10'], ['one_arm_kettlebell_row', '2 × 10'],
    ]);
    expect(w.total).toBe(21); // the inventory stays complete whichever version is chosen
  });
});

describe('done, counts and order', () => {
  it('counts follow session ticks and free logs; done rows go to the bottom in the same order', () => {
    const t = tickExercise(ctx(), strength, sessionItem().session!, 'full:1:chest_press', true);
    const w = workout(MON, { logs: { resistance: t.log! }, freeLogs: [free('plank')] });
    expect([w.total, w.done, w.remaining]).toEqual([21, 2, 19]);
    expect(w.rows.slice(-2).map((r) => [r.movement, r.doneBy])).toEqual([['chest_press', 'session'], ['plank', 'free']]);
    expect(w.next!.movement).toBe('kettlebell_squat');
  });

  it('a workout marked done as a whole marks all its exercises done', () => {
    const d = setDone(ctx(), strength, true);
    expect(workout(MON, { logs: { resistance: d.log! } }).done).toBe(5);
  });

  it('first use (no history): planned exercises first in plan order, then the rest', () => {
    const order = workout(MON).rows.map((r) => r.movement);
    expect(order.slice(0, 5)).toEqual(['kettlebell_squat', 'chest_press', 'lat_pulldown', 'one_arm_kettlebell_row', 'hammer_curl']);
  });

  it('with history: the frozen day order decides, and ticking never reshuffles the remaining rows', () => {
    const dayOrder = ['standing_calf_raise', 'kettlebell_romanian_deadlift', 'chest_press', 'plank'];
    const state: WorkoutStateInput = { coverage: [], dayOrder, priorityOrder: true, restDay: false };
    const before = workout(TUE, { state }).rows.map((r) => r.movement);
    expect(before.slice(0, 4)).toEqual(dayOrder);
    const after = workout(TUE, { state, freeLogs: [free('kettlebell_romanian_deadlift', 'x', TUE)] }).rows.map((r) => r.movement);
    expect(after.filter((m) => m !== 'kettlebell_romanian_deadlift')).toEqual(before.filter((m) => m !== 'kettlebell_romanian_deadlift'));
    expect(after.at(-1)).toBe('kettlebell_romanian_deadlift');
  });
});

describe('statuses', () => {
  const c = (muscle: string, status: string, report: 'sore' | 'injured' | null = null) => ({ muscle, label: muscle, status, volume: 0, target: 6, recoveredAt: null, lastTrainedAt: null, report }) as any;

  it('due, building, trained, recovering and reports; neutral muscles show nothing (no red on first use)', () => {
    const state: WorkoutStateInput = {
      coverage: [c('calves', 'red'), c('hip_flexors', 'amber'), c('chest', 'green'), c('quadriceps', 'recovering'), c('shoulders', 'unavailable', 'injured'), c('hamstrings', 'unknown')],
      dayOrder: [], priorityOrder: false, restDay: false,
    };
    const s = Object.fromEntries(workout(TUE, { state }).rows.map((r) => [r.movement, r.status]));
    expect(s).toMatchObject({ standing_calf_raise: 'due', straight_leg_raise: 'building', chest_press: 'trained', leg_extension: 'recovering', overhead_press: 'injured' });
    expect(s.kettlebell_romanian_deadlift).toBeNull(); // hamstrings unknown, glutes not given
  });

  it('Friday rest day: nothing is due, everything stays listed and tickable', () => {
    const state: WorkoutStateInput = { coverage: [c('calves', 'red')], dayOrder: [], priorityOrder: false, restDay: true };
    const w = workout(FRI, { state });
    expect(w.restDay).toBe(true);
    expect(w.rows.find((r) => r.movement === 'standing_calf_raise')!.status).toBeNull();
    expect(w.total).toBe(21);
    expect(workoutToggle(w.rows[0], FRI).kind).toBe('log');
  });
});

describe('one tap', () => {
  it('a planned exercise ticks its session; anything else logs its dose under a fixed id; untick undoes the record', () => {
    const w = workout(MON);
    const squat = w.rows.find((r) => r.movement === 'kettlebell_squat')!;
    expect(workoutToggle(squat, MON)).toEqual({ kind: 'session', activityId: 'resistance', key: 'full:0:kettlebell_squat', ticked: true });
    const calf = w.rows.find((r) => r.movement === 'standing_calf_raise')!;
    expect(workoutToggle(calf, MON)).toEqual({ kind: 'log', id: oneTapLogId(MON, 'standing_calf_raise'), dose: { sets: 3, reps: 15 } });
    const loggedTwice = workout(MON, { freeLogs: [free('standing_calf_raise', 'a'), free('standing_calf_raise', 'b')] }).rows.find((r) => r.movement === 'standing_calf_raise')!;
    expect(workoutToggle(loggedTwice, MON)).toEqual({ kind: 'unlog', ids: ['a', 'b'] });
  });

  it('a planned exercise also logged freely is done; unticking removes the free log, not a session tick that was never made', () => {
    const row = workout(MON, { freeLogs: [free('chest_press')] }).rows.find((r) => r.movement === 'chest_press')!;
    expect(row).toMatchObject({ done: true, doneBy: 'free' });
    expect(workoutToggle(row, MON)).toEqual({ kind: 'unlog', ids: ['f-chest_press'] });
  });

  it('the one-tap id is per day and movement: a repeated tap stores one record; a new day is a new record', async () => {
    const store = new KeyValueTrackingStore(new MemoryKeyValue());
    for (let i = 0; i < 2; i++) await logExercise(store, { id: oneTapLogId(MON, 'plank'), movement: 'plank', date: MON, at: `${MON}T07:0${i}:00+11:00`, sets: 1, seconds: 20 });
    expect(await store.exerciseLogs()).toHaveLength(1);
    expect(oneTapLogId(TUE, 'plank')).not.toBe(oneTapLogId(MON, 'plank'));
    // It counts once in muscle history too.
    const h = await loadExerciseHistory(store, plan, MON);
    expect(h.entries.filter((e) => e.movement === 'plank')).toHaveLength(1);
  });

  it('rollover: yesterday’s logs don’t make today’s rows done', () => {
    const w = todayWorkout({ plan, date: TUE, items: prescribeDay(plan, TUE, records()).items, logs: {}, freeLogs: [], state: null });
    expect(w.done).toBe(0);
  });
});

describe('engine order for the day', () => {
  it('exerciseState gives a frozen, eligible, strength-only day order and whether priority decides', async () => {
    const store = new KeyValueTrackingStore(new MemoryKeyValue());
    const s = exerciseState(plan, await loadExerciseHistory(store, plan, MON), { now: `${MON}T08:00:00+11:00`, today: MON });
    expect(s.priorityOrder).toBe(false);
    expect(s.dayOrder).toHaveLength(21);
    expect(s.dayOrder).not.toContain('vr_boxing');
  });
});

describe('#90: counts are today’s prescription; extras are separate', () => {
  it('Monday counts the 5 prescribed exercises, not the 21-exercise catalogue', () => {
    const w = workout(MON);
    expect(w.plan).toEqual({ total: 5, done: 0, remaining: 5 });
    expect(w.extras).toEqual({ available: 16, done: 0 });
  });

  it('ticks move the plan count; a free-logged extra never changes "of 5"', () => {
    let log: ActivityLog | undefined;
    for (const key of ['full:0:kettlebell_squat', 'full:1:chest_press']) log = tickExercise(ctx(log), strength, sessionItem().session!, key, true).log ?? undefined;
    const w = workout(MON, { logs: { resistance: log! }, freeLogs: [free('kettlebell_romanian_deadlift')] });
    expect(w.plan).toEqual({ total: 5, done: 2, remaining: 3 });
    expect(w.extras).toEqual({ available: 16, done: 1 });
  });

  it('all done: 5 of 5; the short version counts its own exercises', () => {
    const done = setDone(ctx(), strength, true).log!;
    expect(workout(MON, { logs: { resistance: done } }).plan).toEqual({ total: 5, done: 5, remaining: 0 });
    const short = chooseVariant(ctx(), strength, sessionItem().session!, 'short')!.log!;
    expect(workout(MON, { logs: { resistance: short } }).plan).toEqual({ total: 3, done: 0, remaining: 3 });
  });

  it('a day with no strength session prescribes nothing: 0 planned, the whole catalogue as extras', () => {
    expect(workout(TUE).plan).toEqual({ total: 0, done: 0, remaining: 0 });
    expect(workout(TUE).extras.available).toBe(21);
  });

  it('a skipped session prescribes nothing that day', () => {
    const skipped = setSkipped(ctx(), true).log!;
    expect(workout(MON, { logs: { resistance: skipped } }).plan.total).toBe(0);
  });
});
