import seed from '../../../../plans/seed.plan.json';
import { formatObservationValue, observationLabel, observationSource } from '../../../observations/format';
import { manualSource, type Observation } from '../../../observations/types';
import { resolveDay } from '../../../plan/resolveDay';
import { validatePlan } from '../../../plan/validate';
import type { DayRecords } from '../../../storage/types';
import { loggedOutsidePlan, recordedObservations } from '../dayContent';
import { dayLabels } from '../dayLabels';

const r = validatePlan(seed);
if (!r.ok) throw new Error('seed invalid');
const plan = r.plan;
const lbPlan = { ...plan, units: { ...plan.units, mass: 'lb' as const, energy: 'kcal' as const } };

const obs = (over: Partial<Observation>): Observation => ({
  id: 'o', date: '2026-11-02', metric: 'steps', value: 13765, unit: 'count', kind: 'observed', label: null, note: null,
  source: manualSource(), recordedAt: '2026-11-02T08:00:00Z', ...over,
});
const screenshot = (app: string, edited = false) => ({
  type: 'screenshot' as const, app, capturedAt: null, confidence: 0.9, importId: 'i', assetId: 'a', evidence: 'x', edited,
});

describe('dayLabels (en-AU)', () => {
  const today = '2026-11-02';
  const l = (d: string) => dayLabels(d, today, 'en-AU');
  it('names nearby days', () => {
    expect(l('2026-11-02')).toMatchObject({ title: 'Today', when: 'today' });
    expect(l('2026-11-01')).toMatchObject({ title: 'Yesterday', when: 'past' });
    expect(l('2026-11-03')).toMatchObject({ title: 'Tomorrow', when: 'future' });
    expect(l('2026-10-29').title).toBe('Thursday');
  });
  it('uses dates further away, with the year only when it differs', () => {
    expect(l('2026-03-15').title).toBe('15 March');
    expect(l('2025-03-15').title).toBe('15 March 2025');
    expect(l('2026-03-15').date).toBe('Sun, 15 Mar');
    expect(l('2025-03-15').date).toBe('15 Mar 2025');
  });
});

describe('observation display', () => {
  it('formats by metric in the plan units', () => {
    expect(formatObservationValue(obs({}), plan, 'kJ')).toBe('13,765');
    expect(formatObservationValue(obs({ metric: 'sleep_duration', value: 465, unit: 'min' }), plan, 'kJ')).toBe('7h 45m');
    expect(formatObservationValue(obs({ metric: 'weight', value: 97.25, unit: 'kg' }), plan, 'kJ')).toBe('97.25 kg');
    expect(formatObservationValue(obs({ metric: 'weight', value: 45.359237, unit: 'kg' }), lbPlan, 'kJ')).toBe('100 lb');
    expect(formatObservationValue(obs({ metric: 'weight_change', value: -2.55, unit: 'kg' }), plan, 'kJ')).toBe('-2.55 kg');
    expect(formatObservationValue(obs({ metric: 'total_energy', value: 8368, unit: 'kJ' }), lbPlan, 'kcal')).toBe('2,000 kcal');
    expect(formatObservationValue(obs({ metric: 'other', label: 'VO2 max', value: 41, unit: 'ml/kg/min' }), plan, 'kJ')).toBe('41 ml/kg/min');
  });
  it('labels and describes provenance', () => {
    expect(observationLabel(obs({ metric: 'exercise_session', label: 'Weights' }))).toBe('Weights');
    expect(observationLabel(obs({ metric: 'readiness_score' }))).toBe('Readiness');
    expect(observationSource(obs({}))).toBe('Entered');
    expect(observationSource(obs({ source: screenshot('google-fit', true) }))).toBe('Google fit screenshot · edited');
    expect(observationSource(obs({ kind: 'inferred', source: screenshot('renpho') }))).toBe('Calculated · Renpho screenshot');
  });
});

describe('day content', () => {
  const monday = resolveDay(plan, '2026-11-02');
  const records = (over: Partial<DayRecords>): DayRecords => ({ activities: {}, dayTypeOverride: null, observations: [], quickLogs: [], ...over });

  it('lists everything recorded except the measurement already shown in the panel', () => {
    const list = recordedObservations(monday, records({
      observations: [
        obs({ id: 'w', metric: 'weight', unit: 'kg', value: 97.25 }), // shown in the weight panel
        obs({ id: 'calc', metric: 'weight', unit: 'kg', value: 99.8, kind: 'inferred' }), // calculated: listed, marked
        obs({ id: 'sleep', metric: 'sleep_duration', unit: 'min', value: 465 }),
        obs({ id: 'steps' }),
        obs({ id: 'waist', metric: 'waist', unit: 'cm', value: 101 }), // not due Monday: listed
      ],
    }));
    expect(list.map((o) => o.id)).toEqual(['calc', 'waist', 'steps', 'sleep']);
  });

  it('keeps activity history the current plan no longer schedules', () => {
    const log = (activityId: string, status: 'done' | 'skipped' | 'pending', count = 0) => ({ activityId, status, count, labelSnapshot: activityId, updatedAt: 't' });
    const outside = loggedOutsidePlan(monday, records({
      activities: {
        'school-run-am': log('school-run-am', 'done'), // scheduled Monday
        'old-swim': log('old-swim', 'done'), // removed from plan
        'lunch-walk': log('lunch-walk', 'skipped'), // office-only: day type changed after logging
        'partial-thing': log('partial-thing', 'pending', 2),
        'empty-thing': log('empty-thing', 'pending', 0),
      },
    }));
    expect(outside.map((l) => l.activityId)).toEqual(['lunch-walk', 'old-swim', 'partial-thing']);
  });
});
