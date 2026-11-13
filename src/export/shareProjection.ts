import type { AiExport } from './aiExport';

/**
 * What a read-only link shows (#171): the Worker's `projectExport` (questspirestudio worker/export.mjs), mirrored here
 * so the phone can preview before it is linked ("Share as text") and the tests' fake server behaves like the Worker.
 * The same document, scoped by period and categories; coverage, database start, read-me and units always stay.
 * Keep in step with the Worker: the real-Worker check in docs/health-sync-api.md compares the two.
 */

export const shareCategories = ['measurements', 'activity', 'sleep', 'nutrition', 'training', 'plan'] as const;
export type ShareCategory = (typeof shareCategories)[number];
export type ShareRange = 7 | 30 | 90 | 'all';
export type ShareFormat = 'records' | 'summary';
export type ProjectionScope = { range: ShareRange; categories: readonly ShareCategory[]; format: ShareFormat };

const DAY = 86_400_000;
const ACTIVITY = ['steps', 'distance', 'floors', 'active_minutes', 'active_energy', 'total_energy', 'exercise_session', 'cardio_score'];
const SLEEP = ['sleep_duration', 'sleep_score', 'readiness_score'];
const NUTRITION = ['energy_intake', 'protein_intake'];
export const metricCategory = (metric: string): ShareCategory =>
  ACTIVITY.includes(metric) ? 'activity' : SLEEP.includes(metric) ? 'sleep' : NUTRITION.includes(metric) ? 'nutrition' : 'measurements';

type Dated = { date: string; value: number };
function stats(xs: Dated[]) {
  const s = [...xs].sort((a, b) => a.date.localeCompare(b.date));
  const v = s.map((x) => x.value);
  return { count: v.length, mean: v.reduce((a, b) => a + b, 0) / v.length, min: Math.min(...v), max: Math.max(...v), first: { date: s[0].date, value: s[0].value }, last: { date: s[s.length - 1].date, value: s[s.length - 1].value } };
}
function groupBy<T>(xs: T[], key: (x: T) => string) {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return [...m.values()];
}

export function projectExport(doc: AiExport, scope: ProjectionScope) {
  const { range, categories, format } = scope;
  const to = doc.asOf;
  const from = range === 'all' ? null : new Date(Date.parse(to) - (range - 1) * DAY).toISOString().slice(0, 10);
  const inRange = (d: string) => from === null || d >= from;
  const measurements = doc.measurements.filter((m) => inRange(m.date) && categories.includes(metricCategory(m.metric)));
  const food = categories.includes('nutrition') ? doc.food.filter((d) => inRange(d.date)) : [];
  const sessions = categories.includes('training') ? doc.training.sessions.filter((s) => inRange(s.date)) : [];
  const exercises = categories.includes('training') ? doc.training.exercises.filter((e) => inRange(e.date)) : [];
  const kept = {
    schemaVersion: doc.schemaVersion, format: doc.format, version: doc.version, appVersion: doc.appVersion, generatedAt: doc.generatedAt,
    timezone: doc.timezone, asOf: doc.asOf, share: { format, range, categories: [...categories], from, to }, readMe: doc.readMe,
    units: doc.units, database: doc.database, coverage: doc.coverage, plan: categories.includes('plan') ? doc.plan : null,
  };
  if (format === 'records') return { ...kept, measurements, food, training: { sessions, exercises } };
  const done = food.filter((d) => d.status === 'complete');
  const mean = (k: 'energyKj' | 'proteinG') => (done.length ? done.reduce((a, d) => a + (d.eaten[k] ?? 0), 0) / done.length : null);
  return {
    ...kept,
    measurements: groupBy(measurements, (m) => `${m.metric}|${m.unit}|${m.source.type}`).map((ms) => ({ metric: ms[0].metric, unit: ms[0].unit, source: ms[0].source.type, ...stats(ms) })),
    food: {
      days: Object.fromEntries(['complete', 'partial', 'missing', 'in progress'].map((s) => [s, food.filter((d) => d.status === s).length])),
      completeDays: { count: done.length, meanEnergyKj: mean('energyKj'), meanProteinG: mean('proteinG') },
      plannedMeals: Object.fromEntries(['eaten (ticked)', 'replaced', 'skipped', 'not ticked'].map((s) => [s, food.reduce((n, d) => n + d.plannedMeals.filter((p) => p.status === s).length, 0)])),
      loggedMeals: food.reduce((n, d) => n + d.loggedMeals.length, 0),
    },
    training: {
      sessions: Object.fromEntries(['done', 'skipped', 'partial'].map((s) => [s, sessions.filter((x) => x.status === s).length])),
      exercises: groupBy(exercises.filter((e) => e.status === 'done'), (e) => e.movement).map((es) => {
        const dates = es.map((e) => e.date).sort();
        return {
          movement: es[0].movement, days: new Set(dates).size, sets: es.reduce((n, e) => n + (e.sets ?? 0), 0),
          maxLoadKg: es.some((e) => e.loadKg !== null) ? Math.max(...es.map((e) => e.loadKg ?? 0)) : null, first: dates[0], last: dates[dates.length - 1],
        };
      }),
    },
  };
}
export type SharedExport = ReturnType<typeof projectExport>;
