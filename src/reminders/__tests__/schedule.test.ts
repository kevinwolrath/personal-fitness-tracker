import generic from '../../../fixtures/plans/generic-example.plan.json';
import seed from '../../../plans/seed.plan.json';
import { addDays } from '../../plan/dates';
import { validatePlan } from '../../plan/validate';
import type { ActivityLog, DayRecords } from '../../storage/types';
import { HORIZON_DAYS, REMINDER_PREFIX, desiredReminders, reconcile, remindersForDay } from '../schedule';

const parse = (p: unknown) => {
  const r = validatePlan(p);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.plan;
};
const plan = parse(seed);
const MON = '2026-11-02';
const empty = (): DayRecords => ({ activities: {}, dayTypeOverride: null, observations: [], quickLogs: [] });
const withLogs = (logs: Record<string, Partial<ActivityLog>>): DayRecords => ({
  ...empty(),
  activities: Object.fromEntries(Object.entries(logs).map(([id, l]) => [id, { activityId: id, status: 'done', count: 0, labelSnapshot: id, updatedAt: 't', ...l } as ActivityLog])),
});
const week = (from = MON, records: (d: string) => DayRecords = () => empty()) =>
  Array.from({ length: HORIZON_DAYS }, (_, i) => addDays(from, i)).map((date) => ({ date, records: records(date) }));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

it('the seed reminds about lunch (11:55), snack (16:00) and dinner (18:15) — and nothing else', () => {
  const day = remindersForDay(plan, MON, empty());
  expect(day.map((r) => [r.activityId, hhmm(r.minute), r.body])).toEqual([
    ['lunch', '11:55', 'Lunch in 5 minutes'],
    ['snack', '16:00', 'Time for your snack'],
    ['dinner', '18:15', 'Dinner in 15 minutes'],
  ]);
  const ids = new Set(plan.activities.filter((a) => a.notifications?.length).map((a) => a.id));
  expect(ids.has('resistance') || ids.has('resistance-long') || ids.has('vr-boxing')).toBe(false); // no strength or VR boxing reminders
});

it('everything comes from the plan: a different plan reminds differently, with no code change', () => {
  const custom = parse({
    ...seed,
    activities: seed.activities.map((a: any) =>
      a.id === 'resistance'
        ? { ...a, time: '21:30', notifications: [{ offsetMinutes: -5, title: 'Strength', body: 'Strength workout at 9:30' }] }
        : a.kind === 'meal'
          ? { ...a, notifications: undefined }
          : a,
    ),
  });
  expect(remindersForDay(custom, MON, empty()).map((r) => [r.activityId, hhmm(r.minute)])).toEqual([['resistance', '21:25']]);
  expect(remindersForDay(custom, '2026-11-03', empty())).toEqual([]); // the workout isn't on Tuesdays
});

it('plans without reminders (older formats) schedule nothing and still load', () => {
  const g = parse(generic);
  expect(desiredReminders(g, week(), MON, 0)).toEqual([]);
});

it('done or skipped activities don’t remind; a met requirement silences its alternatives', () => {
  const p = parse({
    ...seed,
    activities: seed.activities.map((a: any) => (a.id === 'battle-ropes' ? { ...a, notifications: [{ at: '19:00', title: 'Ropes', body: 'Battle ropes' }] } : a)),
  });
  const open = remindersForDay(p, MON, empty());
  expect(open.find((r) => r.activityId === 'battle-ropes')!.status).toBe('pending');
  const recs = withLogs({ lunch: {}, snack: { status: 'skipped' }, 'heavy-bag': { requirementId: 'hard-conditioning' } });
  const day = Object.fromEntries(remindersForDay(p, MON, recs).map((r) => [r.activityId, r.status]));
  expect(day).toMatchObject({ lunch: 'done', snack: 'skipped', dinner: 'pending', 'battle-ropes': 'done' });
  expect(desiredReminders(p, [{ date: MON, records: recs }], MON, 0).map((r) => r.activityId)).toEqual(['dinner']);
});

it('only future reminders are wanted; the horizon covers the next 7 days', () => {
  const now = 12 * 60; // noon Monday: lunch (11:55) has passed
  const wanted = desiredReminders(plan, week(), MON, now);
  expect(wanted.filter((r) => r.date === MON).map((r) => r.activityId)).toEqual(['snack', 'dinner']);
  expect(new Set(wanted.map((r) => r.date)).size).toBe(HORIZON_DAYS);
  expect(wanted.every((r) => r.id.startsWith(`${REMINDER_PREFIX}|`))).toBe(true);
});

it('reconcile: no duplicates, only what changed, and never touches other apps’ notifications', () => {
  const wanted = desiredReminders(plan, week(), MON, 0);
  const first = reconcile(wanted, ['someone-else|1']);
  expect(first.cancel).toEqual([]);
  expect(first.schedule).toHaveLength(wanted.length);
  // Restart: everything already pending → nothing to do (no duplicates).
  expect(reconcile(wanted, wanted.map((r) => r.id))).toEqual({ cancel: [], schedule: [] });
  // Turning reminders off = reconciling against nothing: every one of ours is cancelled.
  expect(reconcile([], wanted.map((r) => r.id)).cancel).toHaveLength(wanted.length);
});

it('a plan change cancels the old reminders and schedules the new ones (ids carry time and wording)', () => {
  const before = desiredReminders(plan, week(), MON, 0);
  const changed = parse({
    ...seed,
    revision: seed.revision + 1,
    activities: seed.activities.map((a: any) => (a.id === 'lunch' ? { ...a, notifications: [{ offsetMinutes: -10, title: 'Lunch', body: 'Lunch in 10 minutes' }] } : a)),
  });
  const after = desiredReminders(changed, week(), MON, 0);
  const r = reconcile(after, before.map((x) => x.id));
  expect(r.cancel).toHaveLength(HORIZON_DAYS); // the old lunch reminder, every day
  expect(r.schedule.map((x) => [x.activityId, hhmm(x.minute)])).toEqual(Array(HORIZON_DAYS).fill(['lunch', '11:50']));
  // Removing a reminder from the plan cancels it.
  const removed = parse({ ...seed, activities: seed.activities.map((a: any) => (a.id === 'snack' ? { ...a, notifications: [] } : a)) });
  expect(reconcile(desiredReminders(removed, week(), MON, 0), before.map((x) => x.id)).cancel).toHaveLength(HORIZON_DAYS);
});

it('day-type overrides are respected (a reminder follows the activity onto the resolved day)', () => {
  // Thursday is an office day: no school runs, but meals still remind.
  expect(remindersForDay(plan, '2026-11-05', empty()).map((r) => r.activityId)).toEqual(['lunch', 'snack', 'dinner']);
});

it('validation: exactly one of offsetMinutes/at, and an offset needs a time or day part', () => {
  const bad = (n: object, id = 'lunch') => validatePlan({ ...seed, activities: seed.activities.map((a: any) => (a.id === id ? { ...a, notifications: [{ title: 'x', body: 'y', ...n }] } : a)) });
  expect(bad({}).ok).toBe(false);
  expect(bad({ at: '11:00', offsetMinutes: -5 }).ok).toBe(false);
  const r = bad({ offsetMinutes: -5 }, 'resistance'); // anytime: nothing to count from
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.errors.join()).toMatch(/no time or day part/);
  expect(bad({ at: '21:25' }, 'resistance').ok).toBe(true);
  expect(validatePlan({ ...seed, formatVersion: 3 }).ok).toBe(false); // reminders need formatVersion 4
});
