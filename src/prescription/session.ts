import type { ExerciseSection, Session, SessionExercise } from '../plan/schema';

export type PrescribedExercise = SessionExercise & {
  label: string;
  /** Label of the movement this replaced because it is marked "avoid" (contract 07 limitations). */
  substitutedFor?: string;
  /** Marked "caution" in the exercise configuration. */
  caution?: boolean;
  /** Marked "avoid" and no allowed substitute is configured. */
  avoid?: boolean;
};

export type PrescribedSession = {
  minutes?: number;
  exercises: PrescribedExercise[];
  short?: { minutes?: number; exercises: PrescribedExercise[] };
};

export const movementLabel = (movement: string) => {
  const s = movement.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Apply the user's limitations/substitutions to one exercise. Pure, deterministic. */
export function prescribeExercise(ex: SessionExercise, config?: ExerciseSection): PrescribedExercise {
  const label = ex.label ?? movementLabel(ex.movement);
  const lim = config?.limitations?.find((l) => l.movement === ex.movement);
  if (lim?.status === 'avoid') {
    const avoided = (m: string) => config?.limitations?.some((l) => l.movement === m && l.status === 'avoid');
    const sub = config?.substitutions?.find((s) => s.instead === ex.movement)?.use.find((m) => !avoided(m));
    if (sub) return { ...ex, movement: sub, label: movementLabel(sub), substitutedFor: label };
    return { ...ex, label, avoid: true };
  }
  return { ...ex, label, ...(lim?.status === 'caution' ? { caution: true } : {}) };
}

export function prescribeSession(session: Session | undefined, config?: ExerciseSection): PrescribedSession | undefined {
  if (!session) return undefined;
  return {
    minutes: session.minutes,
    exercises: session.exercises.map((e) => prescribeExercise(e, config)),
    short: session.short && { minutes: session.short.minutes, exercises: session.short.exercises.map((e) => prescribeExercise(e, config)) },
  };
}

/** "3 × 10 · 16 kg", "45 s", "2 × 30 s". */
export function exerciseDose(e: SessionExercise): string {
  const amount = e.reps ? `${e.reps}` : e.seconds ? `${e.seconds} s` : '';
  const sets = e.sets && amount ? `${e.sets} × ${amount}` : e.sets ? `${e.sets} sets` : amount;
  return [sets, e.loadKg ? `${e.loadKg} kg` : null].filter(Boolean).join(' · ');
}
