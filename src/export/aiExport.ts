import { dayIntake, mealDates } from '../nutrition/intake';
import { confirmedMeals, nutritionTargets } from '../nutrition/plannedMeals';
import { mealTotals } from '../nutrition/totals';
import type { MealLog } from '../nutrition/contract';
import { toCanonical } from '../observations/units';
import { addDays, type LocalDate } from '../plan/dates';
import type { Plan } from '../plan/schema';
import { validatePlan } from '../plan/validate';
import type { StoreSnapshot } from '../storage/types';

/**
 * The detailed progress export for an AI (#167), built on the phone and shared as a file. Pure.
 *
 * It says what the data covers, so a reader doesn't take missing history for missed logging:
 * - **database**: when this phone's current database started (or was first seen, for databases older than this
 *   field), and its earliest retained record. Earlier app history may have been lost (e.g. reinstalling from a
 *   different source); days before this are *not covered*, not "not logged".
 * - **coverage by source**: app records vs Health Connect imports, separately, since imports can reach back further.
 * - **values**: a value of 0 is a real zero; a day or metric that isn't listed is missing; `partial` means some of
 *   that day's food has no value; days before the app's coverage aren't listed at all.
 * - **food**: what was eaten (logged meals and ticked plan meals at their estimates, #154) kept apart from what was
 *   planned, meal by meal, with completeness.
 * - **training**: plan sessions (ticked exercises) and the exercise log (movement, sets, reps, load, effort).
 *
 * Never included: the display name, meal photos or any image, screenshot text, location (none recorded), credentials.
 */

export const AI_EXPORT_FORMAT = 'body-anvil-ai-export';
/** Version 2 (#171): the same document is the sync snapshot (`schemaVersion: 2`) and what share links return. */
export const AI_EXPORT_VERSION = 2;
/** app_meta key: when this database started, recorded once (`noteDatabaseStart`). */
export const DATABASE_START_KEY = 'database.startedAt';

export type DatabaseStart = { at: string; kind: 'created' | 'firstSeen' };

export type AiExportMeta = {
  generatedAt: string;
  timezone: string;
  today: LocalDate;
  appVersion: string;
  databaseStart: DatabaseStart | null;
};

const parsePlan = (json: string): Plan | null => {
  try {
    const r = validatePlan(JSON.parse(json));
    return r.ok ? r.plan : null;
  } catch {
    return null;
  }
};
/**
 * #181: every value fits the server's contract (questspirestudio worker/export.mjs), so one odd record can't make the
 * whole sync fail: text without line breaks and within its length, ids in the allowed pattern, counts as whole numbers.
 */
const fit = (v: string, max: number) => v.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);
const fitOrNull = (v: string | null | undefined, max: number) => (v == null ? null : fit(v, max));
const safeId = (v: string) => (v.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 80) || '_');
const whole = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.min(1e6, Math.max(0, Math.round(v))));
/** Several apps joined with "," (#44), kept to whole names within 60 characters: "fitbit,phone,+2". */
function fitApps(v: string | null): string | null {
  if (v == null) return null;
  const clean = fit(v, 1000);
  if (clean.length <= 60) return clean;
  const parts = clean.split(',');
  const kept: string[] = [];
  for (const p of parts) if ([...kept, p, `+${parts.length}`].join(',').length <= 60) kept.push(p);
  return kept.length ? `${kept.join(',')},+${parts.length - kept.length}` : clean.slice(0, 60);
}
const span = (dates: string[]) => {
  const d = [...dates].sort();
  return d.length ? { from: d[0], to: d[d.length - 1] } : null;
};
const round = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

export function buildAiExport(s: StoreSnapshot, meta: AiExportMeta) {
  const today = meta.today;
  const upTo = <T extends { date: string }>(xs: T[]) => xs.filter((x) => x.date <= today);
  const obs = upTo(s.observations);
  const mealLogs: MealLog[] = upTo(s.mealLogs ?? []);
  const activityLogs = upTo(s.activityLogs);
  const exerciseLogs = upTo(s.exerciseLogs ?? []);
  const plans = new Map(s.plans.map((p) => [p.planId, parsePlan(p.json)]));
  const plan = s.plans[0] ? plans.get(s.plans[0].planId) ?? null : null;

  // Coverage: what this database holds from the app itself vs what Health Connect imported (which can be older).
  const appObs = obs.filter((o) => o.source.type !== 'integration');
  const imported = obs.filter((o) => o.source.type === 'integration');
  const appDates = [...appObs.map((o) => o.date), ...mealLogs.map((m) => m.date), ...activityLogs.map((a) => a.date), ...exerciseLogs.map((e) => e.date)];
  const app = span(appDates);
  const earliest = span([...appDates, ...imported.map((o) => o.date)])?.from ?? null;

  // Food per day, over the app's own coverage only (earlier days aren't covered, so they aren't listed).
  const ticked = confirmedMeals(activityLogs, mealLogs, (_d, planId) => plans.get(planId) ?? null);
  const foodDays = app ? enumerate(app.from, today) : [];
  const { energy: energyT, protein: proteinT } = plan ? nutritionTargets(plan) : { energy: null, protein: null };
  const plannedMeals = plan?.activities.filter((a) => a.kind === 'meal') ?? [];
  const food = foodDays.map((date) => {
    const d = dayIntake(date, mealLogs, obs, ticked);
    const logs = activityLogs.filter((a) => a.date === date);
    const planned = plannedMeals.map((m) => {
      const log = logs.find((a) => a.activityId === m.id);
      const replaced = d.meals.find((x) => x.activityId === m.id);
      const e = energyT ? m.nutrition?.[energyT.id] : undefined;
      const p = proteinT ? m.nutrition?.[proteinT.id] : undefined;
      return {
        activityId: safeId(m.id),
        label: fit(m.label, 80),
        status: replaced ? 'replaced' : log?.status === 'done' ? 'eaten (ticked)' : log?.status === 'skipped' ? 'skipped' : 'not ticked',
        plannedEnergyKj: e === undefined || !plan ? null : round(plan.units.energy === 'kJ' ? e : e * 4.184),
        plannedProteinG: p ?? null,
      };
    });
    const logged = d.meals.map((m) => {
      const t = mealTotals(m.items);
      return {
        id: safeId(m.id),
        at: m.at,
        name: fit(m.name, 120),
        replaces: fitOrNull(m.replacedLabel, 80),
        energyKj: round(t.energyKj),
        proteinG: round(t.proteinG),
        carbsG: round(t.carbsG),
        fatG: round(t.fatG),
        complete: t.unknown.energyKj === 0 && t.unknown.proteinG === 0,
        source: m.source,
      };
    });
    const v = d.values;
    const anything = d.meals.length > 0 || d.confirmed.length > 0 || v.energyKj?.from === 'day-total' || v.proteinG?.from === 'day-total';
    const status = date === today ? 'in progress' : !anything ? 'missing' : v.energyKj?.incomplete || v.proteinG?.incomplete || !v.energyKj ? 'partial' : 'complete';
    return {
      date,
      status,
      eaten: { energyKj: round(v.energyKj?.value ?? null), proteinG: round(v.proteinG?.value ?? null), carbsG: round(v.carbsG?.value ?? null), fatG: round(v.fatG?.value ?? null), from: v.energyKj?.from ?? v.proteinG?.from ?? null },
      plannedMeals: planned,
      loggedMeals: logged,
    };
  });

  return {
    schemaVersion: 2 as const,
    format: AI_EXPORT_FORMAT,
    version: AI_EXPORT_VERSION,
    appVersion: /^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(meta.appVersion) ? meta.appVersion : '0.0.0',
    generatedAt: meta.generatedAt,
    timezone: meta.timezone.slice(0, 64),
    /** The local date this export runs to: nothing after it is included. */
    asOf: today,
    readMe: [
      'Personal fitness records exported from the Body Anvil app for analysis.',
      'Coverage: app records only exist from `database.startedAt` / `coverage.app.from`. Earlier app history may have been lost (for example when the app was reinstalled from a different source). Do not treat days before that as missed logging: they are not covered.',
      'Health Connect imports (`coverage.healthConnect`) can reach further back than the app records. The two do not have equal coverage.',
      'A value of 0 is a real zero. A day or metric that is not listed is missing. Food status: complete, partial (some food has no value), missing (nothing recorded that day), or in progress (today).',
      'Eaten food is logged meals plus planned meals the user ticked as eaten (counted at the plan’s estimates). Planned meals that were not ticked were not eaten as far as the app knows.',
      'Dates are local calendar dates in `timezone`. Units are in `units`.',
      'From a share link, `share` says which period (`from`–`to`) and categories were chosen: nothing outside them is included, and that is a choice, not missing data. With `share.format` "summary", each list is replaced by statistics over the whole period (count, mean, min, max, first, last) because the full history was too long for one link.',
    ],
    units: { mass: 'kg', length: 'cm', energy: 'kJ (1 kcal = 4.184 kJ)', protein: 'g', duration: 'min', distance: 'km', bodyFat: '%' },
    database: {
      startedAt: meta.databaseStart?.at ?? null,
      /** `created`: recorded when this database was new. `firstSeen`: the database already had data when this was first recorded, so it started earlier. */
      startedAtKind: meta.databaseStart?.kind ?? null,
      earliestRetainedRecord: earliest,
      installSource: null,
      installSourceNote: 'Not recorded by the app.',
    },
    coverage: { app, healthConnect: span(imported.map((o) => o.date)) },
    plan: plan
      ? {
          energyTargetKj: energyT ? round((energyT.max ?? energyT.min ?? 0) * (plan.units.energy === 'kJ' ? 1 : 4.184)) : null,
          proteinTargetG: proteinT ? proteinT.min ?? proteinT.max ?? null : null,
          weightGoalKg: (() => {
            const g = plan.goals.find((x) => x.measurementId === 'weight');
            return g ? round(toCanonical(g.target, plan.units.mass, 'mass')) : null;
          })(),
        }
      : null,
    measurements: obs
      .filter((o) => o.kind === 'observed')
      .map((o) => ({ id: safeId(o.id), date: o.date, recordedAt: o.recordedAt, metric: o.metric, value: o.value, unit: fit(o.unit, 16), source: { type: o.source.type === 'integration' ? 'healthConnect' : o.source.type, app: fitApps(o.source.app), edited: o.source.edited } }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.metric.localeCompare(b.metric) || a.recordedAt.localeCompare(b.recordedAt)),
    food,
    training: {
      sessions: activityLogs
        .filter((a) => plans.get(a.planId)?.activities.find((x) => x.id === a.activityId)?.kind === 'exercise' && a.status !== 'pending')
        .map((a) => ({ date: a.date, activityId: safeId(a.activityId), label: fit(a.labelSnapshot, 80), status: a.status, variant: a.variant ?? 'full', exercisesDone: (a.exercisesDone ?? []).slice(0, 60).map((x) => fit(x, 80)) }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      exercises: exerciseLogs
        .map((l) => ({ id: safeId(l.id), date: l.date, movement: l.movement, sets: whole(l.sets), reps: whole(l.reps), seconds: whole(l.seconds), loadKg: l.loadKg ?? null, rir: l.rir ?? null, routine: fitOrNull(l.routine, 40), status: l.status ?? 'done' }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    },
    counts: { measurements: obs.length, foodDays: food.length, loggedMeals: mealLogs.length, mealDays: mealDates(mealLogs, ticked).length, sessions: activityLogs.length, exercises: exerciseLogs.length },
  };
}

export type AiExport = ReturnType<typeof buildAiExport>;

function enumerate(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = from; d <= to && out.length < 3660; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Record once when this database started (#167). A database with no records yet is new (`created`); one that already
 * has records was started before this was recorded (`firstSeen`): it is never claimed as the creation time.
 */
export async function noteDatabaseStart(store: { getMeta(k: string): Promise<string | null>; ensureMeta(k: string, v: string): Promise<string>; snapshot(): Promise<StoreSnapshot> }, now: string) {
  if (await store.getMeta(DATABASE_START_KEY)) return;
  const s = await store.snapshot();
  const hasRecords = s.observations.length + s.activityLogs.length + (s.mealLogs ?? []).length + (s.exerciseLogs ?? []).length > 0;
  await store.ensureMeta(DATABASE_START_KEY, JSON.stringify({ at: now, kind: hasRecords ? 'firstSeen' : 'created' } satisfies DatabaseStart));
}

export async function databaseStart(store: { getMeta(k: string): Promise<string | null> }): Promise<DatabaseStart | null> {
  try {
    const raw = await store.getMeta(DATABASE_START_KEY);
    return raw ? (JSON.parse(raw) as DatabaseStart) : null;
  } catch {
    return null;
  }
}
