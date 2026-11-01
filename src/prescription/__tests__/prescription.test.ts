import Ajv2020 from 'ajv/dist/2020';
import contract from '../../../docs/design-contracts/plan.schema.json';
import example from '../../../fixtures/plans/prescription-example.plan.json';
import seed from '../../../plans/seed.plan.json';
import { validatePlan } from '../../plan/validate';
import type { ActivityLog, DayRecords } from '../../storage/types';
import { nextAction } from '../nextAction';
import { prescribeDay, requirementKey } from '../prescribe';
import { exerciseDose } from '../session';
import { toMinutes } from '../windows';

const load = (json: unknown) => {
  const r = validatePlan(json);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.plan;
};
const plan = load(example);
const DATE = '2026-11-02';
const log = (activityId: string, over: Partial<ActivityLog> = {}): ActivityLog => ({
  activityId, status: 'done', count: 0, labelSnapshot: activityId, updatedAt: '2026-11-02T10:00:00Z', ...over,
});
const records = (logs: ActivityLog[] = []): DayRecords => ({
  activities: Object.fromEntries(logs.map((l) => [l.activityId, l])), dayTypeOverride: null, observations: [], quickLogs: [],
});
const at = (hhmm: string) => toMinutes(hhmm);
const next = (logs: ActivityLog[], hhmm: string) => nextAction(prescribeDay(plan, DATE, records(logs)), at(hhmm));

describe('plan contract', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  const validate = ajv.compile(contract);
  it.each([['prescription example', example], ['seed', seed]])('%s validates against the JSON Schema and runtime rules', (_n, p) => {
    expect(validate(p) ? [] : validate.errors).toEqual([]);
    expect(() => load(p)).not.toThrow();
  });
  const clone = () => JSON.parse(JSON.stringify(example));
  it.each([
    ['time and when together', (p: any) => (p.activities[2].when = 'lunch'), /either time or when/],
    ['unknown requirement', (p: any) => (p.activities[6].satisfies = 'nope'), /unknown requirement "nope"/],
    ['requirement nobody satisfies', (p: any) => p.requirements.push({ id: 'mobility', label: 'Mobility', purpose: 'mobility' }), /no activity satisfies it/],
    ['after an unknown activity', (p: any) => (p.activities[1].after = ['coffee']), /after unknown activity "coffee"/],
    ['after cycle', (p: any) => (p.activities[0].after = ['morning-walk']), /cycle/],
    ['short version not shorter', (p: any) => (p.activities[3].session.short.minutes = 30), /must be shorter/],
  ])('rejects: %s', (_n, mutate, message) => {
    const p = clone();
    mutate(p);
    const r = validatePlan(p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toMatch(message);
  });
  it('prescription fields need formatVersion 2 (both validators)', () => {
    const v1 = JSON.parse(JSON.stringify(seed));
    v1.formatVersion = 1;
    delete v1.requirements;
    delete v1.exercise;
    v1.activities = v1.activities.map(({ purpose, when, after, session, satisfies, ...a }: any) => a);
    v1.activities[0].when = 'morning';
    expect(validate(v1)).toBe(false);
    expect(validatePlan(v1).ok).toBe(false);
  });
});

describe('prescribeDay', () => {
  const p = prescribeDay(plan, DATE, records());

  it('lists the day in time order, collapsing alternatives into one requirement', () => {
    expect(p.items.map((i) => i.key)).toEqual([
      'stretch', // anytime (start 0), shown in its own group by the UI
      'breakfast', 'morning-walk', 'lunch', 'strength', 'snack',
      requirementKey('hard-conditioning'), // evening window opens 17:30, before dinner's 18:00–19:30 slot
      'dinner',
    ]);
    const req = p.items.find((i) => i.kind === 'requirement')!;
    expect(req.options.map((o) => o.id)).toEqual(['vr-boxing', 'heavy-bag', 'battle-ropes']);
    expect(req).toMatchObject({ purpose: 'conditioning_high_intensity', required: true, window: { part: 'evening' } });
    expect(p.progress).toEqual({ done: 0, total: 7, complete: false }); // stretch is optional
  });

  it('classifies windows: exact time vs day part vs anytime', () => {
    const w = Object.fromEntries(p.items.map((i) => [i.key, i.window]));
    expect(w.lunch).toEqual({ part: 'lunch', start: at('11:30'), end: at('13:00'), time: '12:00' });
    expect(w.breakfast).toMatchObject({ part: 'morning', start: at('06:00'), end: at('11:00') });
    expect(w.stretch).toMatchObject({ part: 'anytime', start: 0, end: 1440 });
  });

  it('carries structured sessions with the user\'s substitutions and cautions applied', () => {
    const s = p.items.find((i) => i.key === 'strength')!.session!;
    expect(s.minutes).toBe(25);
    expect(s.exercises.map((e) => [e.label, exerciseDose(e)])).toEqual([
      ['Kettlebell squat', '3 × 10 · 16 kg'],
      ['Chest press', '3 × 10'],
      ['Lat pulldown', '3 × 10'],
      ['Cable row', '3 × 10'],
      ['Hammer curl', '2 × 12'],
      ['Overhead press', '2 × 8'],
    ]);
    expect(s.exercises[4]).toMatchObject({ movement: 'hammer_curl', substitutedFor: 'Biceps curl' });
    expect(s.exercises[5]).toMatchObject({ caution: true });
    expect(s.short).toMatchObject({ minutes: 10 });
    expect(s.short!.exercises).toHaveLength(2);
  });

  it('flags an avoided movement that has no allowed substitute', () => {
    const noSub = load({ ...JSON.parse(JSON.stringify(example)), exercise: { limitations: [{ movement: 'biceps_curl', status: 'avoid' }] } });
    const ex = prescribeDay(noSub, DATE, records()).items.find((i) => i.key === 'strength')!.session!.exercises[4];
    expect(ex).toMatchObject({ movement: 'biceps_curl', avoid: true });
  });

  it('one alternative satisfies the requirement; the others are not needed', () => {
    const d = prescribeDay(plan, DATE, records([log('heavy-bag', { requirementId: 'hard-conditioning', updatedAt: '2026-11-02T19:00:00Z' })]));
    const req = d.items.find((i) => i.kind === 'requirement')!;
    expect(req).toMatchObject({ state: 'done', satisfiedBy: { activityId: 'heavy-bag', label: 'Heavy bag rounds' }, completedAt: '2026-11-02T19:00:00Z' });
    expect(d.progress.done).toBe(1);
  });

  it('a partly done count activity leaves the requirement open (partial), not satisfied', () => {
    const d = prescribeDay(plan, DATE, records([log('vr-boxing', { status: 'pending', count: 2 })]));
    expect(d.items.find((i) => i.kind === 'requirement')).toMatchObject({ state: 'partial', count: 2, target: 3 });
  });

  it('a skipped requirement is resolved and leaves the total', () => {
    const d = prescribeDay(plan, DATE, records([log(requirementKey('hard-conditioning'), { status: 'skipped' })]));
    expect(d.items.find((i) => i.kind === 'requirement')!.state).toBe('skipped');
    expect(d.progress.total).toBe(6);
  });

  it('records the session variant used', () => {
    const d = prescribeDay(plan, DATE, records([log('strength', { variant: 'short' })]));
    expect(d.items.find((i) => i.key === 'strength')).toMatchObject({ state: 'done', variant: 'short' });
  });
});

describe('nextAction', () => {
  it('before any window opens, an open anytime item is offered ahead of "later" items', () => {
    expect(next([], '05:30')).toMatchObject({ item: { key: 'stretch' }, status: 'anytime' });
  });

  it('morning: breakfast now; the walk waits for breakfast', () => {
    expect(next([], '07:00')).toMatchObject({ item: { key: 'breakfast' }, status: 'now' });
    expect(next([log('breakfast')], '07:30')).toMatchObject({ item: { key: 'morning-walk' }, status: 'now' });
    expect(next([log('breakfast', { status: 'skipped' })], '07:30')!.item.key).toBe('morning-walk'); // skipped resolves the dependency
  });

  it('completing an item immediately moves "next" on', () => {
    const before = next([log('breakfast')], '12:05')!;
    expect(before.item.key).toBe('lunch'); // lunch window open beats an overdue walk
    const after = next([log('breakfast'), log('lunch')], '12:05')!;
    expect(after).toMatchObject({ item: { key: 'morning-walk' }, status: 'overdue' }); // required overdue beats upcoming
  });

  it('afternoon: strength session, then the snack once lunch is done', () => {
    const morningDone = [log('breakfast'), log('morning-walk'), log('lunch')];
    expect(next(morningDone, '15:00')).toMatchObject({ item: { key: 'strength' }, status: 'now' });
    expect(next([...morningDone, log('strength')], '15:30')!.item.key).toBe('snack');
  });

  it('blocks an item until its dependency resolves', () => {
    const d = next([log('breakfast'), log('morning-walk')], '15:00')!;
    expect(d.item.key).not.toBe('snack'); // lunch not done: snack (after lunch) unavailable
  });

  it('evening: conditioning requirement; satisfied by VR boxing, no redundant ropes or bag afterwards', () => {
    const dayDone = ['breakfast', 'morning-walk', 'lunch', 'strength', 'snack', 'dinner'].map((id) => log(id));
    expect(next(dayDone, '19:30')).toMatchObject({ item: { key: requirementKey('hard-conditioning') }, status: 'now' });
    const boxed = [...dayDone, log('vr-boxing', { count: 3, requirementId: 'hard-conditioning' })];
    const n = next(boxed, '19:45');
    expect(n?.item.key).toBe('stretch'); // only the optional stretch is left; never heavy bag or battle ropes
    expect(next([...boxed, log('stretch')], '20:00')).toBeNull(); // nothing left
  });

  it('early morning with nothing current: the earliest upcoming item is "later"', () => {
    const p = prescribeDay(plan, DATE, records([log('stretch')]));
    expect(nextAction(p, at('05:00'))).toMatchObject({ item: { key: 'breakfast' }, status: 'later' });
  });

  it('required anytime work comes before optional current work; overdue required before optional', () => {
    const anyPlan = load({
      ...JSON.parse(JSON.stringify(example)),
      activities: [
        { id: 'water', kind: 'habit', label: 'Water', required: true },
        { id: 'walk', kind: 'exercise', label: 'Walk', when: 'morning', required: false },
        { id: 'meds', kind: 'habit', label: 'Meds', when: 'morning' },
        ...example.activities.filter((a) => a.satisfies),
      ],
    });
    const p = prescribeDay(anyPlan, DATE, records());
    expect(nextAction(p, at('08:00'))!.item.key).toBe('meds'); // required & current
    expect(nextAction(prescribeDay(anyPlan, DATE, records([log('meds')])), at('08:00'))!.item.key).toBe('water'); // required anytime
    expect(nextAction(prescribeDay(anyPlan, DATE, records([log('water')])), at('12:00'))!.item.key).toBe('meds'); // overdue required
  });
});

describe('the shipped seed plan', () => {
  const seedPlan = load(seed);
  const day = (date: string, logs: ActivityLog[] = []) => prescribeDay(seedPlan, date, records(logs));

  it('Monday: strength session with the real equipment, conditioning as one requirement', () => {
    const p = day('2026-11-02');
    const strength = p.items.find((i) => i.key === 'resistance')!;
    expect(strength.session!.exercises.map((e) => e.label)).toEqual(['Kettlebell squat', 'Chest press (Fortis)', 'Lat pulldown (Fortis)', 'Cable row (Fortis)', 'Hammer curl']);
    expect(strength.session!.short!.minutes).toBe(10);
    const req = p.items.find((i) => i.kind === 'requirement')!;
    expect(req.options.map((o) => o.label)).toEqual(['VR boxing', 'Heavy bag rounds', 'Battle ropes']);
    expect(p.items.filter((i) => i.purpose === 'conditioning_high_intensity')).toHaveLength(1);
  });

  it('VR boxing to target satisfies tonight\'s conditioning; next is never ropes or bag', () => {
    const before = nextAction(day('2026-11-02', ['school-run-am', 'lunch', 'school-run-pm', 'snack', 'dinner', 'resistance'].map((id) => log(id))), at('20:00'));
    expect(before!.item.key).toBe('req:hard-conditioning');
    const after = nextAction(day('2026-11-02', [...['school-run-am', 'lunch', 'school-run-pm', 'snack', 'dinner', 'resistance'].map((id) => log(id)), log('vr-boxing', { count: 3 })]), at('20:05'));
    expect(after?.item.options.map((o) => o.id) ?? []).not.toContain('battle-ropes');
    expect(after?.item.required ?? false).toBe(false); // only optional items (dog walk) can remain
  });

  it('the upgrade payload turns the previous seed into this one through the #7 protocol', () => {
    const { parseConfigUpdate, applyConfigUpdate } = require('../../config/update');
    const fs = require('node:fs');
    const previous = JSON.parse(JSON.stringify(seed));
    previous.revision = 1;
    delete previous.requirements;
    previous.activities = previous.activities
      .filter((a: any) => a.id !== 'heavy-bag' && a.id !== 'battle-ropes')
      .map(({ purpose, when, after, session, satisfies, ...a }: any) => a);
    const parsed = parseConfigUpdate(fs.readFileSync('fixtures/config/daily-prescription.update.json', 'utf8'));
    expect(parsed.ok).toBe(true);
    const applied = applyConfigUpdate(previous, parsed.update);
    if (!applied.ok) throw new Error(applied.errors.join('\n'));
    // Same activities and requirements (meals keep their place among activities).
    expect(applied.plan.activities.map((a: any) => a.id).sort()).toEqual(seedPlan.activities.map((a) => a.id).sort());
    expect(applied.plan.requirements).toEqual(seedPlan.requirements);
  });
});
