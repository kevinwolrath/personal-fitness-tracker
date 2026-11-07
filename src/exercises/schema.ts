import { z } from 'zod';
import { equipmentTypes, movementId } from '../plan/schema';

/**
 * Reusable exercise definition (contract 09): owns the name, equipment, instructions and illustrated steps.
 * Never holds sets/reps/load; those belong to the workout that prescribes it.
 */
export const exerciseDefinitionSchema = z.strictObject({
  /** The movement id plans use in `session.exercises[].movement`. */
  id: movementId,
  name: z.string().min(1).max(40),
  /** Acceptable equipment types (any one). */
  equipment: z.array(z.enum(equipmentTypes)).max(6),
  instructions: z.array(z.string().min(1).max(200)).min(1).max(8),
  /** Ordered illustrated steps; may be empty (the guide then shows instructions only). */
  steps: z
    .array(
      z.strictObject({
        /** Stable asset id, resolved by the bundled exercise illustration registry. */
        image: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
        caption: z.string().min(1).max(160),
      }),
    )
    .max(8),
});

export const exerciseLibrarySchema = z.strictObject({
  libraryVersion: z.literal(1),
  exercises: z.array(exerciseDefinitionSchema),
});

export type ExerciseDefinition = z.infer<typeof exerciseDefinitionSchema>;
export type ExerciseLibrary = z.infer<typeof exerciseLibrarySchema>;
