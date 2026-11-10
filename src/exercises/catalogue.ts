import type { LocalDate } from '../plan/dates';
import { weekdayOf } from '../plan/dates';
import type { MuscleGrowthExercise, Plan } from '../plan/schema';
import type { ExerciseIntensity, ExerciseLog } from '../storage/types';
import { bundledInventory, eligibleExercises, type Inventory, type InventoryExercise } from './inventory';

/**
 * The shared exercise catalogue for a plan (#122): the bundled inventory plus the user's custom exercises
 * (`plan.exercise.customExercises`), with the same shape, so planning, logging, guides and muscle accounting treat
 * them alike. Optional muscle groups (e.g. upper traps) only take part when the plan uses them. Pure.
 */
export function inventoryFor(plan: Pick<Plan, 'exercise'>, base: Inventory = bundledInventory): Inventory {
  const custom = plan.exercise?.customExercises ?? [];
  const known = new Set(base.exercises.map((e) => e.movement));
  const groups = new Set(base.muscleGroups.map((m) => m.id));
  const extra: InventoryExercise[] = custom
    .filter((c) => !known.has(c.movement) && [...c.primary, ...(c.secondary ?? [])].every((m) => groups.has(m)))
    .map((c) => ({
      movement: c.movement,
      name: c.name,
      kind: c.kind ?? 'strength',
      equipment: c.equipment,
      primary: c.primary,
      secondary: c.secondary ?? [],
      ...(c.defaultDose ? { defaultDose: c.defaultDose } : c.kind === 'conditioning' ? {} : { defaultDose: { sets: 2, reps: 10 } }),
    }));
  const used = new Set([...(plan.exercise?.muscleGrowth?.targets ?? []), ...extra.flatMap((e) => [...e.primary, ...e.secondary])]);
  return {
    ...base,
    muscleGroups: base.muscleGroups.filter((m) => !m.optional || used.has(m.id)),
    exercises: [...base.exercises, ...extra],
  };
}

export const isCustomExercise = (plan: Pick<Plan, 'exercise'>, movement: string) => !!plan.exercise?.customExercises?.some((c) => c.movement === movement);

/** Every catalogue problem with a plan's exercise configuration, with config paths (checked on apply, contract 07). */
export function catalogueErrors(plan: Pick<Plan, 'exercise'>, base: Inventory = bundledInventory): string[] {
  const errors: string[] = [];
  const at = 'fitnessConfigUpdate.exercise';
  const groups = new Set(base.muscleGroups.map((m) => m.id));
  const bundled = new Map(base.exercises.map((e) => [e.movement, e]));
  const bundledNames = new Map(base.exercises.map((e) => [e.name.toLowerCase(), e.movement]));
  (plan.exercise?.customExercises ?? []).forEach((c, i) => {
    if (bundled.has(c.movement)) errors.push(`${at}.customExercises[${i}].movement: "${c.movement}" is already a built-in exercise; use it instead of adding a duplicate`);
    const same = bundledNames.get(c.name.toLowerCase());
    if (same && same !== c.movement) errors.push(`${at}.customExercises[${i}].name: "${c.name}" is already a built-in exercise ("${same}")`);
    [...c.primary, ...(c.secondary ?? [])].forEach((m) => !groups.has(m) && errors.push(`${at}.customExercises[${i}]: unknown muscle group "${m}" (use one of: ${[...groups].join(', ')})`));
  });
  const mg = plan.exercise?.muscleGrowth;
  if (mg) {
    mg.targets.forEach((m, i) => !groups.has(m) && errors.push(`${at}.muscleGrowth.targets[${i}]: unknown muscle group "${m}" (use one of: ${[...groups].join(', ')})`));
    const catalogue = new Map(inventoryFor(plan, base).exercises.map((e) => [e.movement, e]));
    const avoid = new Set((plan.exercise?.limitations ?? []).filter((l) => l.status === 'avoid').map((l) => l.movement));
    mg.exercises.forEach((e, i) => {
      const found = catalogue.get(e.movement);
      if (!found) return errors.push(`${at}.muscleGrowth.exercises[${i}].movement: "${e.movement}" is not in the exercise catalogue (add it to customExercises first)`);
      if (avoid.has(e.movement)) errors.push(`${at}.muscleGrowth.exercises[${i}].movement: "${e.movement}" is marked "avoid"`);
      if (!worksAny(found, mg.targets)) errors.push(`${at}.muscleGrowth.exercises[${i}].movement: "${e.movement}" doesn't work a target muscle (${mg.targets.join(', ')})`);
    });
  }
  return errors;
}

const worksAny = (e: InventoryExercise, targets: readonly string[]) => [...e.primary, ...e.secondary].some((m) => targets.includes(m));

/**
 * The exercises Muscle Growth can offer for these targets: eligible (the user's equipment, never "avoid") strength
 * exercises whose primary muscles include a target, then those that work one secondarily. Never the whole catalogue.
 */
export function muscleGrowthOptions(plan: Pick<Plan, 'exercise'>, targets: readonly string[], inventory: Inventory = inventoryFor(plan)) {
  const eligible = eligibleExercises(plan.exercise, inventory).filter((e) => e.exercise.kind === 'strength');
  const primary = eligible.filter((e) => e.exercise.primary.some((m) => targets.includes(m)));
  const secondary = eligible.filter((e) => !primary.includes(e) && e.exercise.secondary.some((m) => targets.includes(m)));
  return [...primary.map((e) => ({ ...e, match: 'primary' as const })), ...secondary.map((e) => ({ ...e, match: 'secondary' as const }))];
}

// ---- Today's Muscle Growth checklist ------------------------------------------------------------------------------

export const MUSCLE_GROWTH = 'muscle_growth' as const;
/** One record per date and movement: Complete and Skip replace each other, so a correction never duplicates a log. */
export const muscleGrowthLogId = (date: LocalDate, movement: string) => `mg-${date}-${movement}`;

export type MuscleGrowthRow = {
  movement: string;
  name: string;
  /** Planned dose (the routine's, else the catalogue default). */
  planned: { sets: number; reps?: number; seconds?: number; loadKg?: number };
  /** pending: not done yet; skipped is explicit and never counts as work. */
  status: 'pending' | 'done' | 'skipped';
  log: ExerciseLog | null;
  /** Still in today's routine (false: logged on this date, since removed from the routine). */
  inRoutine: boolean;
  caution: boolean;
  custom: boolean;
};

export type MuscleGrowthDay = {
  /** Enabled and offered on this date (days filter). Logged items still show on a date that isn't offered. */
  offered: boolean;
  targets: string[];
  rows: MuscleGrowthRow[];
  done: number;
  skipped: number;
  remaining: number;
};

/** The day's Muscle Growth checklist from the routine and that date's Muscle Growth logs. Pure. */
export function muscleGrowthDay(plan: Plan, date: LocalDate, logs: readonly ExerciseLog[], inventory: Inventory = inventoryFor(plan)): MuscleGrowthDay | null {
  const mg = plan.exercise?.muscleGrowth;
  const mine = logs.filter((l) => l.routine === MUSCLE_GROWTH && l.date === date);
  if (!mg && !mine.length) return null;
  const offered = !!mg?.enabled && (!mg.days || mg.days.includes(weekdayOf(date)));
  const byMovement = new Map(inventory.exercises.map((e) => [e.movement, e]));
  const caution = new Map(eligibleExercises(plan.exercise, inventory).map((e) => [e.exercise.movement, e.caution]));
  const targets = mg?.targets ?? [];
  const routine = offered
    ? mg!.exercises.filter((e) => {
        const inv = byMovement.get(e.movement);
        return inv && caution.has(e.movement) && worksAny(inv, targets);
      })
    : [];
  const row = (movement: string, planned: MuscleGrowthRow['planned'], inRoutine: boolean): MuscleGrowthRow => {
    const log = mine.find((l) => l.movement === movement) ?? null;
    return {
      movement,
      name: byMovement.get(movement)?.name ?? movement,
      planned,
      status: log ? (log.status === 'skipped' ? 'skipped' : 'done') : 'pending',
      log,
      inRoutine,
      caution: caution.get(movement) ?? false,
      custom: isCustomExercise(plan, movement),
    };
  };
  const rows = routine.map((e) => row(e.movement, plannedDose(e, byMovement.get(e.movement)), true));
  // History is what was logged: entries for exercises no longer in the routine still show on their date.
  for (const l of mine) if (!rows.some((r) => r.movement === l.movement)) rows.push(row(l.movement, { sets: l.sets || 1, ...(l.reps ? { reps: l.reps } : {}), ...(l.seconds ? { seconds: l.seconds } : {}) }, false));
  const done = rows.filter((r) => r.status === 'done').length;
  const skipped = rows.filter((r) => r.status === 'skipped').length;
  return { offered, targets, rows, done, skipped, remaining: rows.length - done - skipped };
}

function plannedDose(e: MuscleGrowthExercise, inv: InventoryExercise | undefined): MuscleGrowthRow['planned'] {
  const d = inv?.defaultDose;
  const sets = e.sets ?? d?.sets ?? 2;
  const amount = e.reps !== undefined ? { reps: e.reps } : e.seconds !== undefined ? { seconds: e.seconds } : d?.seconds !== undefined ? { seconds: d.seconds } : { reps: d?.reps ?? 10 };
  return { sets, ...amount, ...(e.loadKg !== undefined ? { loadKg: e.loadKg } : {}) };
}

/** Effort from reps in reserve, for muscle accounting (contract 09 effective sets): RIR 0–1 hard, 2–3 moderate, 4+ light. */
export const intensityFromRir = (rir: number | null | undefined): ExerciseIntensity | null =>
  rir === null || rir === undefined ? null : rir <= 1 ? 'hard' : rir <= 3 ? 'moderate' : 'light';

/** The record Complete writes (or a details edit replaces). Skipped records hold no work: 0 sets. */
export function muscleGrowthLog(row: Pick<MuscleGrowthRow, 'movement' | 'planned'>, date: LocalDate, at: string, status: 'done' | 'skipped', details?: { sets: number; reps?: number; seconds?: number; loadKg?: number; rir?: number }): ExerciseLog {
  const d = details ?? row.planned;
  const done = status === 'done';
  return {
    id: muscleGrowthLogId(date, row.movement),
    movement: row.movement,
    date,
    at,
    sets: done ? d.sets : 0,
    reps: done ? d.reps ?? null : null,
    seconds: done ? d.seconds ?? null : null,
    intensity: done ? intensityFromRir(details?.rir) : null,
    routine: MUSCLE_GROWTH,
    status,
    loadKg: done ? d.loadKg ?? null : null,
    rir: done ? details?.rir ?? null : null,
  };
}

/** Logs that are performed work (never a skipped item). */
export const performed = (l: ExerciseLog) => l.status !== 'skipped';

/**
 * A gradual progression suggestion, never an automatic change (#122): when the last two completed sessions of a
 * movement both reached the planned sets and reps with at least 2 reps in reserve, suggest a small step up.
 */
export function progressionHint(movement: string, planned: MuscleGrowthRow['planned'], history: readonly ExerciseLog[], before: LocalDate): string | null {
  if (planned.reps === undefined) return null;
  const recent = history
    .filter((l) => l.movement === movement && performed(l) && l.date < before && l.reps !== null)
    .sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at))
    .slice(0, 2);
  if (recent.length < 2) return null;
  const easy = recent.every((l) => l.sets >= planned.sets && (l.reps ?? 0) >= planned.reps! && (l.rir ?? -1) >= 2);
  if (!easy) return null;
  const load = recent[0].loadKg;
  return load ? `Last two sessions felt easy at ${load} kg. When it feels right, try a small step up.` : 'Last two sessions felt easy. When it feels right, try a little more load or one more rep.';
}
