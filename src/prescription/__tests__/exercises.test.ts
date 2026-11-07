import seed from '../../../plans/seed.plan.json';
import { validatePlan } from '../../plan/validate';
import type { ActivityLog, DayRecords } from '../../storage/types';
import { setDone } from '../completion';
import { chooseVariant, sessionProgress, switchNeedsConfirm, tickExercise } from '../exercises';
import { nextAction } from '../nextAction';
import { prescribeDay } from '../prescribe';

const r = validatePlan(seed);
if (!r.ok) throw new Error('seed invalid');
const plan = r.plan;
const MON = '2026-11-02';
const records = (log?: ActivityLog): DayRecords => ({ activities: log ? { resistance: log } : {}, dayTypeOverride: null, observations: [], quickLogs: [] });
const item = (log?: ActivityLog) => prescribeDay(plan, MON, records(log)).items.find((i) => i.key === 'resistance')!;
const activity = plan.activities.find((a) => a.id === 'resistance')!;
const session = item().session!;
const ctx = (log?: ActivityLog) => ({ planId: plan.id, date: MON, now: '2026-11-02T10:00:00+11:00', current: log, item: item(log) });

/** Tick exercises of the current version in order, threading the log through like the app does. */
function tickAll(log: ActivityLog | undefined, n: number) {
  const changes = [];
  for (let i = 0; i < n; i++) {
    const p = sessionProgress(session, log);
    const c = tickExercise(ctx(log), activity, session, p.next!.key, true);
    changes.push(c);
    log = c.log ?? undefined;
  }
  return { log, changes };
}

it('starts on the full version with nothing ticked; next is the first exercise', () => {
  const p = sessionProgress(session, undefined);
  expect(p).toMatchObject({ variant: 'full', hasShort: true, minutes: 35, done: 0, total: 5, complete: false });
  expect(p.next!.exercise.label).toBe('Kettlebell squat');
});

it('ticking records a tick event and moves "next" on; the workout stays one pending item', () => {
  const { log, changes } = tickAll(undefined, 2);
  expect(changes.map((c) => [c.event.action, c.event.label])).toEqual([['tick', 'Kettlebell squat'], ['tick', 'Chest press (Fortis)']]);
  expect(log).toMatchObject({ status: 'pending', variant: 'full', exercisesDone: ['full:0:kettlebell_squat', 'full:1:chest_press'] });
  expect(sessionProgress(session, log).next!.exercise.label).toBe('Lat pulldown (Fortis)');
  const day = prescribeDay(plan, MON, records(log));
  expect(day.items.find((i) => i.key === 'resistance')!.state).toBe('partial');
  expect(day.progress.total).toBe(prescribeDay(plan, MON, records()).progress.total); // still one item
});

it('the last tick completes the workout (one "complete" event) and "Do this next" moves on', () => {
  const { log, changes } = tickAll(undefined, 5);
  expect(changes.at(-1)!.event).toMatchObject({ action: 'complete', label: 'Strength workout', variant: 'full' });
  expect(log!.status).toBe('done');
  const next = nextAction(prescribeDay(plan, MON, records(log)), 10 * 60);
  expect(next?.item.key).not.toBe('resistance');
});

it('unticking a completed workout reopens it, with an "undo" event; other ticks stay', () => {
  const { log } = tickAll(undefined, 5);
  const c = tickExercise(ctx(log), activity, session, 'full:2:lat_pulldown', false);
  expect(c.event.action).toBe('undo');
  expect(c.log).toMatchObject({ status: 'pending' });
  expect(c.log!.exercisesDone).toHaveLength(4);
  expect(sessionProgress(session, c.log!).next!.exercise.label).toBe('Lat pulldown (Fortis)');
});

it('a workout marked done as a whole shows every exercise done, and unticking one makes the rest explicit', () => {
  const whole = setDone(ctx(), activity, true).log!;
  expect(sessionProgress(session, whole)).toMatchObject({ done: 5, complete: true, next: null });
  const c = tickExercise(ctx(whole), activity, session, 'full:4:hammer_curl', false);
  expect(c.log).toMatchObject({ status: 'pending', exercisesDone: ['full:0:kettlebell_squat', 'full:1:chest_press', 'full:2:lat_pulldown', 'full:3:one_arm_kettlebell_row'] });
});

it('short is an explicit choice, never inferred: ticking the short exercises within the full version does not complete it', () => {
  // The short version is squat, chest press, one-arm row: a subset of the full one.
  let log: ActivityLog | undefined;
  for (const key of ['full:0:kettlebell_squat', 'full:1:chest_press', 'full:3:one_arm_kettlebell_row']) log = tickExercise(ctx(log), activity, session, key, true).log!;
  expect(log!.status).toBe('pending');

  const short = chooseVariant(ctx(), activity, session, 'short')!;
  expect(short.event).toMatchObject({ action: 'switch', variant: 'short' });
  expect(sessionProgress(session, short.log!)).toMatchObject({ variant: 'short', minutes: 10, total: 3, done: 0 });
  const { log: done, changes } = tickAll(short.log!, 3);
  expect(done).toMatchObject({ status: 'done', variant: 'short' });
  expect(changes.at(-1)!.event).toMatchObject({ action: 'complete', variant: 'short' });
});

it('ticks are kept per version: switching shows the other version’s own ticks, and switching back restores them', () => {
  const { log: two } = tickAll(undefined, 2); // full: squat + chest press
  expect(switchNeedsConfirm(session, two)).toBe(true);
  const toShort = chooseVariant(ctx(two), activity, session, 'short')!.log!;
  expect(sessionProgress(session, toShort).done).toBe(0); // short doses differ: nothing carried over
  const back = chooseVariant(ctx(toShort), activity, session, 'full')!.log!;
  expect(sessionProgress(session, back).done).toBe(2);
  expect(switchNeedsConfirm(session, undefined)).toBe(false);
  expect(chooseVariant(ctx(), activity, session, 'full')).toBeNull(); // already full: nothing to record
});
it('#79 completed rows move down without changing frozen order or original tick keys', () => {
  const order = { full: [4, 2, 0, 1, 3] };
  const first = sessionProgress(session, undefined, order);
  const key = first.rows[0].key;
  const changed = tickExercise(ctx(), activity, session, key, true).log!;
  const next = sessionProgress(session, changed, order);
  expect(next.rows.map(r => r.key)).toEqual([...first.rows.slice(1).map(r => r.key), key]);
  expect(next.rows.at(-1)!.done).toBe(true);
  expect(next.next!.key).toBe(first.rows[1].key);
  const undone = tickExercise(ctx(changed), activity, session, key, false).log!;
  expect(sessionProgress(session, undone, order).rows.map(r => r.key)).toEqual(first.rows.map(r => r.key));
});
