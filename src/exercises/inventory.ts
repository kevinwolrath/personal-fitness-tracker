import { z } from 'zod';
import { supportsEquipment } from '../equipment/catalogue';
import { equipmentTypes, movementId, type ExerciseSection } from '../plan/schema';
import data from './inventory.json';

/**
 * The exercise inventory and its muscle mappings (#56). Data, not code: which muscles an exercise works is
 * content in `inventory.json`; nothing here or in `coverage.ts` names an exercise or a muscle.
 */

const muscleId = z.string().regex(/^[a-z]+(_[a-z]+)*$/);

export const inventorySchema = z.strictObject({
  $comment: z.string().optional(),
  inventoryVersion: z.literal(1),
  muscleGroups: z.array(z.strictObject({ id: muscleId, label: z.string().min(1).max(30) })).min(1),
  exercises: z.array(
    z.strictObject({
      /** The movement id plans use (`session.exercises[].movement`) and the exercise library's id (contract 09). */
      movement: movementId,
      /** Previously custom/preset movements promoted in #158 retain their saved custom metadata. */
      allowCustomOverride: z.boolean().optional(),
      name: z.string().min(1).max(40),
      /** strength: sets and reps; conditioning: rounds or time (e.g. boxing). Conditioning stays separate from strength sessions. */
      kind: z.enum(['strength', 'conditioning']),
      /** Any one of these equipment types is enough; empty = no equipment. */
      equipment: z.array(z.enum(equipmentTypes)).max(6),
      requirements: z.array(z.array(z.string().min(1)).min(1)).min(1).optional(),
      /**
       * The one-tap dose on Today's workout and the log form's starting draft (#56): sets and exactly one of reps or
       * seconds. A plan's own dose for the movement always wins. Not a recommendation and not completed work.
       */
      defaultDose: z
        .strictObject({ sets: z.number().int().positive(), reps: z.number().int().positive().optional(), seconds: z.number().positive().optional() })
        .refine((d) => (d.reps === undefined) !== (d.seconds === undefined), 'give reps or seconds, not both')
        .optional(),
      primary: z.array(muscleId).min(1),
      secondary: z.array(muscleId),
    }),
  ),
});

export type Inventory = z.infer<typeof inventorySchema>;
export type InventoryExercise = Inventory['exercises'][number];
export type MuscleId = string;

/** Schema plus cross-checks: every muscle is in the vocabulary, no duplicates, primary and secondary don't overlap. Pure. */
export function validateInventory(input: unknown): { ok: true; inventory: Inventory } | { ok: false; errors: string[] } {
  const r = inventorySchema.safeParse(input);
  if (!r.success) return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  const errors: string[] = [];
  const muscles = new Set<string>();
  for (const m of r.data.muscleGroups) {
    if (muscles.has(m.id)) errors.push(`muscle group "${m.id}" is defined twice`);
    muscles.add(m.id);
  }
  const seen = new Set<string>();
  for (const e of r.data.exercises) {
    if (seen.has(e.movement)) errors.push(`exercise "${e.movement}" is defined twice`);
    seen.add(e.movement);
    for (const m of [...e.primary, ...e.secondary]) if (!muscles.has(m)) errors.push(`exercise "${e.movement}": unknown muscle group "${m}"`);
    for (const m of e.primary) if (e.secondary.includes(m)) errors.push(`exercise "${e.movement}": "${m}" is both primary and secondary`);
    if (new Set(e.primary).size !== e.primary.length || new Set(e.secondary).size !== e.secondary.length) errors.push(`exercise "${e.movement}": a muscle is listed twice`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, inventory: r.data };
}

const checked = validateInventory(data);
if (!checked.ok) throw new Error(`Bundled exercise inventory is invalid:\n${checked.errors.join('\n')}`);

/** The bundled inventory. Plans see it with their custom exercises through `inventoryFor` (catalogue.ts, #122). */
export const exerciseInventory: Inventory = checked.inventory;
/** Alias kept for the catalogue (#122): the same bundled inventory. */
export const bundledInventory: Inventory = exerciseInventory;

export const findInventoryExercise = (movement: string, inventory: Inventory = exerciseInventory) => inventory.exercises.find((e) => e.movement === movement);

export type Eligibility = { exercise: InventoryExercise; caution: boolean };

/**
 * The exercises this user can do (#56): the user's own configured equipment (never an assumed set), and never a
 * movement their limitations say to avoid. `caution` limitations stay in, flagged. With no equipment configured,
 * only the no-equipment exercises are eligible. Pure.
 */
export function eligibleExercises(config: ExerciseSection | undefined, inventory: Inventory = exerciseInventory): Eligibility[] {
  const status = new Map((config?.limitations ?? []).map((l) => [l.movement, l.status]));
  return inventory.exercises
    .filter((e) => supportsEquipment(e, config))
    .filter((e) => status.get(e.movement) !== 'avoid')
    .map((exercise) => ({ exercise, caution: status.get(exercise.movement) === 'caution' }));
}
