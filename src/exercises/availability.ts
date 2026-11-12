import type { ExerciseSection, Plan } from '../plan/schema';
import { supportsEquipment } from '../equipment/catalogue';
import { exerciseInventory, type Inventory } from './inventory';
import { findDefinition } from './library';

/** Shared availability for preset builders, scheduled review and guide entry points. */
export function movementSupported(movement: string, config?: ExerciseSection, inventory: Inventory = exerciseInventory): boolean {
  const custom = config?.customExercises?.find(entry => entry.movement === movement);
  const entry = custom ?? inventory.exercises.find(entry => entry.movement === movement) ?? findDefinition(movement);
  return !!entry && supportsEquipment(entry, config);
}

/** Informational review only. Equipment edits never rewrite activities, doses or stored logs. */
export function incompatibleScheduled(plan: Pick<Plan, 'activities' | 'exercise'>) {
  const activities = (plan.activities ?? []).flatMap(activity => {
    const movements = [...new Set([
      ...(activity.movement ? [activity.movement] : []),
      ...(activity.session?.exercises ?? []).map(exercise => exercise.movement),
      ...(activity.session?.short?.exercises ?? []).map(exercise => exercise.movement),
    ])].filter(movement => !movementSupported(movement, plan.exercise));
    return movements.length ? [{ activityId: activity.id, label: activity.label, movements }] : [];
  });
  const growth = plan.exercise?.muscleGrowth;
  const movements = growth?.enabled ? growth.exercises.filter(entry => !movementSupported(entry.movement, plan.exercise)).map(entry => entry.movement) : [];
  return [...activities, ...(movements.length ? [{ activityId: 'muscle_growth', label: 'Muscle Growth routine', movements }] : [])];
}
