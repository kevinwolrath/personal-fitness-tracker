import seed from '../../../plans/seed.plan.json';
import { manualSource, type Observation } from '../../observations/types';
import type { Plan } from '../../plan/schema';
import { validatePlan } from '../../plan/validate';
import { setSkipped } from '../../prescription/completion';
import { tickExercise } from '../../prescription/exercises';
import { prescribeDay } from '../../prescription/prescribe';
import type { ActivityLog, DayRecords, ExerciseLog } from '../../storage/types';
import { dailySummary, SHARE_INSTRUCTION } from '../dailySummary';

/** #76: the shared text is actual recorded data for the selected date, preceded by a short instruction. */

const load = (raw: unknown): Plan => {
  const r = validatePlan(raw);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.plan;
};
const plan = load(seed);
const MON = '2026-11-02';
const done = (activityId: string, over: Partial<ActivityLog> = {}): ActivityLog => ({ activityId, status: 'done', count: 0, labelSnapshot: activityId, updatedAt: `${MON}T09:00:00+11:00`, ...over });
const weigh = (date: string, kg: number, over: Partial<Observation> = {}): Observation => ({
  id: `w-${date}-${kg}`, date, metric: 'weight', value: kg, unit: 'kg', kind: 'observed', label: null, note: null, source: manualSource(), recordedAt: `${date}T07:00:00+11:00`, ...over,
});
const free = (movement: string, over: Partial<ExerciseLog> = {}): ExerciseLog => ({ id: `f-${movement}`, movement, date: MON, at: `${MON}T18:00:00+11:00`, sets: 3, reps: 15, seconds: null, intensity: null, ...over });

function summary(opts: { date?: string; activities?: Record<string, ActivityLog>; observations?: Observation[]; logs?: ExerciseLog[]; p?: Plan } = {}) {
  const p = opts.p ?? plan;
  const date = opts.date ?? MON;
  const records: DayRecords = { activities: opts.activities ?? {}, dayTypeOverride: null, observations: opts.observations ?? [], quickLogs: [] };
  const pr = prescribeDay(p, date, records);
  return { text: dailySummary({ plan: p, date, dayTypeLabel: pr.day.dayTypeLabel, items: pr.items, records, exerciseLogs: opts.logs ?? [] }), pr };
}

const strength = plan.activities.find((a) => a.id === 'resistance')!;
const sessionItem = (records: DayRecords['activities'] = {}) => prescribeDay(plan, MON, { activities: records, dayTypeOverride: null, observations: [], quickLogs: [] }).items.find((i) => i.key === 'resistance')!;
const tick = (key: string, current?: ActivityLog) => tickExercise({ planId: plan.id, date: MON, now: `${MON}T08:00:00+11:00`, current, item: sessionItem() }, strength, sessionItem().session!, key, true).log!;
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

describe('shape', () => {
  it('starts with the provider-neutral instruction, then the heading with the selected date and day type', () => {
    const { text } = summary();
    expect(text.startsWith(`${SHARE_INSTRUCTION}\n\n`)).toBe(true);
    expect(text.split('\n')[2]).toBe('Body Anvil — Daily activity — Mon 2 Nov 2026 (Home day)');
    expect(summary({ date: '2026-11-05' }).text.split('\n')[2]).toBe('Body Anvil — Daily activity — Thu 5 Nov 2026 (Office day)');
  });

  it('a typical day stays short (well under 150 words) without dropping recorded activity', () => {
    const t = tick('full:0:kettlebell_squat');
    const { text } = summary({ activities: { 'school-run-am': done('school-run-am'), lunch: done('lunch'), resistance: t }, observations: [weigh(MON, 97.8)], logs: [free('standing_calf_raise')] });
    expect(words(text)).toBeLessThan(150);
    expect(text).toContain('Goblet squat 3 × 10');
    expect(text).toContain('Standing calf raises 3 × 15');
  });
});

describe('weight', () => {
  it('a weigh-in on the selected date, with the plan target', () => {
    expect(summary({ observations: [weigh(MON, 97.8)] }).text).toContain('Weight: 97.8 kg (target 78.0 kg)');
  });

  it('the latest weigh-in that day wins', () => {
    const later = weigh(MON, 97.2, { id: 'later', recordedAt: `${MON}T20:00:00+11:00` });
    expect(summary({ observations: [weigh(MON, 97.8), later] }).text).toContain('Weight: 97.2 kg');
  });

  it('missing weight is left out: no earlier weigh-in is carried forward, inferred values are not weigh-ins', () => {
    const { text } = summary({ observations: [weigh('2026-11-01', 98.1), weigh(MON, 99.9, { kind: 'inferred' })] });
    expect(text).not.toMatch(/Weight/);
  });
});

describe('actual records only', () => {
  it('a partial workout lists done exercises with their dose and the rest as pending', () => {
    const t = tick('full:2:lat_pulldown', tick('full:0:kettlebell_squat'));
    const { text } = summary({ activities: { resistance: t } });
    expect(text).toContain('Strength workout (full): 2 of 5 done');
    expect(text).toContain('- done: Goblet squat 3 × 10, Lat pulldown 3 × 10');
    expect(text).toContain('- pending: Chest press machine, One-arm kettlebell row, Hammer curls');
  });

  it('nothing ticked: the workout is all pending, never presented as done', () => {
    const { text } = summary();
    expect(text).toContain('Strength workout (full): 0 of 5 done');
    expect(text).not.toContain('- done:');
  });

  it('a skipped workout says skipped', () => {
    const skipped = setSkipped({ planId: plan.id, date: MON, now: `${MON}T08:00:00+11:00`, current: undefined, item: sessionItem() }, true).log!;
    expect(summary({ activities: { resistance: skipped } }).text).toContain('Strength workout: skipped');
  });

  it('done, skipped and pending are explicit; counts follow the day’s progress', () => {
    const { text, pr } = summary({ activities: { 'school-run-am': done('school-run-am'), lunch: done('lunch', { status: 'skipped' }) } });
    expect(text).toContain(`Plan: ${pr.progress.done} of ${pr.progress.total} done · 1 skipped · 5 pending`);
    expect(text).toContain('Meals (checklist, not intake): Fixed lunch skipped · Fixed snack pending · Family dinner pending');
    expect(text).toContain('School run (8:30 am) done');
    expect(text).toContain('School run (3:15 pm) pending');
  });

  it('conditioning: the alternative done or started, with its rounds', () => {
    expect(summary({ activities: { 'vr-boxing': done('vr-boxing', { status: 'pending', count: 2 }) } }).text).toContain('High-intensity conditioning started (VR boxing 2 of 3 rounds)');
    expect(summary({ activities: { 'vr-boxing': done('vr-boxing', { count: 3, requirementId: 'hard-conditioning' }) } }).text).toContain('High-intensity conditioning done (VR boxing 3 of 3 rounds)');
  });

  it('no calories, energy or durations are invented; meals are a checklist, not intake', () => {
    const { text } = summary({ activities: { lunch: done('lunch'), 'heavy-bag': done('heavy-bag') } });
    expect(text).not.toMatch(/kJ|kcal|calorie|min\b|minutes/i);
    expect(text).toContain('High-intensity conditioning done (Heavy bag rounds)');
  });

  it('extra exercises show their logged dose: reps, seconds or sets', () => {
    const { text } = summary({ logs: [free('plank', { id: 'b', sets: 2, reps: null, seconds: 30, at: `${MON}T19:00:00+11:00` }), free('standing_calf_raise')] });
    expect(text).toContain('Extra exercise: Standing calf raises 3 × 15, Plank 2 × 30 s');
  });

  it('a day with nothing planned or recorded says so truthfully', () => {
    const empty = load({ ...seed, activities: [], requirements: undefined, goals: [] });
    expect(summary({ p: empty }).text.split('\n').slice(2)).toEqual(['Body Anvil — Daily activity — Mon 2 Nov 2026 (Home day)', 'No activity logged.']);
  });
});
