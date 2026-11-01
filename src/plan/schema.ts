/**
 * Runtime mirror of docs/design-contracts/plan.schema.json (formatVersion 1).
 * The JSON Schema is the contract; tests assert both accept/reject the same plans.
 */
import { z } from 'zod';

const id = z.string().max(40).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const label = z.string().min(1).max(40);
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

export const planSchema = z.strictObject({
  $schema: z.string().optional(),
  format: z.literal('pft-plan'),
  formatVersion: z.literal(1),
  id,
  revision: z.number().int().min(1),
  title: label,
  description: z.string().max(280).optional(),
  units: z.strictObject({
    mass: z.enum(['kg', 'lb']),
    energy: z.enum(['kJ', 'kcal']),
    length: z.enum(['cm', 'in']),
  }),
  dayTypes: z.array(z.strictObject({ id, label })).min(1).max(7),
  schedule: z.strictObject(
    Object.fromEntries(weekdays.map((d) => [d, id])) as Record<(typeof weekdays)[number], typeof id>,
  ),
  measurements: z.array(measurement).max(8).default([]),
  goals: z
    .array(
      z.strictObject({
        id,
        label,
        measurementId: id,
        target: z.number(),
        direction: z.enum(['decrease', 'increase', 'maintain']),
      }),
    )
    .max(4)
    .default([]),
  nutrition: z
    .strictObject({
      targets: z.array(nutritionTarget).max(4).default([]),
      eatingWindow: z.strictObject({ start: time, end: time }).optional(),
    })
    .default({ targets: [] }),
  activities: z.array(activity).min(1).max(60),
  quickLogs: z
    .array(z.strictObject({ id, label, detail: z.string().max(120).optional() }))
    .max(2)
    .default([]),
});

export type Plan = z.output<typeof planSchema>;
export type Activity = Plan['activities'][number];
export type Measurement = Plan['measurements'][number];
export type NutritionTarget = Plan['nutrition']['targets'][number];
export type Weekday = (typeof weekdays)[number];
