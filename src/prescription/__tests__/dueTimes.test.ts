import Ajv2020 from 'ajv/dist/2020';
import contract from '../../../docs/design-contracts/plan.schema.json';
import example from '../../../fixtures/plans/prescription-example.plan.json';
import seed from '../../../plans/seed.plan.json';
import { clockAt } from '../../features/daily-log/useDay';
import { formatCountdown } from '../../format';
import { validatePlan } from '../../plan/validate';
import type { ActivityLog, DayRecords } from '../../storage/types';
import { isDue, nextAction } from '../nextAction';
import { prescribeDay } from '../prescribe';
import { DEFAULT_LEAD_MINUTES, leadMinutesFor, toMinutes } from '../windows';

/** #51: "Do this next" is time-aware. Items become due a plan-defined lead time before their scheduled time. */

const load = (json: unknown) => {
  const r = validatePlan(json);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.plan;
};
const at = toMinutes;
const log = (activityId: string, over: Partial<ActivityLog> = {}): ActivityLog => ({
  activityId, status: 'done', count: 0, labelSnapshot: activityId, updatedAt: '2026-11-06T10:00:00Z', ...over,
});
const records = (logs: ActivityLog[] = []): DayRecords => ({
  activities: Object.fromEntries(logs.map((l) => [l.activityId, l])), dayTypeOverride: null, observations: [], quickLogs: [],
});

describe('Friday office day with the shipped plan (the reported case)', () => {
  const plan = load(seed);
  const FRI = '2026-11-06';
  const next = (logs: ActivityLog[], hhmm: string) => nextAction(prescribeDay(plan, FRI, records(logs)), at(hhmm));

  it('07:30: lunch at 12:00 is only "Up next", not due', () => {
    const n = next([], '07:30');
    expect(n).toMatchObject({ item: { key: 'lunch' }, status: 'later' });
    expect(isDue(n)).toBe(false);
  });

  it('11:44: still upcoming; 11:45 (15 min before, meals): due; 12:00: due', () => {
    expect(next([], '11:44')!.status).toBe('later');
    expect(next([], '11:45')).toMatchObject({ item: { key: 'lunch' }, status: 'now' });
    expect(next([], '12:00')).toMatchObject({ item: { key: 'lunch' }, status: 'now' });
  });

  it('after lunch is done or skipped, the next due item follows; far-future items are only previews', () => {
    // 12:05: the walk (12:30, exercise: 30 min lead) is already due.
    expect(next([log('lunch')], '12:05')).toMatchObject({ item: { key: 'lunch-walk' }, status: 'now' });
    expect(next([log('lunch', { status: 'skipped' })], '12:05')!.item.key).toBe('lunch-walk');
    // Lunch done early at 08:00 (through Details): nothing is due, the walk is previewed.
    expect(next([log('lunch')], '08:00')).toMatchObject({ item: { key: 'lunch-walk' }, status: 'later' });
  });

  it('dinner follows the same rule: upcoming at 18:00, due from 18:15', () => {
    // Tonight's conditioning (evening part, due from 17:30) already done, so dinner is the only thing left.
    const before = [...['lunch', 'lunch-walk', 'snack'].map((id) => log(id)), log('vr-boxing', { count: 3, requirementId: 'hard-conditioning' })];
    expect(next(before, '18:14')).toMatchObject({ item: { key: 'dinner' }, status: 'later' });
    expect(next(before, '18:15')).toMatchObject({ item: { key: 'dinner' }, status: 'now' });
  });

  it('overdue: an unfinished lunch after its window is still offered ahead of anything upcoming', () => {
    // Lunch's window (from 11:45) ends an hour after 12:00. The walk is done; dinner is hours away.
    expect(next([log('lunch-walk')], '13:30')).toMatchObject({ item: { key: 'lunch' }, status: 'overdue' });
  });
});

describe('lead times: item > plan > format default', () => {
  const base = (over: Record<string, unknown> = {}, acts?: unknown[]) => ({
    ...JSON.parse(JSON.stringify(example)),
    formatVersion: 5,
    activities: acts ?? [
      { id: 'lunch', kind: 'meal', label: 'Lunch', time: '12:00' },
      { id: 'gym', kind: 'exercise', label: 'Gym', time: '12:00' },
      { id: 'pills', kind: 'habit', label: 'Pills', time: '12:00' },
      ...example.activities.filter((a) => a.satisfies),
    ],
    ...over,
  });
  const starts = (raw: unknown) =>
    Object.fromEntries(prescribeDay(load(raw), '2026-11-02', records()).items.map((i) => [i.key, i.window.start]));

  it('format defaults: meals and habits 15 min, exercise 30 min', () => {
    expect(DEFAULT_LEAD_MINUTES).toEqual({ meal: 15, habit: 15, exercise: 30 });
    expect(starts(base())).toMatchObject({ lunch: at('11:45'), gym: at('11:30'), pills: at('11:45') });
  });

  it('plan-wide timing overrides the defaults per kind; unset kinds keep the default', () => {
    expect(starts(base({ timing: { leadMinutes: { meal: 45, habit: 0 } } }))).toMatchObject({ lunch: at('11:15'), gym: at('11:30'), pills: at('12:00') });
  });

  it("an item's own leadMinutes beats the plan", () => {
    const raw = base({ timing: { leadMinutes: { meal: 45 } } });
    raw.activities[0].leadMinutes = 5;
    expect(starts(raw)).toMatchObject({ lunch: at('11:55') });
    expect(leadMinutesFor({ timing: { leadMinutes: { meal: 45 } } }, 'meal', 0)).toBe(0); // 0 is a real value, not "unset"
  });

  it("a requirement's leadMinutes applies to its timed alternatives", () => {
    const raw = base();
    raw.requirements[0] = { ...raw.requirements[0], when: undefined, time: '19:00', leadMinutes: 60 };
    delete raw.requirements[0].when;
    const req = prescribeDay(load(raw), '2026-11-02', records()).items.find((i) => i.kind === 'requirement')!;
    expect(req.window).toMatchObject({ at: at('19:00'), start: at('18:00') });
  });

  it('day parts and anytime are unaffected by lead times', () => {
    const p = prescribeDay(load(base({ timing: { leadMinutes: { meal: 90 } } }, [
      { id: 'brekkie', kind: 'meal', label: 'Breakfast', when: 'morning' },
      { id: 'water', kind: 'habit', label: 'Water' },
      ...example.activities.filter((a) => a.satisfies),
    ])), '2026-11-02', records());
    const w = Object.fromEntries(p.items.map((i) => [i.key, i.window]));
    expect(w.brekkie).toMatchObject({ at: at('06:00'), start: at('06:00') });
    expect(w.water).toMatchObject({ at: 0, start: 0, end: 1440 });
  });

  it('items are listed by scheduled time, not by when they become due', () => {
    const p = prescribeDay(load(base({}, [
      { id: 'lunch', kind: 'meal', label: 'Lunch', time: '12:00' }, // due 11:45
      { id: 'run', kind: 'exercise', label: 'Run', time: '12:10' }, // due 11:40
      ...example.activities.filter((a) => a.satisfies),
    ])), '2026-11-02', records());
    expect(p.items.map((i) => i.key).slice(0, 2)).toEqual(['lunch', 'run']);
    // …but "Do this next" picks whatever is due first.
    expect(nextAction(p, at('11:42'))).toMatchObject({ item: { key: 'run' }, status: 'now' });
  });

  it('overlapping due items: required before optional, then the one due first', () => {
    const p = prescribeDay(load(base({}, [
      { id: 'snack', kind: 'meal', label: 'Snack', time: '15:00', required: false },
      { id: 'meds', kind: 'habit', label: 'Meds', time: '15:05' },
      { id: 'walk', kind: 'exercise', label: 'Walk', time: '15:10' },
      ...example.activities.filter((a) => a.satisfies),
    ])), '2026-11-02', records());
    expect(nextAction(p, at('15:00'))!.item.key).toBe('walk'); // required, due 14:40 (before meds at 14:50)
  });
});

describe('format versions (backward compatibility)', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  const validate = ajv.compile(contract);
  const v = (formatVersion: number, edit: (p: any) => void) => {
    const p = { ...JSON.parse(JSON.stringify(example)), formatVersion };
    edit(p);
    return p;
  };

  it.each([
    ['timing', (p: any) => (p.timing = { leadMinutes: { meal: 10 } })],
    ['activity leadMinutes', (p: any) => (p.activities[2].leadMinutes = 10)],
    ['requirement leadMinutes', (p: any) => (p.requirements[0].leadMinutes = 10)],
  ])('%s needs formatVersion 5 (rejected on 4, accepted on 5)', (_n, edit) => {
    const old = v(4, edit);
    expect(validate(old)).toBe(false);
    expect(validatePlan(old).ok).toBe(false);
    const now = v(5, edit);
    expect(validate(now) ? [] : validate.errors).toEqual([]);
    expect(validatePlan(now).ok).toBe(true);
  });

  it.each([
    ['negative lead', (p: any) => (p.activities[2].leadMinutes = -5)],
    ['lead over 4 hours', (p: any) => (p.timing = { leadMinutes: { meal: 241 } })],
    ['fractional lead', (p: any) => (p.activities[2].leadMinutes = 7.5)],
    ['unknown kind', (p: any) => (p.timing = { leadMinutes: { snack: 10 } })],
  ])('rejects %s', (_n, edit) => {
    const p = v(5, edit);
    expect(validate(p)).toBe(false);
    expect(validatePlan(p).ok).toBe(false);
  });

  it('existing plans (no lead times) still load, using the format defaults', () => {
    for (const p of [seed, example]) expect(validatePlan(p).ok).toBe(true);
  });
});

describe('clock and countdown', () => {
  it('a day rollover changes the date and the minute together', () => {
    expect(clockAt(new Date(2026, 10, 6, 23, 59, 59))).toEqual({ today: '2026-11-06', nowMinutes: 23 * 60 + 59 });
    expect(clockAt(new Date(2026, 10, 7, 0, 0, 1))).toEqual({ today: '2026-11-07', nowMinutes: 0 });
  });

  it.each([
    [270, 'in 4 h 30 min'],
    [240, 'in 4 h'],
    [15, 'in 15 min'],
    [1, 'in 1 min'],
    [0, 'now'],
  ])('%i min → %s', (m, s) => expect(formatCountdown(m)).toBe(s));
});
