/**
 * Runtime mirror of docs/design-contracts/plan.schema.json (formatVersion 1 and 2).
 * formatVersion 2 adds the optional `profile` and `exercise` sections (contract 07).
 * The JSON Schema is the contract; tests assert both accept/reject the same plans.
 */
import { z } from 'zod';

export const id = z.string().max(40).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
export const label = z.string().min(1).max(40);
const time = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
export const weekdays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const weekday = z.enum(weekdays);
const minutes = z.number().int().min(1).max(600);

const appliesTo = z.union([
  z.strictObject({ dayTypes: z.array(id).min(1) }),
  z.strictObject({ days: z.array(weekday).min(1) }),
]);

const tracking = z.union([
  z.strictObject({ type: z.literal('check') }),
  z.strictObject({
    type: z.literal('count'),
    target: z.number().int().min(2).max(12),
    unitLabel: z.string().max(16),
  }),
]);

const activity = z.strictObject({
  id,
  kind: z.enum(['exercise', 'meal', 'habit']),
  label,
  detail: z.string().max(120).optional(),
  time: time.optional(),
  duration: z
    .union([z.strictObject({ minutes }), z.strictObject({ min: minutes, max: minutes })])
    .optional(),
  required: z.boolean().default(true),
  appliesTo: appliesTo.optional(),
  tracking: tracking.default({ type: 'check' }),
  nutrition: z.record(id, z.number().min(0)).optional(),
  flexible: z.boolean().default(false),
});

const measurement = z.strictObject({
  id,
  label,
  quantity: z.enum(['mass', 'length', 'number']),
  unitLabel: z.string().max(12).optional(),
  decimals: z.number().int().min(0).max(2).default(1),
  cadence: z.union([
    z.strictObject({ every: z.literal('day') }),
    z.strictObject({ every: z.literal('week'), on: weekday }),
  ]),
});

const nutritionTarget = z
  .strictObject({
    id,
    label,
    quantity: z.enum(['energy', 'grams']),
    min: z.number().min(0).optional(),
    max: z.number().min(0).optional(),
    appliesTo: appliesTo.optional(),
  })
  .refine((t) => t.min !== undefined || t.max !== undefined, { message: 'needs min or max' });

// ---- formatVersion 2 sections ------------------------------------------------------------

/** Movement / exercise identifiers are snake_case, e.g. "biceps_curl", "hammer_curl", "kettlebell_swing". */
export const movementId = z.string().max(40).regex(/^[a-z0-9]+(_[a-z0-9]+)*$/, 'use snake_case, e.g. "hammer_curl"');
const note = z.string().min(1).max(200);
const minutesRange = z.union([z.strictObject({ minutes }), z.strictObject({ min: minutes, max: minutes })]);

export const equipmentTypes = [
  'kettlebell', 'dumbbells', 'free_weights', 'barbell', 'weight_plates', 'home_gym', 'cable_machine', 'bench',
  'pull_up_bar', 'resistance_bands', 'heavy_bag', 'boxing_gloves', 'battle_ropes', 'jump_rope', 'exercise_bike',
  'treadmill', 'rower', 'bicycle', 'vr_headset', 'yoga_mat', 'other',
] as const;
export const limitationStatuses = ['avoid', 'caution', 'allowed'] as const;
export const activityKinds = ['strength', 'conditioning', 'cardio', 'mobility', 'sport', 'active_commute', 'other'] as const;
export const intensities = ['low', 'moderate', 'high'] as const;
export const exerciseGoals = [
  'weight_loss', 'muscle_preservation', 'muscle_gain', 'strength', 'fitness', 'endurance', 'mobility', 'health', 'other',
] as const;
export const strengthSplits = ['full_body', 'upper_lower', 'push_pull', 'push_pull_legs', 'circuit', 'other'] as const;
export const trainingLocations = ['home', 'gym', 'outdoors', 'mixed'] as const;

export const equipmentItem = z.strictObject({
  type: z.enum(equipmentTypes),
  label: label.optional(),
  brand: z.string().min(1).max(40).optional(),
  /** Loads available, in kg (e.g. kettlebells [16, 24]). */
  weightsKg: z.array(z.number().positive().max(500)).max(20).optional(),
  notes: note.optional(),
});

export const limitation = z.strictObject({
  movement: movementId,
  status: z.enum(limitationStatuses),
  reason: note.optional(),
});

export const substitution = z.strictObject({
  /** Movement to replace (usually one that's avoided). */
  instead: movementId,
  /** Preferred replacements, best first. */
  use: z.array(movementId).min(1).max(5),
  reason: note.optional(),
});

export const activityType = z.strictObject({
  id: movementId,
  label,
  kind: z.enum(activityKinds),
  intensity: z.enum(intensities).optional(),
  /** Equipment types this needs. */
  equipment: z.array(z.enum(equipmentTypes)).max(6).optional(),
  notes: note.optional(),
});

const trainingBlock = z.strictObject({
  sessionsPerWeek: z.number().int().min(0).max(14).optional(),
  sessionMinutes: minutesRange.optional(),
  intensity: z.enum(intensities).optional(),
  /** activityType ids used for this block, e.g. ["vr_boxing", "heavy_bag"]. */
  modalities: z.array(movementId).max(10).optional(),
  notes: note.optional(),
});

export const exerciseSection = z.strictObject({
  goals: z.array(z.enum(exerciseGoals)).max(9).optional(),
  equipment: z.array(equipmentItem).max(30).optional(),
  limitations: z.array(limitation).max(30).optional(),
  substitutions: z.array(substitution).max(30).optional(),
  activityTypes: z.array(activityType).max(30).optional(),
  strength: trainingBlock.extend({ split: z.enum(strengthSplits).optional(), focus: z.array(note).max(10).optional() }).optional(),
  conditioning: trainingBlock.optional(),
  constraints: z
    .strictObject({
      location: z.enum(trainingLocations).optional(),
      gymMembership: z.boolean().optional(),
      maxSessionMinutes: minutes.optional(),
      /** Work/family/kids and other real-life constraints, in the user's words. */
      notes: z.array(note).max(10).optional(),
    })
    .optional(),
});

export const profileSection = z.strictObject({
  displayName: z.string().min(1).max(40).optional(),
  heightCm: z.number().min(50).max(260).optional(),
  notes: z.array(note).max(10).optional(),
});

export const unitsSchema = z.strictObject({
  mass: z.enum(['kg', 'lb']),
  energy: z.enum(['kJ', 'kcal']),
  length: z.enum(['cm', 'in']),
});
export const dayTypeSchema = z.strictObject({ id, label });
export const goalSchema = z.strictObject({
  id,
  label,
  measurementId: id,
  target: z.number(),
  direction: z.enum(['decrease', 'increase', 'maintain']),
});
export const quickLogSchema = z.strictObject({ id, label, detail: z.string().max(120).optional() });
export const eatingWindowSchema = z.strictObject({ start: time, end: time });
export const weekScheduleSchema = z.strictObject(
  Object.fromEntries(weekdays.map((d) => [d, id])) as Record<(typeof weekdays)[number], typeof id>,
);

export const planSchema = z.strictObject({
  $schema: z.string().optional(),
  format: z.literal('pft-plan'),
  formatVersion: z.union([z.literal(1), z.literal(2)]),
  id,
  revision: z.number().int().min(1),
  title: label,
  description: z.string().max(280).optional(),
  units: unitsSchema,
  dayTypes: z.array(dayTypeSchema).min(1).max(7),
  schedule: weekScheduleSchema,
  measurements: z.array(measurement).max(8).default([]),
  goals: z.array(goalSchema).max(4).default([]),
  nutrition: z
    .strictObject({
      targets: z.array(nutritionTarget).max(4).default([]),
      eatingWindow: eatingWindowSchema.optional(),
    })
    .default({ targets: [] }),
  activities: z.array(activity).min(1).max(60),
  quickLogs: z.array(quickLogSchema).max(2).default([]),
  profile: profileSection.optional(),
  exercise: exerciseSection.optional(),
}).superRefine((p, ctx) => {
  if (p.formatVersion === 1) {
    for (const key of ['profile', 'exercise'] as const) {
      if (p[key] !== undefined) ctx.addIssue({ code: 'custom', path: [key], message: `"${key}" needs formatVersion 2` });
    }
  }
});

export type Plan = z.output<typeof planSchema>;
export type Activity = Plan['activities'][number];
export type Measurement = Plan['measurements'][number];
export type NutritionTarget = Plan['nutrition']['targets'][number];
export type Weekday = (typeof weekdays)[number];
export type ExerciseSection = z.infer<typeof exerciseSection>;
export type ProfileSection = z.infer<typeof profileSection>;
/** Building blocks reused by the configuration sections (src/config). */
export const planParts = { activity, measurement, nutritionTarget, appliesTo, time };
