/**
 * Runtime mirror of docs/design-contracts/plan.schema.json (formatVersion 1, 2 and 3).
 * formatVersion 3 adds meal `ingredients` and `preparation` (contract 03, #26).
 * formatVersion 4 adds activity `notifications`: plan-defined local reminders (contract 10, #30).
 * formatVersion 6 adds the setup profile (#49): `profile` gender, age band, weight, fitness goals and practical context.
 * formatVersion 5 adds due times: `leadMinutes` on activities and requirements, and plan-wide `timing` (contract 08, #51).
 * formatVersion 2 adds the optional `profile` and `exercise` sections (contract 07).
 * formatVersion 7 adds `exercise.restDays` and activity `movement` (#56): rest days for muscle coverage, and which
 * exercise-inventory movement an activity is (e.g. VR boxing), so its muscle work counts.
 * formatVersion 8 adds `exercise.customExercises` and `exercise.muscleGrowth` (#122): the user's own catalogue entries,
 * and a Muscle Growth routine for chosen target muscles, separate from the resistance session.
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

/** Movement / exercise identifiers are snake_case, e.g. "biceps_curl", "hammer_curl", "kettlebell_swing". */
export const movementId = z.string().max(40).regex(/^[a-z0-9]+(_[a-z0-9]+)*$/, 'use snake_case, e.g. "hammer_curl"');

// ---- Daily prescription (formatVersion 2, contract 08) --------------------------------------

/** What an activity is for. Requirements are satisfied by purpose-compatible activities, never by name. */
export const purposes = [
  'strength', 'conditioning_high_intensity', 'conditioning_low_intensity', 'walking', 'mobility',
  'nutrition', 'supplement', 'recovery', 'habit', 'other',
] as const;
/** Broad time windows for activities without an exact time. */
export const dayParts = ['morning', 'lunch', 'afternoon', 'evening', 'anytime'] as const;

const sessionExercise = z.strictObject({
  movement: movementId,
  label: z.string().min(1).max(40).optional(),
  sets: z.number().int().min(1).max(20).optional(),
  reps: z.number().int().min(1).max(100).optional(),
  seconds: z.number().int().min(1).max(3600).optional(),
  loadKg: z.number().positive().max(500).optional(),
  notes: z.string().min(1).max(120).optional(),
});
const sessionPlan = z.strictObject({
  minutes: z.number().int().min(1).max(600).optional(),
  exercises: z.array(sessionExercise).min(1).max(20),
});
/** Structured exercise session, with an optional short version ("I only have 10 minutes"). */
export const sessionSchema = sessionPlan.extend({ short: sessionPlan.optional() });

/**
 * How many minutes before its scheduled time a timed item becomes due (formatVersion 5, contract 08, #51).
 * Precedence: the item's own `leadMinutes` > the plan's `timing.leadMinutes[kind]` > the format default.
 */
export const leadMinutes = z.number().int().min(0).max(240);
export const timingSchema = z.strictObject({
  leadMinutes: z
    .strictObject({ meal: leadMinutes.optional(), exercise: leadMinutes.optional(), habit: leadMinutes.optional() })
    .optional(),
});

/** A daily need that any one of several activities can meet (e.g. high-intensity conditioning). */
export const requirementSchema = z.strictObject({
  id,
  label,
  purpose: z.enum(purposes),
  detail: z.string().max(120).optional(),
  required: z.boolean().default(true),
  when: z.enum(dayParts).optional(),
  time: time.optional(),
  // formatVersion 5 (#51):
  leadMinutes: leadMinutes.optional(),
});

/** One ingredient of a meal (formatVersion 3). `measure` is the plan's everyday wording, shown as written: the app never converts units. */
const ingredient = z.strictObject({
  name: z.string().min(1).max(60),
  grams: z.number().positive().max(5000).optional(),
  ml: z.number().positive().max(5000).optional(),
  /** e.g. "~¾ cup", "1 scoop", "as needed". */
  measure: z.string().min(1).max(40).optional(),
});

/**
 * One local reminder for an activity (formatVersion 4). Timing and wording are plan data: exactly one of
 * `offsetMinutes` (from the activity's start: its `time`, or the start of its day part) or `at` (HH:MM).
 */
const notification = z.strictObject({
  offsetMinutes: z.number().int().min(-720).max(720).optional(),
  at: time.optional(),
  title: z.string().min(1).max(40),
  body: z.string().min(1).max(120),
});

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
  // formatVersion 2 (contract 08):
  purpose: z.enum(purposes).optional(),
  /** Broad window when there is no exact `time`. */
  when: z.enum(dayParts).optional(),
  /** Do after these activities (ids); they don't need to be finished first, only resolved (done/skipped). */
  after: z.array(id).max(5).optional(),
  session: sessionSchema.optional(),
  /** Requirement id this activity can satisfy (one of several alternatives). */
  satisfies: id.optional(),
  // formatVersion 3 (#26), meals only:
  /** What goes into the meal, with target amounts. */
  ingredients: z.array(ingredient).min(1).max(20).optional(),
  /** How to make it, in the plan's words. */
  preparation: z.string().min(1).max(400).optional(),
  // formatVersion 4 (#30):
  /** Local reminders for this activity. Absent or empty: no reminder. */
  notifications: z.array(notification).max(3).optional(),
  // formatVersion 5 (#51):
  /** Minutes before `time` this becomes due. Absent: the plan's `timing`, then the format default for its kind. */
  leadMinutes: leadMinutes.optional(),
  // formatVersion 7 (#56):
  /** The exercise-inventory movement this activity is (e.g. "vr_boxing"), so completing it adds to muscle history. */
  movement: movementId.optional(),
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

/** An inventory muscle-group id (`src/exercises/inventory.json`), e.g. "biceps". Checked against the catalogue on apply. */
export const muscleGroupId = z.string().max(30).regex(/^[a-z]+(_[a-z]+)*$/, 'use a muscle-group id, e.g. "biceps"');

/**
 * formatVersion 8 (#122): an exercise the user adds to the shared catalogue. Same shape as a bundled inventory entry
 * (`src/exercises/inventory.ts`), so it is planned, logged and counted for muscles exactly like one. Its movement id
 * must not repeat a bundled one (no duplicates).
 */
export const customExercise = z.strictObject({
  movement: movementId,
  name: label,
  /** Muscle Growth and strength logging use sets and reps; conditioning stays time-based (contract 09). */
  kind: z.enum(['strength', 'conditioning']).default('strength'),
  /** Any one of these is enough; empty = no equipment. */
  equipment: z.array(z.enum(equipmentTypes)).max(6),
  primary: z.array(muscleGroupId).min(1).max(4),
  secondary: z.array(muscleGroupId).max(6).default([]),
  defaultDose: z
    .strictObject({ sets: z.number().int().min(1).max(10), reps: z.number().int().min(1).max(100).optional(), seconds: z.number().positive().max(600).optional() })
    .refine((d) => (d.reps === undefined) !== (d.seconds === undefined), 'give reps or seconds, not both')
    .optional(),
  /** Short cues shown in the exercise guide, in the user's words. */
  guidance: z.array(note).max(8).optional(),
});

/** One exercise in the Muscle Growth routine: a catalogue movement and its planned dose (never auto-increased). */
export const muscleGrowthExercise = z.strictObject({
  movement: movementId,
  sets: z.number().int().min(1).max(10).optional(),
  reps: z.number().int().min(1).max(100).optional(),
  seconds: z.number().positive().max(600).optional(),
  loadKg: z.number().positive().max(500).optional(),
});

/**
 * formatVersion 8 (#122): the Muscle Growth category. A short, optional routine for the user's chosen target muscles,
 * independent of the resistance session: it never changes the schedule, rest days or other workouts.
 */
export const muscleGrowthSection = z.strictObject({
  enabled: z.boolean(),
  /** The user's target muscle groups, e.g. ["biceps", "traps"]. */
  targets: z.array(muscleGroupId).min(1).max(6),
  /** The routine, in order. Only exercises that work a target are shown on Today. */
  exercises: z.array(muscleGrowthExercise).max(12).default([]),
  /** Days it is offered. Absent: every day. */
  days: z.array(z.enum(weekdays)).min(1).max(7).optional(),
  /** When it suits, e.g. "lunch" for a coffee-break session. Display only. */
  when: z.enum(dayParts).optional(),
});

export const exerciseSection = z.strictObject({
  goals: z.array(z.enum(exerciseGoals)).max(9).optional(),
  equipment: z.array(equipmentItem).max(30).optional(),
  limitations: z.array(limitation).max(30).optional(),
  substitutions: z.array(substitution).max(30).optional(),
  activityTypes: z.array(activityType).max(30).optional(),
  strength: trainingBlock.extend({ split: z.enum(strengthSplits).optional(), focus: z.array(note).max(10).optional() }).optional(),
  conditioning: trainingBlock.optional(),
  /**
   * formatVersion 7 (#56): configured rest days. They never make a muscle overdue (the coverage window skips them)
   * and never stop voluntary exercise. Absent = none: rest days are never inferred from the schedule.
   */
  restDays: z.array(z.enum(weekdays)).max(7).optional(),
  // formatVersion 8 (#122):
  customExercises: z.array(customExercise).max(30).optional(),
  muscleGrowth: muscleGrowthSection.optional(),
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

// ---- formatVersion 6: setup profile (#49) --------------------------------------------------
export const genders = ['male', 'female', 'other'] as const;
/** Age bands only, or an exact age (18+): never a date of birth. `under_18` means tracking only (#53). */
export const ageBands = ['under_18', '18_39', '40_59', '60_plus'] as const;
/** Weight bands, defined in kg (shown in lb as well). A band is a rough guide, never a weigh-in or a BMI. */
export const weightBands = ['under_70', '70_99', '100_plus'] as const;
export const fitnessGoals = ['maintain', 'gradual_loss', 'faster_loss', 'gain_muscle', 'improve_cardio'] as const;
export const activityLevels = ['mostly_sitting', 'some_walking', 'active_job', 'already_training'] as const;
export const equipmentKinds = ['none', 'bands', 'weights', 'gym'] as const;
export const physicalLimits = ['knees', 'back', 'shoulders'] as const;
export const dietaryNeeds = ['vegetarian', 'vegan', 'dairy_free', 'gluten_free', 'nut_allergy'] as const;
export const profileV6Fields = [
  'gender', 'ageBand', 'age', 'weightBand', 'weight', 'fitnessGoals', 'daysPerWeek', 'activityLevel', 'equipment', 'physicalLimits', 'dietary', 'considerations',
] as const;

/** The band an exact age falls in. */
export const ageBandOf = (age: number): (typeof ageBands)[number] => (age < 18 ? 'under_18' : age < 40 ? '18_39' : age < 60 ? '40_59' : '60_plus');

export const profileSection = z.strictObject({
  displayName: z.string().min(1).max(40).optional(),
  heightCm: z.number().min(50).max(260).optional(),
  notes: z.array(note).max(10).optional(),
  // formatVersion 6 (#49, #53): what the user told the app during setup. All optional.
  gender: z.enum(genders).optional(),
  ageBand: z.enum(ageBands).optional(),
  /** An exact age, only if the user chose to give one. */
  age: z.number().int().min(18).max(120).optional(),
  weightBand: z.enum(weightBands).optional(),
  /** An exact weight given during setup, in `units.mass`. Context for the plan; never a recorded weigh-in. */
  weight: z.number().positive().max(700).optional(),
  fitnessGoals: z.array(z.enum(fitnessGoals)).min(1).max(5).optional(),
  daysPerWeek: z.number().int().min(1).max(7).optional(),
  activityLevel: z.enum(activityLevels).optional(),
  equipment: z.array(z.enum(equipmentKinds)).min(1).max(4).optional(),
  physicalLimits: z.array(z.enum(physicalLimits)).min(1).max(3).optional(),
  dietary: z.array(z.enum(dietaryNeeds)).min(1).max(5).optional(),
  /** Injuries, limits or food restrictions to work around, in the user's words. */
  considerations: z.string().min(1).max(200).optional(),
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
  formatVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7), z.literal(8)]),
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
  /** May be empty (#49): a new user can start with tracking only and add a plan later. */
  activities: z.array(activity).max(60),
  quickLogs: z.array(quickLogSchema).max(2).default([]),
  profile: profileSection.optional(),
  exercise: exerciseSection.optional(),
  requirements: z.array(requirementSchema).max(20).optional(),
  // formatVersion 5 (#51):
  timing: timingSchema.optional(),
}).superRefine((p, ctx) => {
  const rest = p.exercise?.restDays;
  if (rest && new Set(rest).size !== rest.length) ctx.addIssue({ code: 'custom', path: ['exercise', 'restDays'], message: 'each day only once' });
  if (p.formatVersion < 8) {
    for (const f of ['customExercises', 'muscleGrowth'] as const) {
      if (p.exercise?.[f] !== undefined) ctx.addIssue({ code: 'custom', path: ['exercise', f], message: `"exercise.${f}" needs formatVersion 8` });
    }
  }
  const custom = p.exercise?.customExercises ?? [];
  if (new Set(custom.map((c) => c.movement)).size !== custom.length) ctx.addIssue({ code: 'custom', path: ['exercise', 'customExercises'], message: 'each movement only once' });
  custom.forEach((c, i) => c.primary.some((m) => c.secondary.includes(m)) && ctx.addIssue({ code: 'custom', path: ['exercise', 'customExercises', i], message: 'a muscle is both primary and secondary' }));
  const mg = p.exercise?.muscleGrowth;
  if (mg) {
    if (new Set(mg.targets).size !== mg.targets.length) ctx.addIssue({ code: 'custom', path: ['exercise', 'muscleGrowth', 'targets'], message: 'each muscle only once' });
    if (new Set(mg.exercises.map((e) => e.movement)).size !== mg.exercises.length) ctx.addIssue({ code: 'custom', path: ['exercise', 'muscleGrowth', 'exercises'], message: 'each movement only once' });
    mg.exercises.forEach((e, i) => e.reps !== undefined && e.seconds !== undefined && ctx.addIssue({ code: 'custom', path: ['exercise', 'muscleGrowth', 'exercises', i], message: 'give reps or seconds, not both' }));
    if (mg.days && new Set(mg.days).size !== mg.days.length) ctx.addIssue({ code: 'custom', path: ['exercise', 'muscleGrowth', 'days'], message: 'each day only once' });
  }
  if (p.formatVersion < 7) {
    if (rest !== undefined) ctx.addIssue({ code: 'custom', path: ['exercise', 'restDays'], message: '"exercise.restDays" needs formatVersion 7' });
    p.activities.forEach((a, i) => a.movement !== undefined && ctx.addIssue({ code: 'custom', path: ['activities', i, 'movement'], message: '"movement" needs formatVersion 7' }));
  }
  if (p.formatVersion < 6 && p.profile) {
    for (const f of profileV6Fields) {
      if (p.profile[f] !== undefined) ctx.addIssue({ code: 'custom', path: ['profile', f], message: `"profile.${f}" needs formatVersion 6` });
    }
  }
  const pr = p.profile;
  const once = (key: 'fitnessGoals' | 'equipment' | 'physicalLimits' | 'dietary') => {
    const xs = pr?.[key] as string[] | undefined;
    if (xs && new Set(xs).size !== xs.length) ctx.addIssue({ code: 'custom', path: ['profile', key], message: 'each value only once' });
  };
  (['fitnessGoals', 'equipment', 'physicalLimits', 'dietary'] as const).forEach(once);
  const goals = new Set(pr?.fitnessGoals ?? []);
  if (goals.has('gradual_loss') && goals.has('faster_loss')) ctx.addIssue({ code: 'custom', path: ['profile', 'fitnessGoals'], message: 'choose gradual_loss or faster_loss, not both' });
  if (goals.has('maintain') && (goals.has('gradual_loss') || goals.has('faster_loss'))) ctx.addIssue({ code: 'custom', path: ['profile', 'fitnessGoals'], message: 'maintain cannot be combined with weight loss' });
  if (pr?.ageBand === 'under_18' && (goals.has('gradual_loss') || goals.has('faster_loss'))) ctx.addIssue({ code: 'custom', path: ['profile', 'fitnessGoals'], message: 'no weight-loss goals under 18' });
  if (pr?.age !== undefined && pr.ageBand !== undefined && ageBandOf(pr.age) !== pr.ageBand) ctx.addIssue({ code: 'custom', path: ['profile', 'ageBand'], message: 'ageBand must match age' });
  if (pr?.weight !== undefined && pr.weightBand !== undefined) ctx.addIssue({ code: 'custom', path: ['profile', 'weightBand'], message: 'give either weight or weightBand, not both' });
  if (p.formatVersion < 5) {
    const need = '"leadMinutes" needs formatVersion 5';
    if (p.timing !== undefined) ctx.addIssue({ code: 'custom', path: ['timing'], message: '"timing" needs formatVersion 5' });
    p.activities.forEach((a, i) => a.leadMinutes !== undefined && ctx.addIssue({ code: 'custom', path: ['activities', i, 'leadMinutes'], message: need }));
    p.requirements?.forEach((r, i) => r.leadMinutes !== undefined && ctx.addIssue({ code: 'custom', path: ['requirements', i, 'leadMinutes'], message: need }));
  }
  if (p.formatVersion === 1) {
    for (const key of ['profile', 'exercise', 'requirements'] as const) {
      if (p[key] !== undefined) ctx.addIssue({ code: 'custom', path: [key], message: `"${key}" needs formatVersion 2` });
    }
    const v2Fields = ['purpose', 'when', 'after', 'session', 'satisfies'] as const;
    p.activities.forEach((a, i) => {
      for (const f of v2Fields) {
        if (a[f] !== undefined) ctx.addIssue({ code: 'custom', path: ['activities', i, f], message: `"${f}" needs formatVersion 2` });
      }
    });
  }
  if (p.formatVersion < 4) {
    p.activities.forEach((a, i) => {
      if (a.notifications !== undefined) ctx.addIssue({ code: 'custom', path: ['activities', i, 'notifications'], message: '"notifications" needs formatVersion 4' });
    });
  }
  if (p.formatVersion < 3) {
    p.activities.forEach((a, i) => {
      for (const f of ['ingredients', 'preparation'] as const) {
        if (a[f] !== undefined) ctx.addIssue({ code: 'custom', path: ['activities', i, f], message: `"${f}" needs formatVersion 3` });
      }
    });
  }
});

export type Plan = z.output<typeof planSchema>;
export type Activity = Plan['activities'][number];
export type Ingredient = NonNullable<Activity['ingredients']>[number];
export type PlanNotification = NonNullable<Activity['notifications']>[number];
export type Measurement = Plan['measurements'][number];
export type NutritionTarget = Plan['nutrition']['targets'][number];
export type Weekday = (typeof weekdays)[number];
export type ExerciseSection = z.infer<typeof exerciseSection>;
export type CustomExercise = z.infer<typeof customExercise>;
export type MuscleGrowth = z.infer<typeof muscleGrowthSection>;
export type MuscleGrowthExercise = z.infer<typeof muscleGrowthExercise>;
export type ProfileSection = z.infer<typeof profileSection>;
export type Requirement = z.output<typeof requirementSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type SessionExercise = Session['exercises'][number];
export type Purpose = (typeof purposes)[number];
export type DayPart = (typeof dayParts)[number];
/** Building blocks reused by the configuration sections (src/config). */
/** The plan format this app writes (Configure with AI, setup). */
export const CURRENT_FORMAT_VERSION = 8;

export const planParts = { activity, measurement, nutritionTarget, appliesTo, time, requirement: requirementSchema };
