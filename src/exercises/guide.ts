import { equipmentCapabilities } from '../equipment/catalogue';
import { movementSupported } from './availability';
import { exerciseInventory } from './inventory';
import { inventoryFor } from './catalogue';
import { describeItem } from '../config/diff';
import type { CustomExercise, ExerciseSection } from '../plan/schema';
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
  equipmentUnavailable?: boolean;
  muscles?: { primary: { id: string; label: string }[]; secondary: { id: string; label: string }[] };
};

const humanEquipment = (type: string) => type.replace(/_/g, ' ');

/** Build the guide for one prescribed exercise. Pure. */
export function buildGuide(exercise: PrescribedExercise, config?: ExerciseSection, library: ExerciseLibrary = exerciseLibrary): ExerciseGuide {
  // A custom catalogue exercise (#122) has the user's own name, equipment and cues, and no illustrations.
  const custom: CustomExercise | undefined = config?.customExercises?.find((c) => c.movement === exercise.movement);
  const def = findDefinition(exercise.movement, library) ?? (custom ? { id: custom.movement, name: custom.name, equipment: custom.equipment, instructions: custom.guidance ?? [], steps: [] } : undefined);
  const requirement = custom ?? exerciseInventory.exercises.find(entry => entry.movement === exercise.movement) ?? def;
  const alternatives = requirement ? ('requirements' in requirement && requirement.requirements ? requirement.requirements : requirement.equipment.map(capability => [capability])) : [];
  const relevant = (config?.equipment ?? []).filter(item => {
    const capabilities = equipmentCapabilities({ equipment: [item] });
    return alternatives.some(all => all.some(capability => capabilities.has(capability)));
  });
  // Keep a legacy machine label as context when no station is confirmed; it never grants exercise access.
  const configured = relevant.length ? relevant : def?.equipment.includes('home_gym') ? (config?.equipment ?? []).filter(item => item.available !== false && item.type === 'home_gym' && (!item.catalogueId || item.catalogueId === 'multi_gym_frame')) : [];
  const equipment = configured.length
    ? configured.map((item) => describeItem('exercise.equipment', item))
    : def?.equipment.length
      ? [def.equipment.map(humanEquipment).join(' or ').replace(/^./, (c) => c.toUpperCase())]
      : [];
  const limitation = config?.limitations?.find((l) => l.movement === exercise.movement && l.status === 'caution');
  const name = def?.name ?? exercise.label ?? movementLabel(exercise.movement);
  const dose = exerciseDose(exercise);
  const inventory = inventoryFor({ exercise: config });
  const mapping = inventory.exercises.find(entry => entry.movement === exercise.movement);
  const muscleNames = (ids: string[]) => ids.map(id => ({ id, label: inventory.muscleGroups.find(group => group.id === id)!.label }));
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
    ...(mapping ? { muscles: { primary: muscleNames(mapping.primary), secondary: muscleNames(mapping.secondary) } } : {}),
    ...(config && requirement && !movementSupported(exercise.movement, config) ? { equipmentUnavailable: true } : {}),
  };
}
