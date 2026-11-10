import { metricDef } from '../observations/metrics';
import type { Observation } from '../observations/types';
import { addDays, type LocalDate } from '../plan/dates';
import type { MealLog } from '../nutrition/contract';
import type { StoreSnapshot } from '../storage/types';

/**
 * The health data Body Anvil uploads (#134): one plain JSON document an AI or a person can read. Pure.
 *
 * - **Sync my data** sends everything (`days: null`, every category) to the owner's private snapshot.
 * - **Share my details** sends only the scope the user picked (last 7/30/90 days or all, chosen categories) to a
 *   read-only link. The preview shows exactly this document, so what's shared is what was shown.
 *
 * Never included: the display name (a direct identifier), meal photos or any file, screenshot text, location (the
 * app records none), and any credential. Each record keeps its date, unit and where it came from (provenance).
 */

export const HEALTH_SCHEMA = 'body-anvil-health';
export const HEALTH_SCHEMA_VERSION = 1;

export const categories = ['body', 'activity', 'sleep', 'nutrition', 'training', 'plan'] as const;
export type Category = (typeof categories)[number];
export const categoryLabels: Record<Category, { label: string; detail: string }> = {
  body: { label: 'Body measurements', detail: 'Weight, waist, body fat, resting heart rate' },
  activity: { label: 'Activity', detail: 'Steps, distance, energy burned, workouts' },
  sleep: { label: 'Sleep and recovery', detail: 'Sleep time and scores, readiness' },
  nutrition: { label: 'Food', detail: 'Meals logged and daily energy and protein eaten' },
  training: { label: 'Training log', detail: 'Plan check-offs, exercises, sore or injured muscles' },
  plan: { label: 'Plan and goals', detail: 'Your plan, targets and setup answers (no name)' },
};

export type ShareDays = 7 | 30 | 90 | null;
export type Scope = { days: ShareDays; categories: Category[] };
export const FULL_SCOPE: Scope = { days: null, categories: [...categories] };

export const OMITTED = [
  'Your display name',
  'Meal photos and screenshots (and any text read from them)',
  'Location: the app records none',
  'Passwords, keys and the link credential',
] as const;

const metricCategory: Record<string, Category> = {
  weight: 'body', weight_change: 'body', body_fat: 'body', waist: 'body', resting_heart_rate: 'body',
  steps: 'activity', distance: 'activity', floors: 'activity', active_minutes: 'activity', active_energy: 'activity',
  total_energy: 'activity', exercise_session: 'activity', cardio_score: 'activity',
  sleep_duration: 'sleep', sleep_score: 'sleep', readiness_score: 'sleep',
  energy_intake: 'nutrition', protein_intake: 'nutrition',
};
/** Plan-defined measurements (custom metric ids) are body measurements. */
export const categoryOf = (metric: string): Category => metricCategory[metric] ?? 'body';

type Value = {
  date: LocalDate;
  metric: string;
  label: string;
  value: number;
  unit: string;
  kind: Observation['kind'];
  source: { type: Observation['source']['type']; app: string | null; confidence: number | null; edited: boolean };
  note?: string;
  workout?: { type: string | null; start: string; end: string; distanceMeters?: number };
};

const value = (o: Observation): Value => ({
  date: o.date,
  metric: o.metric,
  label: metricDef(o.metric)?.label ?? o.label ?? o.metric,
  value: o.value,
  unit: o.unit,
  kind: o.kind,
  source: { type: o.source.type, app: o.source.app, confidence: o.source.confidence, edited: o.source.edited },
  ...(o.note ? { note: o.note } : {}),
  ...(o.activity ? { workout: { type: o.label, start: o.activity.start, end: o.activity.end, ...(o.activity.distanceMeters !== undefined ? { distanceMeters: o.activity.distanceMeters } : {}) } } : {}),
});

const meal = (m: MealLog) => {
  const sum = (k: 'energyKj' | 'proteinG' | 'carbsG' | 'fatG') => {
    const xs = m.items.map((i) => i[k]).filter((x): x is number => x !== null);
    return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) * 10) / 10 : null;
  };
  return {
    date: m.date,
    at: m.at,
    name: m.name,
    replacedPlannedMeal: m.replacedLabel,
    items: m.items.map((i) => ({ name: i.name, quantity: i.quantity, unit: i.unit, energyKj: i.energyKj, proteinG: i.proteinG, carbsG: i.carbsG, fatG: i.fatG })),
    totals: { energyKj: sum('energyKj'), proteinG: sum('proteinG'), carbsG: sum('carbsG'), fatG: sum('fatG') },
    source: m.source === 'photo-ai' ? 'estimated from a photo by AI, checked by the user' : 'typed in by the user',
    confidence: m.confidence,
    edited: m.edited,
  };
};

/** The plan as data, without the display name. */
function planData(json: string): unknown {
  try {
    const plan = JSON.parse(json) as { profile?: Record<string, unknown> };
    if (plan.profile) {
      const { displayName: _name, ...profile } = plan.profile;
      return { ...plan, profile };
    }
    return plan;
  } catch {
    return null;
  }
}

export function buildHealthPayload(s: StoreSnapshot, meta: { generatedAt: string; today: LocalDate; appVersion: string }, scope: Scope = FULL_SCOPE) {
  const from = scope.days ? addDays(meta.today, -(scope.days - 1)) : null;
  const inScope = (d: string) => (!from || d >= from) && d <= meta.today;
  const want = new Set(scope.categories);
  const obs = s.observations.filter((o) => inScope(o.date) && want.has(categoryOf(o.metric)));
  const of = (c: Category) => obs.filter((o) => categoryOf(o.metric) === c).map(value);
  const meals = want.has('nutrition') ? (s.mealLogs ?? []).filter((m) => inScope(m.date)).map(meal) : [];
  const training = want.has('training')
    ? {
        checklist: s.activityLogs.filter((a) => inScope(a.date) && a.status !== 'pending').map((a) => ({ date: a.date, item: a.labelSnapshot, status: a.status, count: a.count, ...(a.variant ? { variant: a.variant } : {}), ...(a.exercisesDone?.length ? { exercisesDone: a.exercisesDone } : {}) })),
        exercises: (s.exerciseLogs ?? []).filter((l) => inScope(l.date)).map((l) => ({ date: l.date, movement: l.movement, sets: l.sets, reps: l.reps, seconds: l.seconds, ...(l.loadKg != null ? { loadKg: l.loadKg } : {}), ...(l.rir != null ? { rir: l.rir } : {}), ...(l.routine ? { routine: l.routine } : {}), status: l.status ?? 'done' })),
        muscleReports: (s.muscleReports ?? []).filter((r) => inScope(r.at.slice(0, 10)) || r.clearedAt === null).map((r) => ({ muscle: r.muscle, kind: r.kind, at: r.at, clearedAt: r.clearedAt })),
      }
    : null;
  const sections = {
    ...(want.has('plan') && s.plans[0] ? { plan: { revision: s.plans[0].revision, data: planData(s.plans[0].json) } } : {}),
    ...(want.has('body') ? { body: of('body') } : {}),
    ...(want.has('activity') ? { activity: of('activity') } : {}),
    ...(want.has('sleep') ? { sleep: of('sleep') } : {}),
    ...(want.has('nutrition') ? { nutrition: { dailyTotals: of('nutrition'), meals } } : {}),
    ...(training ? { training } : {}),
  };
  const dates = [...obs.map((o) => o.date), ...meals.map((m) => m.date), ...(training ? [...training.checklist, ...training.exercises].map((x) => x.date) : [])].sort();
  return {
    schema: HEALTH_SCHEMA,
    schemaVersion: HEALTH_SCHEMA_VERSION,
    generatedAt: meta.generatedAt,
    app: { name: 'Body Anvil', version: meta.appVersion },
    coverage: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null, requestedFrom: from, requestedTo: meta.today },
    scope: { days: scope.days, categories: categories.filter((c) => want.has(c)) },
    counts: {
      values: obs.length,
      meals: meals.length,
      checklist: training?.checklist.length ?? 0,
      exercises: training?.exercises.length ?? 0,
      muscleReports: training?.muscleReports.length ?? 0,
    },
    readMe: [
      'Personal health and fitness records from the Body Anvil app. Each value has a date (the day it is about), a unit and its source.',
      'source.type: manual = entered by the user; screenshot = read from a screenshot and confirmed by the user; integration = imported (e.g. Health Connect).',
      'kind: observed = recorded; inferred = calculated by the app. Planned meals are never counted as eaten; only logged meals and recorded daily totals are.',
      'Days with no record are missing data, not zero.',
    ],
    omitted: [...OMITTED],
    ...sections,
  };
}

export type HealthPayload = ReturnType<typeof buildHealthPayload>;

/** UTF-8 byte length of a string (no TextEncoder dependency). */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}
