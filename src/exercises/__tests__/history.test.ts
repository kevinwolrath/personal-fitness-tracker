import example from '../../../fixtures/plans/prescription-example.plan.json';
import { validatePlan } from '../../plan/validate';
import { snapshotOf } from '../../prescription/completion';
import { prescribeDay } from '../../prescription/prescribe';
import type { PrescribedSession } from '../../prescription/session';
import type { ActivityLog, CompletionEvent, DayRecords } from '../../storage/types';
import { muscleCoverage } from '../coverage';
import { freeLogEntry, sessionEntries, snapshotSession } from '../history';
import { exerciseInventory } from '../inventory';

/** #56: every completed exercise feeds muscle history once, whether ticked in a session or logged on its own. */

const DATE = '2026-11-02';
const session: PrescribedSession = {
  minutes: 35,
  exercises: [
    { movement: 'kettlebell_squat', label: 'Goblet squat', sets: 3, reps: 10 },
    { movement: 'chest_press', label: 'Chest press', sets: 3, reps: 10 },
    { movement: 'plank', label: 'Plank', sets: 2, seconds: 30 },
    { movement: 'biceps_curl', label: 'Biceps curl', sets: 2, reps: 12, avoid: true },
  ],
  short: { minutes: 10, exercises: [{ movement: 'kettlebell_squat', label: 'Goblet squat', sets: 2, reps: 10 }] },
};
const log = (over: Partial<ActivityLog>): ActivityLog => ({ activityId: 'strength', status: 'pending', count: 0, labelSnapshot: 'Strength', updatedAt: `${DATE}T09:00:00+11:00`, ...over });
const tick = (label: string, at: string, action: CompletionEvent['action'] = 'tick'): CompletionEvent => ({
  id: `${label}${at}`, planId: 'p', date: DATE, activityId: 'strength', requirementId: null, action, count: 0, variant: 'full', label, purpose: 'strength', at,
});
const entries = (l: ActivityLog, events: CompletionEvent[] = []) => sessionEntries({ planId: 'p', date: DATE, activityId: 'strength', log: l, session, events });

describe('session ticks', () => {
  it('each ticked exercise is one entry with its prescribed dose and its tick time', () => {
    const e = entries(log({ exercisesDone: ['full:0:kettlebell_squat', 'full:2:plank'] }), [
      tick('Goblet squat', `${DATE}T07:10:00+11:00`),
      tick('Goblet squat', `${DATE}T07:12:00+11:00`, 'untick'),
      tick('Goblet squat', `${DATE}T07:15:00+11:00`),
    ]);
    expect(e).toEqual([
      { id: 'session|p|2026-11-02|strength|full:0:kettlebell_squat', movement: 'kettlebell_squat', date: DATE, at: `${DATE}T07:15:00+11:00`, sets: 3, reps: 10, source: 'session' },
      { id: 'session|p|2026-11-02|strength|full:2:plank', movement: 'plank', date: DATE, at: `${DATE}T09:00:00+11:00`, sets: 2, seconds: 30, source: 'session' },
    ]);
  });

  it('a workout marked done as a whole counts every exercise of its version, except "avoid" ones never prescribed to do', () => {
    expect(entries(log({ status: 'done' })).map((e) => e.movement)).toEqual(['kettlebell_squat', 'chest_press', 'plank']);
  });

  it('the short version counts its own exercises and doses', () => {
    expect(entries(log({ status: 'done', variant: 'short' }))).toEqual([expect.objectContaining({ movement: 'kettlebell_squat', sets: 2, id: expect.stringContaining('short:0:') })]);
  });

  it('nothing ticked, nothing counted; ids are stable, so reading twice never double counts', () => {
    expect(entries(log({}))).toEqual([]);
    const l = log({ status: 'done' });
    const once = muscleCoverage({ inventory: exerciseInventory, entries: entries(l), now: `${DATE}T20:00:00+11:00`, today: DATE });
    const twice = muscleCoverage({ inventory: exerciseInventory, entries: [...entries(l), ...entries(l)], now: `${DATE}T20:00:00+11:00`, today: DATE });
    expect(twice).toEqual(once);
  });
});

describe('free logs', () => {
  it('become entries of their own source; null fields are left out', () => {
    expect(freeLogEntry({ id: 'x', movement: 'standing_calf_raise', date: DATE, at: `${DATE}T12:00:00+11:00`, sets: 3, reps: 15, seconds: null, intensity: null })).toEqual({
      id: 'free|x', movement: 'standing_calf_raise', date: DATE, at: `${DATE}T12:00:00+11:00`, sets: 3, reps: 15, source: 'free',
    });
  });

  it('a session tick and a free log of the same exercise are two separate completions, never merged', () => {
    const s = entries(log({ exercisesDone: ['full:1:chest_press'] }));
    const f = freeLogEntry({ id: 'y', movement: 'chest_press', date: DATE, at: `${DATE}T18:00:00+11:00`, sets: 3, reps: 10, seconds: null, intensity: null });
    expect(new Set([...s, f].map((e) => e.id)).size).toBe(2);
  });
});

describe('day snapshots keep the doses that were prescribed', () => {
  const plan = (() => {
    const r = validatePlan(example);
    if (!r.ok) throw new Error(r.errors.join('\n'));
    return r.plan;
  })();
  const records: DayRecords = { activities: {}, dayTypeOverride: null, observations: [], quickLogs: [] };

  it('a new snapshot gives back the prescribed session, with doses and the short version', () => {
    const p = prescribeDay(plan, DATE, records);
    const snap = snapshotOf(p, plan.id, plan.revision, `${DATE}T10:00:00+11:00`);
    const s = snapshotSession(snap.prescribed, 'strength')!;
    const prescribed = p.items.find((i) => i.key === 'strength')!.session!;
    expect(s.exercises.map((e) => [e.movement, e.sets, e.reps])).toEqual(prescribed.exercises.map((e) => [e.movement, e.sets, e.reps]));
    expect(s.exercises.find((e) => e.movement === 'hammer_curl')!.substitutedFor).toBe('Biceps curl');
  });

  it('older snapshots (dose text only) and missing sessions return null: the caller uses the plan in effect', () => {
    const old = { items: [{ key: 'strength', session: { minutes: 25, exercises: [{ movement: 'chest_press', label: 'Chest press', dose: '3 × 10', substitutedFor: null }] } }] };
    expect(snapshotSession(old, 'strength')).toBeNull();
    expect(snapshotSession(old, 'other')).toBeNull();
    expect(snapshotSession(null, 'strength')).toBeNull();
  });
});
