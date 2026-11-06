import { addDays, weekdayOf, type LocalDate } from '../plan/dates';
import type { Weekday } from '../plan/schema';
import type { Eligibility, Inventory, InventoryExercise, MuscleId } from './inventory';

/**
 * Muscle-group coverage, recovery and exercise priority (#56). Pure and deterministic: the same history, reports
 * and time always give the same answer. Advisory only: it orders and explains, it never blocks a choice or tells
 * the user to train every muscle every day. No exercise or muscle is named here; mappings come from the inventory.
 *
 * Recovery is independent of priority: a muscle can need training (low weekly volume) and still be recovering.
 * Recovery windows are planning defaults, not physiological guarantees; a user report (sore, injured) always wins.
 */

/** Tunable constants (#56). Change them here; tests pin the behaviour they produce. */
export const COVERAGE = {
  /** Contribution of one set to each muscle. */
  contribution: { primary: 1, secondary: 0.5 },
  /** How much a set counts by intensity. */
  intensityFactor: { light: 0.5, moderate: 1, hard: 1 },
  /** A set counts fully from this many reps (or seconds, for holds); fewer count proportionally, so one push-up is not a set. */
  repsForFullSet: 6,
  secondsForFullSet: 20,
  /** Effective sets per muscle over the window for "adequately trained". */
  weeklyTargetSets: 6,
  /** At or above this share of the target: amber (approaching); below: red (due). */
  amberFraction: 0.5,
  /** The volume window, in training days: rest days don't count, so they never make a muscle overdue. */
  windowTrainingDays: 7,
  /** Until history spans this many days, an untrained or barely trained muscle is neutral, never red. */
  minHistoryDays: 7,
  /** A day's load on a muscle below this needs no recovery (e.g. a few stray reps). */
  trivialLoad: 0.5,
  /** Day load (effective sets on the muscle) at or below this is a light session; at or above `demandingLoadMin`, particularly demanding. */
  lightLoadMax: 2,
  demandingLoadMin: 6,
  recoveryHours: { light: 24, hard: 48, demanding: 72 },
  /** Need given to a neutral (unknown) muscle, so its exercises still sort sensibly. */
  unknownNeed: 0.5,
} as const;

export type Intensity = keyof typeof COVERAGE.intensityFactor;

/** One completed exercise, from any source. Sessions and free logs are disjoint by construction, so nothing counts twice. */
export type ExerciseEntry = {
  /** Stable id; the same id twice is counted once. */
  id: string;
  movement: string;
  date: LocalDate;
  /** ISO timestamp with offset. */
  at: string;
  /** Completed sets (rounds for conditioning). */
  sets: number;
  reps?: number;
  seconds?: number;
  intensity?: Intensity;
  source: 'session' | 'free' | 'activity';
};

/** A user report that overrides automatic readiness until cleared. */
export type MuscleReport = { id: string; muscle: MuscleId; kind: 'sore' | 'injured'; at: string; clearedAt: string | null };

/**
 * green: adequately trained in the window; amber: approaching the next appropriate training opportunity;
 * red: due or overdue (only once recovered); recovering / unavailable (user report) / unknown (not enough data yet).
 */
export type MuscleStatus = 'green' | 'amber' | 'red' | 'recovering' | 'unavailable' | 'unknown';

export type MuscleCoverage = {
  muscle: MuscleId;
  label: string;
  status: MuscleStatus;
  /** Effective sets in the window. */
  volume: number;
  target: number;
  /** When the current recovery window ends (ISO), if recovering. */
  recoveredAt: string | null;
  lastTrainedAt: string | null;
  /** The active report, if any. */
  report: MuscleReport['kind'] | null;
};

const ms = (iso: string) => Date.parse(iso);
const round = (n: number) => Math.round(n * 100) / 100;

/** Effective sets of one entry: sets × intensity, scaled down when reps or hold time are short. */
export function effectiveSets(e: ExerciseEntry): number {
  const perSet =
    e.reps !== undefined ? Math.min(1, e.reps / COVERAGE.repsForFullSet) : e.seconds !== undefined ? Math.min(1, e.seconds / COVERAGE.secondsForFullSet) : 1;
  return Math.max(0, e.sets) * perSet * COVERAGE.intensityFactor[e.intensity ?? 'moderate'];
}

/** The window's first date: walk back from `today` until `windowTrainingDays` non-rest days are covered. */
export function windowStart(today: LocalDate, restDays: readonly Weekday[] = []): LocalDate {
  const rest = new Set(restDays);
  if (rest.size >= 7) return today;
  let d = today;
  let counted = 0;
  for (;;) {
    if (!rest.has(weekdayOf(d))) counted++;
    if (counted >= COVERAGE.windowTrainingDays) return d;
    d = addDays(d, -1);
  }
}

const contributionOf = (ex: InventoryExercise, muscle: MuscleId) =>
  ex.primary.includes(muscle) ? COVERAGE.contribution.primary : ex.secondary.includes(muscle) ? COVERAGE.contribution.secondary : 0;

export type CoverageInput = {
  inventory: Inventory;
  entries: ExerciseEntry[];
  reports?: MuscleReport[];
  /** Now, as ISO, and the local date it falls on. */
  now: string;
  today: LocalDate;
  /** Configured rest days: they never age volume out of the window. */
  restDays?: readonly Weekday[];
};

/** Per-muscle coverage, in the inventory's muscle order. Pure. */
export function muscleCoverage({ inventory, entries, reports = [], now, today, restDays = [] }: CoverageInput): MuscleCoverage[] {
  const byMovement = new Map(inventory.exercises.map((e) => [e.movement, e]));
  const unique = [...new Map(entries.filter((e) => ms(e.at) <= ms(now) && e.date <= today).map((e) => [e.id, e])).values()];
  const known = unique.filter((e) => byMovement.has(e.movement));
  const from = windowStart(today, restDays);
  const firstDate = known.reduce<LocalDate | null>((min, e) => (min === null || e.date < min ? e.date : min), null);
  const enoughHistory = firstDate !== null && firstDate <= addDays(today, -COVERAGE.minHistoryDays);
  const target = COVERAGE.weeklyTargetSets;

  return inventory.muscleGroups.map(({ id: muscle, label }) => {
    const hits = known
      .map((e) => ({ e, load: contributionOf(byMovement.get(e.movement)!, muscle) * effectiveSets(e) }))
      .filter((h) => h.load > 0);
    const volume = round(hits.filter((h) => h.e.date >= from).reduce((s, h) => s + h.load, 0));
    const lastTrainedAt = hits.reduce<string | null>((max, h) => (max === null || ms(h.e.at) > ms(max) ? h.e.at : max), null);

    // Recovery: each day's load on this muscle sets a window from that day's last hit; the latest end wins.
    const days = new Map<LocalDate, { load: number; last: string; hard: boolean }>();
    for (const h of hits) {
      const d = days.get(h.e.date) ?? { load: 0, last: h.e.at, hard: false };
      d.load += h.load;
      if (ms(h.e.at) > ms(d.last)) d.last = h.e.at;
      d.hard ||= h.e.intensity === 'hard';
      days.set(h.e.date, d);
    }
    let recoveredAtMs = -Infinity;
    for (const d of days.values()) {
      if (d.load < COVERAGE.trivialLoad) continue;
      const kind = d.load >= COVERAGE.demandingLoadMin ? 'demanding' : d.load > COVERAGE.lightLoadMax || d.hard ? 'hard' : 'light';
      recoveredAtMs = Math.max(recoveredAtMs, ms(d.last) + COVERAGE.recoveryHours[kind] * 3_600_000);
    }
    const recovering = recoveredAtMs > ms(now);

    const report =
      reports
        .filter((r) => r.muscle === muscle && ms(r.at) <= ms(now) && (r.clearedAt === null || ms(r.clearedAt) > ms(now)))
        .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'injured' ? -1 : 1))[0] ?? null;

    let status: MuscleStatus;
    if (report) status = 'unavailable';
    else if (recovering) status = 'recovering';
    else if (volume >= target) status = 'green';
    else if (volume >= COVERAGE.amberFraction * target) status = 'amber';
    else status = enoughHistory ? 'red' : 'unknown'; // never red on first use: neutral until history exists

    return {
      muscle,
      label,
      status,
      volume,
      target,
      recoveredAt: recovering ? new Date(recoveredAtMs).toISOString() : null,
      lastTrainedAt,
      report: report?.kind ?? null,
    };
  });
}

export type Suggestion = {
  exercise: InventoryExercise;
  caution: boolean;
  /** Higher = more useful now. */
  score: number;
  /** Not suggested now: a primary muscle is recovering or unavailable, or a secondary is unavailable. Still loggable. */
  held: { muscle: MuscleId; status: 'recovering' | 'unavailable' }[];
  doneToday: boolean;
};

const needOf = (c: MuscleCoverage): number => {
  if (c.status === 'unknown') return COVERAGE.unknownNeed;
  if (c.status === 'recovering' || c.status === 'unavailable') return 0;
  return Math.max(0, (c.target - c.volume) / c.target);
};

/**
 * Order eligible exercises by how much they help the muscles that need work (#56). Every exercise stays in the list:
 * the user can pick anything, including repeats. Order: not done today → not held → score → inventory order.
 * Conditioning is kept out unless asked for: it stays separate from strength (its muscle work still counts as history).
 */
export function suggestExercises(
  eligible: Eligibility[],
  coverage: MuscleCoverage[],
  opts: { doneToday?: ReadonlySet<string>; includeConditioning?: boolean } = {},
): Suggestion[] {
  const byMuscle = new Map(coverage.map((c) => [c.muscle, c]));
  const order = new Map(eligible.map((e, i) => [e.exercise.movement, i]));
  return eligible
    .filter((e) => opts.includeConditioning || e.exercise.kind === 'strength')
    .map(({ exercise, caution }) => {
      const held: Suggestion['held'] = [];
      let score = 0;
      for (const [muscles, weight, primary] of [
        [exercise.primary, COVERAGE.contribution.primary, true],
        [exercise.secondary, COVERAGE.contribution.secondary, false],
      ] as const) {
        for (const m of muscles) {
          const c = byMuscle.get(m);
          if (!c) continue;
          if (c.status === 'unavailable' || (primary && c.status === 'recovering')) held.push({ muscle: m, status: c.status });
          score += weight * needOf(c);
        }
      }
      return { exercise, caution, score: round(score), held, doneToday: !!opts.doneToday?.has(exercise.movement) };
    })
    .sort(
      (a, b) =>
        Number(a.doneToday) - Number(b.doneToday) ||
        Number(a.held.length > 0) - Number(b.held.length > 0) ||
        b.score - a.score ||
        order.get(a.exercise.movement)! - order.get(b.exercise.movement)!,
    );
}

/**
 * Option C (#56): keep a scheduled session's exercises, ordered by the same priority. Movements the inventory
 * doesn't know keep their place relative to each other, after the known ones. Stable. Pure.
 */
export function orderSessionMovements(movements: string[], suggestions: Suggestion[]): string[] {
  const rank = new Map(suggestions.map((s, i) => [s.exercise.movement, i]));
  return movements
    .map((m, i) => ({ m, i }))
    .sort((a, b) => (rank.get(a.m) ?? Infinity) - (rank.get(b.m) ?? Infinity) || a.i - b.i)
    .map((x) => x.m);
}
