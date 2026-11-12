import { COVERAGE, effectiveSets, hasEnoughHistory, windowStart } from './coverage';
import type { ExerciseState } from './state';
import type { Inventory, InventoryExercise } from './inventory';
import type { MuscleGrowthDay } from './catalogue';
import type { TodayWorkout, WorkoutRow } from './todayWorkout';
import type { LocalDate } from '../plan/dates';
import type { Plan } from '../plan/schema';
import type { ActivityLog } from '../storage/types';
import { sessionProgress } from '../prescription/exercises';

export type ResistanceRecommendation =
  | { kind: 'empty'; reason: string }
  | { kind: 'ready'; muscle: string; label: string; reason: string; score: number; volume: number; trainingDays: number; planned: number; rows: WorkoutRow[] };

const weight = (exercise: InventoryExercise, muscle: string) => exercise.primary.includes(muscle) ? COVERAGE.contribution.primary : exercise.secondary.includes(muscle) ? COVERAGE.contribution.secondary : 0;
const round = (value: number) => Math.round(value * 100) / 100;

/** Advisory projection only. Completed work stays in coverage; pending prescribed work is never recorded as done. */
export function recommendedResistance(input: {
  plan: Plan; date: LocalDate; state: ExerciseState | null; workout: TodayWorkout; growth: MuscleGrowthDay | null; inventory: Inventory; logs: Record<string, ActivityLog | undefined>;
}): ResistanceRecommendation {
  const { plan, date, state, workout, growth, inventory } = input;
  if (!state) return { kind: 'empty', reason: 'Exercise history is unavailable. Your usual workout and logging are still available.' };
  if (state.restDay) return { kind: 'empty', reason: 'Rest day. No extra training suggested; your exercise log is still available.' };
  const byMovement = new Map(inventory.exercises.map(ex => [ex.movement, ex]));
  const entries = [...new Map(state.entries.filter(e => byMovement.has(e.movement) && effectiveSets(e, byMovement.get(e.movement)!.kind) > 0).map(e => [e.id, e])).values()];
  if (!hasEnoughHistory(entries, inventory, date) || new Set(entries.map(e => e.date)).size < 2) return { kind: 'empty', reason: 'More recorded training history is needed to compare muscle groups. Keep logging your usual workouts.' };
  const from = windowStart(date, plan.exercise?.restDays);
  const blocked = new Set(state.coverage.filter(c => c.status === 'recovering' || c.report || c.status === 'unavailable').map(c => c.muscle));
  // Exclude every scheduled movement, including a skipped session, and every offered routine movement.
  // A recommendation cannot turn a skipped prescription into an extra free log.
  const scheduled = new Set(workout.sessions.flatMap(item => item.session ? sessionProgress(item.session, input.logs[item.key]).rows.map(row => row.exercise.movement) : []));
  const reserved = new Set([...scheduled, ...(growth?.rows ?? []).filter(row => row.inRoutine).map(row => row.movement)]);
  const done = new Set(entries.filter(e => e.date === date).map(e => e.movement));
  const pending = [
    ...workout.rows.filter(row => row.plan && !row.done && !row.equipmentUnavailable && !row.prescribed?.avoid).map(row => ({ movement: row.movement, ...row.dose })),
    ...(growth?.rows ?? []).filter(row => row.inRoutine && row.status === 'pending' && !done.has(row.movement)).map(row => ({ movement: row.movement, ...row.planned })),
  ];
  const choices = state.suggestions.filter(s => !s.doneToday && !done.has(s.exercise.movement) && !reserved.has(s.exercise.movement) && ![...s.exercise.primary, ...s.exercise.secondary].some(m => blocked.has(m)));
  const candidates = state.coverage.flatMap((coverage, order) => {
    if (blocked.has(coverage.muscle) || coverage.volume >= coverage.target) return [];
    const projected = pending.reduce((sum, dose) => {
      const exercise = byMovement.get(dose.movement);
      if (!exercise) return sum;
      return sum + weight(exercise, coverage.muscle) * effectiveSets({ ...dose, id: '', date, at: '', source: 'session' }, exercise.kind);
    }, 0);
    const remaining = Math.max(0, coverage.target - coverage.volume - projected);
    if (!remaining) return [];
    const daily = new Map<string, number>();
    for (const entry of entries.filter(e => e.date >= from)) {
      const load = weight(byMovement.get(entry.movement)!, coverage.muscle) * effectiveSets(entry, byMovement.get(entry.movement)!.kind);
      daily.set(entry.date, (daily.get(entry.date) ?? 0) + load);
    }
    const trainingDays = [...daily.values()].filter(load => load >= COVERAGE.trivialLoad).length;
    const matches = choices.filter(s => weight(s.exercise, coverage.muscle) > 0).sort((a, b) =>
      Number(b.exercise.primary.includes(coverage.muscle)) - Number(a.exercise.primary.includes(coverage.muscle)) || Number(a.caution) - Number(b.caution) || b.score - a.score);
    const rows = matches.flatMap(s => {
      const row = workout.rows.find(r => r.movement === s.exercise.movement && !r.plan && !r.done && !r.equipmentUnavailable);
      return row ? [row] : [];
    });
    if (!rows.length) return [];
    return [{ coverage, projected: round(projected), trainingDays, rows, order, score: remaining / coverage.target * 0.7 + 0.3 / (trainingDays + 1) }];
  }).sort((a, b) => b.score - a.score || (a.coverage.lastTrainedAt ?? '').localeCompare(b.coverage.lastTrainedAt ?? '') || a.order - b.order);
  const first = candidates[0];
  if (!first) return { kind: 'empty', reason: 'No extra exercise suggested: recent work, recovery, planned training and available equipment are accounted for.' };
  const { coverage, trainingDays, projected, rows, score } = first;
  return { kind: 'ready', muscle: coverage.muscle, label: coverage.label, volume: coverage.volume, trainingDays, planned: projected, rows, score,
    reason: `${coverage.volume} recorded effective sets across ${trainingDays} training day${trainingDays === 1 ? '' : 's'} in the last ${COVERAGE.windowTrainingDays} training days. No active recovery hold; ${projected} effective sets still planned today.` };
}
