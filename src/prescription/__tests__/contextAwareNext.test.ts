import seed from '../../../plans/seed.plan.json';
import { validatePlan } from '../../plan/validate';
import type { ActivityLog, DayRecords } from '../../storage/types';
import { estimatedMinutes, isDue, nextAction } from '../nextAction';
import { prescribeDay } from '../prescribe';
import { toMinutes } from '../windows';

/** #41: "Do this next" answers "what should I reasonably do now?", not "what is the first incomplete task?". */

const load = (json: unknown) => {
  const r = validatePlan(json);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.plan;
};
const MON = '2026-11-02'; // home day, strength day
const THU = '2026-11-05'; // office day
const log = (activityId: string, over: Partial<ActivityLog> = {}): ActivityLog => ({
  activityId, status: 'done', count: 0, labelSnapshot: activityId, updatedAt: `${MON}T08:00:00Z`, ...over,
});
const records = (logs: ActivityLog[] = [], dayTypeOverride: string | null = null): DayRecords => ({
  activities: Object.fromEntries(logs.map((l) => [l.activityId, l])), dayTypeOverride, observations: [], quickLogs: [],
});
const seedPlan = load(seed);
const next = (date: string, hhmm: string, logs: ActivityLog[] = [], dayType: string | null = null, plan = seedPlan) =>
  nextAction(prescribeDay(plan, date, records(logs, dayType)), toMinutes(hhmm));

/** The seed plan with Strength given an explicit window, as a configured plan could (decision 1 on #41). */
const withStrengthWindow = (when: string) =>
  load({ ...seed, activities: seed.activities.map((a) => (a.id === 'resistance' ? { ...a, when } : a)) });

describe('the reported case: Monday 09:34, home day', () => {
  it('shows no card: neither the overdue 08:30 school run, nor untimed Strength, nor a noon lunch preview', () => {
    expect(next(MON, '09:34')).toBeNull();
    expect(next(MON, '09:34', [log('school-run-am')])).toBeNull(); // the same once the run is ticked off
  });

  it('keeps every item in the checklist, unresolved: overdue is neither skipped nor completed', () => {
    const items = prescribeDay(seedPlan, MON, records()).items;
    expect(items.find((i) => i.key === 'school-run-am')!.state).toBe('pending');
    expect(items.find((i) => i.key === 'resistance')!.state).toBe('pending');
  });
});

describe('time-relevant recommendations', () => {
  it('the school run is recommended while its window is open, and not after', () => {
    expect(next(MON, '08:00')).toMatchObject({ item: { key: 'school-run-am' }, status: 'now' }); // 30 min lead
    expect(next(MON, '09:30')).toMatchObject({ item: { key: 'school-run-am' }, status: 'now' }); // an hour after 08:30
    expect(next(MON, '09:31')).toBeNull();
  });

  it('lunch may be recommended near noon', () => {
    expect(next(MON, '11:50')).toMatchObject({ item: { key: 'lunch' }, status: 'now' });
    expect(next(THU, '11:50')).toMatchObject({ item: { key: 'lunch' }, status: 'now' });
  });

  it('completed (or skipped) activities are never recommended', () => {
    expect(next(MON, '11:50', [log('lunch')])?.item.key).not.toBe('lunch');
    expect(next(MON, '11:50', [log('lunch', { status: 'skipped' })])?.item.key).not.toBe('lunch');
    expect(next(MON, '08:40', [log('school-run-am')])).toBeNull();
  });

  it('"Up next" previews only a timed item becoming due within 60 minutes, and never offers Done', () => {
    expect(next(MON, '10:44', [log('school-run-am')])).toBeNull();
    const n = next(MON, '10:45', [log('school-run-am')]);
    expect(n).toMatchObject({ item: { key: 'lunch' }, status: 'later' });
    expect(isDue(n)).toBe(false);
  });
});

describe('strength is promoted only when the plan gives a suitable window', () => {
  it('untimed Strength is never promoted, at any hour, though it stays actionable in the checklist', () => {
    for (let m = 0; m < 24 * 60; m += 15) {
      const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      expect(next(MON, hhmm)?.item.key).not.toBe('resistance');
    }
    expect(prescribeDay(seedPlan, MON, records()).items.map((i) => i.key)).toContain('resistance');
  });

  it('with an explicit morning window: promoted only while its 35 min fit before the part ends', () => {
    const plan = withStrengthWindow('morning'); // 06:00–11:00
    expect(next(MON, '09:40', [log('school-run-am')], null, plan)).toMatchObject({ item: { key: 'resistance' }, status: 'now' });
    expect(next(MON, '10:25', [log('school-run-am')], null, plan)?.item.key).toBe('resistance'); // ends 11:00
    expect(next(MON, '10:26', [log('school-run-am')], null, plan)?.item.key).not.toBe('resistance');
  });

  it('a timed item still in its window is recommended ahead of a day-part session', () => {
    expect(next(MON, '08:40', [], null, withStrengthWindow('morning'))!.item.key).toBe('school-run-am');
  });

  it('with an explicit midday window: it must fit before the next fixed-time item becomes due', () => {
    const plan = withStrengthWindow('lunch'); // 11:00–14:00; lunch (12:00) is due from 11:45
    const morning = [log('school-run-am')];
    expect(next(MON, '11:10', morning, null, plan)).toMatchObject({ item: { key: 'resistance' }, status: 'now' }); // until 11:45
    expect(next(MON, '11:11', morning, null, plan)).toMatchObject({ item: { key: 'lunch' }, status: 'later' }); // no room before lunch
    // After lunch and both 12:30 walks, there's a gap until the 15:15 school run (due 14:45), but the midday part ends at 14:00.
    const lunchDone = [...morning, log('lunch'), log('lunch-walk'), log('dog-walk')];
    expect(next(MON, '13:25', lunchDone, null, plan)?.item.key).toBe('resistance');
    expect(next(MON, '13:26', lunchDone, null, plan)).toBeNull(); // a calendar gap alone never makes room
  });

  it('the duration follows the chosen version: the short session fits where the full one does not', () => {
    const plan = withStrengthWindow('morning');
    const short = [log('school-run-am'), log('resistance', { status: 'pending', variant: 'short', exercisesDone: [] })];
    const item = prescribeDay(plan, MON, records(short)).items.find((i) => i.key === 'resistance')!;
    expect(estimatedMinutes(item)).toBe(10);
    expect(next(MON, '10:45', short, null, plan)?.item.key).toBe('resistance');
  });
});

describe('optional untimed habits are never filler', () => {
  it('weekend movement and recovery stay in the checklist but are never recommended', () => {
    const SAT = '2026-11-07';
    const items = prescribeDay(seedPlan, SAT, records()).items.map((i) => i.key);
    expect(items).toEqual(expect.arrayContaining(['weekend-movement']));
    for (const hhmm of ['07:00', '09:34', '15:00', '21:00']) {
      expect(['weekend-movement', 'recovery']).not.toContain(next(SAT, hhmm)?.item.key);
    }
  });
});

describe('Home and Office schedules', () => {
  it('Office days have no school run to recommend; the same hour on a Home day does', () => {
    expect(next(THU, '08:40')).toBeNull();
    expect(next(MON, '08:40')!.item.key).toBe('school-run-am');
  });

  it('a day-type override is respected', () => {
    expect(next(THU, '08:40', [], 'home')!.item.key).toBe('school-run-am');
    expect(next(MON, '08:40', [], 'office')).toBeNull();
  });
});
