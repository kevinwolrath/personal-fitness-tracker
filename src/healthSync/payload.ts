import { convertEnergy } from '../energy';
import type { MealLog } from '../nutrition/contract';
import { dayIntake, mealDates } from '../nutrition/intake';
import { confirmedMeals, nutritionTargets } from '../nutrition/plannedMeals';
import { toCanonical } from '../observations/units';
import type { Observation } from '../observations/types';
import { addDays, type LocalDate } from '../plan/dates';
import type { Plan } from '../plan/schema';
import { validatePlan } from '../plan/validate';
import type { StoreSnapshot } from '../storage/types';

/**
 * The snapshot Body Anvil uploads (#134, #163), in the deployed Worker's wire format (questspirestudio
 * docs/body-anvil/SYNC_API.md, worker/snapshot.mjs). Pure.
 *
 * `{ schemaVersion: 1, appVersion, coverage: { from, to }, records: [{ date, category, metric, value, source }] }`:
 * dated numbers only, in fixed units (kg, cm, %, km, kcal, min, g). The Worker rejects any other key, so nothing else
 * can leave the phone: no names, meal or exercise names, notes, photos, screenshots, location or credentials.
 *
 * - Observations recorded on a day become records as they are (each separately; inferred values are left out).
 * - Food: a day total (entered or imported) is sent as recorded; on days without one, the day's meals (logged meals and
 *   ticked plan meals at their estimates, #154) are sent as one `app` total, never both (contract 15).
 * - Training: per day, sessions done (plan workouts ticked), their planned minutes, and sets, reps and volume from the
 *   exercise log.
 * - Plan: today's energy and protein targets and the weight goal, as `plan` records (separate from what happened).
 */

export const SCHEMA_VERSION = 1;
/** The Worker's limits (worker/snapshot.mjs). */
export const MAX_RECORDS = 15_000;
export const MAX_SNAPSHOT_BYTES = 1024 * 1024;

export const categories = ['measurements', 'activity', 'sleep', 'nutrition', 'training', 'plan'] as const;
export type Category = (typeof categories)[number];
export const categoryLabels: Record<Category, { label: string; detail: string }> = {
  measurements: { label: 'Body measurements', detail: 'Weight, waist, body fat' },
  activity: { label: 'Activity', detail: 'Steps, distance, active energy and minutes' },
  sleep: { label: 'Sleep', detail: 'Time asleep' },
  nutrition: { label: 'Food', detail: 'Daily energy, protein, carbs, fat and meals eaten' },
  training: { label: 'Training', detail: 'Workouts done, minutes, sets, reps and volume' },
  plan: { label: 'Plan targets', detail: 'Energy and protein targets, weight goal' },
};

export type Source = 'manual' | 'screenshot' | 'healthConnect' | 'integration' | 'app' | 'plan';
export type SyncRecord = { date: LocalDate; category: Category; metric: string; value: number; source: Source };
export type SyncSnapshot = { schemaVersion: 1; appVersion: string; coverage: { from: LocalDate | null; to: LocalDate }; records: SyncRecord[] };

export type ShareRange = 7 | 30 | 90 | 'all';
export type Scope = { range: ShareRange; categories: Category[] };

export const OMITTED = [
  'Your name, and the names of meals, foods and exercises',
  'Notes, meal photos and screenshots',
  'Location: the app records none',
  'Passwords, keys and the link credential',
] as const;

const KCAL_PER_KJ = 1 / 4.184;
const round = (v: number, dp = 2) => Math.round(v * 10 ** dp) / 10 ** dp;

/** App metric → Worker category and metric. Values are already in the Worker's unit except energy (kJ → kcal). */
const observed: Record<string, { category: Category; metric: string; energy?: true }> = {
  weight: { category: 'measurements', metric: 'weight' },
  waist: { category: 'measurements', metric: 'waist' },
  body_fat: { category: 'measurements', metric: 'bodyFat' },
  steps: { category: 'activity', metric: 'steps' },
  active_energy: { category: 'activity', metric: 'activeEnergy', energy: true },
  active_minutes: { category: 'activity', metric: 'activeMinutes' },
  distance: { category: 'activity', metric: 'distance' },
  sleep_duration: { category: 'sleep', metric: 'duration' },
  energy_intake: { category: 'nutrition', metric: 'energy', energy: true },
  protein_intake: { category: 'nutrition', metric: 'protein' },
};

const sourceOf = (o: Observation): Source => (o.source.type === 'integration' ? 'healthConnect' : o.source.type === 'screenshot' ? 'screenshot' : 'manual');

/** A numeric `major.minor.patch` (the Worker rejects anything else). */
export const wireVersion = (v: string) => (/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(v) ? v : '0.0.0');

function parsePlan(json: string): Plan | null {
  try {
    const r = validatePlan(JSON.parse(json));
    return r.ok ? r.plan : null;
  } catch {
    return null;
  }
}

export function buildSnapshot(s: StoreSnapshot, meta: { today: LocalDate; appVersion: string }): SyncSnapshot {
  const today = meta.today;
  const out: SyncRecord[] = [];
  const add = (date: LocalDate, category: Category, metric: string, value: number | null, source: Source) => {
    if (value === null || !Number.isFinite(value) || value < 0 || value > 1e9 || date > today) return;
    if (metric === 'bodyFat' && value > 100) return;
    out.push({ date, category, metric, value: round(value), source });
  };

  for (const o of s.observations) {
    const m = observed[o.metric];
    if (!m || o.kind !== 'observed') continue;
    add(o.date, m.category, m.metric, m.energy ? o.value * KCAL_PER_KJ : o.value, sourceOf(o));
  }

  // Food from meals, only on days without a day total of their own (dayIntake decides, as on Today).
  const plans = new Map(s.plans.map((p) => [p.planId, parsePlan(p.json)]));
  const mealLogs: MealLog[] = s.mealLogs ?? [];
  const ticked = confirmedMeals(s.activityLogs, mealLogs, (_d, planId) => plans.get(planId) ?? null);
  for (const date of mealDates(mealLogs, ticked)) {
    const d = dayIntake(date, mealLogs, s.observations, ticked);
    const v = d.values;
    if (v.energyKj?.from === 'meals') add(date, 'nutrition', 'energy', v.energyKj.value * KCAL_PER_KJ, 'app');
    if (v.proteinG?.from === 'meals') add(date, 'nutrition', 'protein', v.proteinG.value, 'app');
    if (v.carbsG) add(date, 'nutrition', 'carbs', v.carbsG.value, 'app');
    if (v.fatG) add(date, 'nutrition', 'fat', v.fatG.value, 'app');
    add(date, 'nutrition', 'meals', d.meals.length + d.confirmed.length, 'app');
  }

  // Training per day: ticked plan workouts and the exercise log.
  const sessions = new Map<string, { n: number; minutes: number }>();
  for (const a of s.activityLogs) {
    if (a.status !== 'done') continue;
    const act = plans.get(a.planId)?.activities.find((x) => x.id === a.activityId);
    if (act?.kind !== 'exercise') continue;
    const t = sessions.get(a.date) ?? { n: 0, minutes: 0 };
    t.n += 1;
    const dur = act.duration;
    if (dur) t.minutes += a.variant === 'short' && 'min' in dur ? dur.min : 'minutes' in dur ? dur.minutes : dur.max;
    sessions.set(a.date, t);
  }
  for (const [date, t] of sessions) {
    add(date, 'training', 'sessions', t.n, 'app');
    if (t.minutes) add(date, 'training', 'duration', t.minutes, 'app');
  }
  const lifting = new Map<string, { sets: number; reps: number; volume: number }>();
  for (const l of s.exerciseLogs ?? []) {
    if ((l.status ?? 'done') !== 'done' || !l.sets) continue;
    const t = lifting.get(l.date) ?? { sets: 0, reps: 0, volume: 0 };
    t.sets += l.sets;
    if (l.reps) {
      t.reps += l.sets * l.reps;
      if (l.loadKg) t.volume += l.sets * l.reps * l.loadKg;
    }
    lifting.set(l.date, t);
  }
  for (const [date, t] of lifting) {
    add(date, 'training', 'sets', t.sets, 'app');
    if (t.reps) add(date, 'training', 'reps', t.reps, 'app');
    if (t.volume) add(date, 'training', 'volume', t.volume, 'app');
  }

  // Today's plan targets.
  const plan = s.plans[0] ? plans.get(s.plans[0].planId) : null;
  if (plan) {
    const { energy, protein } = nutritionTargets(plan);
    const e = energy ? energy.max ?? energy.min : undefined;
    if (e !== undefined) add(today, 'plan', 'energyTarget', convertEnergy(e, plan.units.energy, 'kcal'), 'plan');
    const p = protein ? protein.min ?? protein.max : undefined;
    if (p !== undefined) add(today, 'plan', 'proteinTarget', p, 'plan');
    const goal = plan.goals.find((g) => g.measurementId === 'weight');
    if (goal) add(today, 'plan', 'weightTarget', toCanonical(goal.target, plan.units.mass, 'mass'), 'plan');
  }

  out.sort((a, b) => a.date.localeCompare(b.date) || a.category.localeCompare(b.category) || a.metric.localeCompare(b.metric));
  return { schemaVersion: SCHEMA_VERSION, appVersion: wireVersion(meta.appVersion), coverage: { from: out[0]?.date ?? null, to: today }, records: out };
}

/**
 * What a read-only link with this scope shows, worked out on the phone the same way the Worker does
 * (worker/snapshot.mjs `projectShare`, "records" format). Used to preview before the phone is linked, and for
 * "Share as text".
 */
export function projectShare(snapshot: SyncSnapshot, scope: Scope) {
  const to = snapshot.coverage.to;
  const from = scope.range === 'all' ? null : addDays(to, -(scope.range - 1));
  const records = snapshot.records.filter((r) => scope.categories.includes(r.category) && (from === null || r.date >= from));
  const dates = records.map((r) => r.date).sort();
  return {
    schemaVersion: snapshot.schemaVersion,
    provenance: { app: 'Body Anvil', appVersion: snapshot.appVersion },
    format: 'records' as const,
    requested: { range: scope.range, categories: scope.categories, from, to },
    coverage: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null },
    data: records,
  };
}

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
