import { describeItem } from '../config/diff';
import type { ExerciseSection } from '../plan/schema';
import { exerciseDose, movementLabel, type PrescribedExercise } from '../prescription/session';
import { exerciseLibrary, findDefinition } from './library';
import type { ExerciseLibrary } from './schema';

export type GuideStep = { image: string; caption: string };

/** Everything the guide modal shows: the reusable definition joined with today's prescription. */
export type ExerciseGuide = {
  movement: string;
  name: string;
  /** False when no definition exists yet: the guide degrades to the workout's own label. */
  hasDefinition: boolean;
  /** Today's sets/reps/load, from the workout (never stored in the definition). */
  prescription: string | null;
  /** The workout label, when it adds detail (e.g. "Chest press (Fortis)"). */
  workoutLabel: string | null;
  substitutedFor: string | null;
  caution: string | null;
  equipment: string[];
  instructions: string[];
  steps: GuideStep[];
};

const humanEquipment = (type: string) => type.replace(/_/g, ' ');

/** Build the guide for one prescribed exercise. Pure. */
export function buildGuide(exercise: PrescribedExercise, config?: ExerciseSection, library: ExerciseLibrary = exerciseLibrary): ExerciseGuide {
  const def = findDefinition(exercise.movement, library);
  const configured = def ? (config?.equipment ?? []).filter((item) => def.equipment.includes(item.type)) : [];
  const equipment = configured.length
    ? configured.map((item) => describeItem('exercise.equipment', item))
    : def?.equipment.length
      ? [def.equipment.map(humanEquipment).join(' or ').replace(/^./, (c) => c.toUpperCase())]
      : [];
  const limitation = config?.limitations?.find((l) => l.movement === exercise.movement && l.status === 'caution');
  const name = def?.name ?? exercise.label ?? movementLabel(exercise.movement);
  const dose = exerciseDose(exercise);
  return {
    movement: exercise.movement,
    name,
    hasDefinition: !!def,
    prescription: dose || null,
    workoutLabel: exercise.label && exercise.label !== name ? exercise.label : null,
    substitutedFor: exercise.substitutedFor ?? null,
    caution: limitation ? `Caution${limitation.reason ? `: ${limitation.reason}` : ''}` : exercise.caution ? 'Caution' : null,
    equipment,
    instructions: def?.instructions ?? [],
    steps: def?.steps ?? [],
  };
}
