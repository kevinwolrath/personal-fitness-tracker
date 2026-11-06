import { z } from 'zod';
import {
  dayTypeSchema,
  eatingWindowSchema,
  exerciseSection,
  goalSchema,
  planParts,
  profileSection,
  quickLogSchema,
  timingSchema,
  unitsSchema,
  weekScheduleSchema,
} from '../plan/schema';

/**
 * The fitness configuration (contract 07) is a sectioned view over the stored plan package.
 * There is no second store: each section field reads and writes a part of the raw plan JSON.
 *
 * Patching works on the *raw* JSON object (not the schema-parsed plan), so anything a payload
 * doesn't mention stays byte-for-byte as it was.
 */
export const CONFIG_SCHEMA_VERSION = 1;

export type RawPlan = Record<string, any>;

type Field = {
  /** Schema for this field's value in an update payload. */
  schema: z.ZodTypeAny;
  /** May be cleared with `null`. */
  clearable: boolean;
  read(raw: RawPlan): unknown;
  /** `undefined` removes the value (only reached for clearable fields set to null). */
  write(raw: RawPlan, value: unknown): void;
  /** Short human name for previews and instructions. */
  title: string;
  /** What this field holds, for the AI instructions. */
  doc: string;
  /**
   * An id-keyed list that also accepts `{ "merge": [items] }`: items replace the ones with the same id,
   * new ids are added, and every other item is left exactly as it was (contract 07, #26).
   */
  mergeById?: boolean;
  /** How a merge lands, when the list lives inside a bigger one (meals in `activities`): in place, never reordered. */
  merge?(raw: RawPlan, items: { id: string }[]): void;
};

/**
 * Merge into `raw.activities` in place: same id in this part (meals, or non-meals) → replaced where it is;
 * otherwise appended (so an id clash with the other part fails validation as a duplicate). Nothing moves.
 */
const mergeActivities = (isPart: (a: any) => boolean) => (raw: RawPlan, items: { id: string }[]) => {
  const current: any[] = raw.activities ?? [];
  const byId = new Map(items.map((m) => [m.id, m]));
  const used = new Set<string>();
  const out = current.map((a) => {
    const m = isPart(a) ? byId.get(a.id) : undefined;
    if (m) used.add(a.id);
    return m ?? a;
  });
  raw.activities = [...out, ...items.filter((m) => !used.has(m.id))];
};

const meal = planParts.activity.refine((a) => a.kind === 'meal', { message: 'nutrition.meals items must have kind "meal"' });
const scheduled = planParts.activity.refine((a) => a.kind !== 'meal', {
  message: 'meals belong in nutrition.meals, not schedule.activities',
});

/** Replace the activities matching `isPart` in place (keeping the position of the first one), leave the rest. */
function replaceActivities(raw: RawPlan, isPart: (a: any) => boolean, next: unknown[]) {
  const current: any[] = raw.activities ?? [];
  const out: any[] = [];
  let inserted = false;
  for (const a of current) {
    if (isPart(a)) {
      if (!inserted) out.push(...next);
      inserted = true;
    } else out.push(a);
  }
  if (!inserted) out.push(...next);
  raw.activities = out;
}

const nested = (parent: string, key: string, title: string, schema: z.ZodTypeAny, doc: string): Field => ({
  schema,
  clearable: true,
  title,
  doc,
  read: (raw) => raw[parent]?.[key],
  write: (raw, value) => {
    const obj = { ...(raw[parent] ?? {}) };
    if (value === undefined) delete obj[key];
    else obj[key] = value;
    if (Object.keys(obj).length) raw[parent] = obj;
    else delete raw[parent];
  },
});

const top = (key: string, title: string, schema: z.ZodTypeAny, doc: string, clearable = false): Field => ({
  schema,
  clearable,
  title,
  doc,
  read: (raw) => raw[key],
  write: (raw, value) => {
    if (value === undefined) delete raw[key];
    else raw[key] = value;
  },
});

const ex = exerciseSection.shape;
const pr = profileSection.shape;

export const sections = {
  profile: {
    title: 'Profile',
    fields: {
      units: top('units', 'Units', unitsSchema, 'Display units: { mass: "kg"|"lb", energy: "kJ"|"kcal", length: "cm"|"in" }'),
      displayName: nested('profile', 'displayName', 'Name', pr.displayName, 'Name to address the user by'),
      heightCm: nested('profile', 'heightCm', 'Height', pr.heightCm, 'Height in cm'),
      notes: nested('profile', 'notes', 'Notes', pr.notes, 'Free-text facts about the user (max 10 x 200 chars)'),
      gender: nested('profile', 'gender', 'Gender', pr.gender, 'male | female | other | prefer_not_to_say'),
      ageBand: nested('profile', 'ageBand', 'Age', pr.ageBand, 'Age band: under_18 | 18_29 | 30_39 | 40_49 | 50_59 | 60_plus. Never ask for a date of birth.'),
      weightBand: nested('profile', 'weightBand', 'Weight range', pr.weightBand, 'Approximate weight band in kg: under_60 | 60_79 | 80_99 | 100_119 | 120_plus. A guide only; not a weigh-in. Not together with weight.'),
      weight: nested('profile', 'weight', 'Weight', pr.weight, 'Weight the user gave during setup, in profile.units mass. Context only; recorded weigh-ins are separate. Not together with weightBand.'),
      fitnessGoals: nested('profile', 'fitnessGoals', 'Goals', pr.fitnessGoals, 'What the user wants: [maintain | lose_weight | gain_muscle | improve_cardio], 1–4, each once'),
      primaryGoal: nested('profile', 'primaryGoal', 'Primary goal', pr.primaryGoal, 'The goal that leads the plan; must be one of fitnessGoals'),
      daysPerWeek: nested('profile', 'daysPerWeek', 'Days per week', pr.daysPerWeek, 'Days per week the user can train (1–7)'),
      sessionMinutes: nested('profile', 'sessionMinutes', 'Time per session', pr.sessionMinutes, 'Minutes per session the user has (5–240)'),
      trainingPlaces: nested('profile', 'trainingPlaces', 'Where they train', pr.trainingPlaces, '[home | gym | outdoors | no_equipment], each once'),
      activityLevel: nested('profile', 'activityLevel', 'Current activity', pr.activityLevel, 'mostly_sitting | some_walking | active_job | already_training'),
      considerations: nested('profile', 'considerations', 'To work around', pr.considerations, 'Injuries, limits or food restrictions, in the user\'s words (≤ 200 chars)'),
    },
  },
  goals: {
    title: 'Goals',
    fields: {
      targets: { ...top('goals', 'Measurement goals', z.array(goalSchema).max(4), 'Body measurement goals: [{ id, label, measurementId, target, direction: "decrease"|"increase"|"maintain" }]'), mergeById: true },
    },
  },
  nutrition: {
    title: 'Nutrition',
    fields: {
      targets: { ...nested('nutrition', 'targets', 'Daily targets', z.array(planParts.nutritionTarget).max(4), 'Daily targets: [{ id, label, quantity: "energy"|"grams", min?, max?, appliesTo? }]'), mergeById: true },
      eatingWindow: nested('nutrition', 'eatingWindow', 'Eating window', eatingWindowSchema, '{ start: "HH:MM", end: "HH:MM" }'),
      meals: {
        schema: z.array(meal).max(20),
        clearable: false,
        title: 'Meals',
        doc: 'Planned meals (activities with kind "meal"): [{ id, kind: "meal", label, detail?, time? | when?, leadMinutes?, after?, purpose?, appliesTo?, nutrition?: { <targetId>: amount }, flexible?, ingredients?: [{ name, grams?, ml?, measure? }], preparation? }]. ingredients: what to prepare, each with grams and/or ml where it applies plus an everyday measure written for the user (e.g. "~¾ cup", "1 scoop", "as needed"); the app shows the measure exactly as written and never converts units. preparation: short instructions for making the meal (e.g. how much water to add). notifications (optional, max 3): local reminders for this activity, each { offsetMinutes | at, title, body }: exactly one of offsetMinutes (minutes from the activity\'s start: its time, or the start of its day part; negative = before) or at ("HH:MM"). Omit or [] for no reminder. Reminders only fire if the user has turned them on in the app; never try to turn them on or off from here.',
        read: (raw) => (raw.activities ?? []).filter((a: any) => a.kind === 'meal'),
        write: (raw, value) => replaceActivities(raw, (a) => a.kind === 'meal', value as unknown[]),
        mergeById: true,
        merge: mergeActivities((a) => a.kind === 'meal'),
      } satisfies Field,
    },
  },
  exercise: {
    title: 'Exercise',
    fields: {
      goals: nested('exercise', 'goals', 'Training goals', ex.goals, 'Training goals (enum list)'),
      equipment: nested('exercise', 'equipment', 'Equipment', ex.equipment, 'Available equipment: [{ type, label?, brand?, weightsKg?, notes? }]'),
      limitations: nested('exercise', 'limitations', 'Limitations', ex.limitations, 'Movement limits: [{ movement, status: "avoid"|"caution"|"allowed", reason? }]'),
      substitutions: nested('exercise', 'substitutions', 'Substitutions', ex.substitutions, 'Preferred swaps: [{ instead, use: [movement, …], reason? }]'),
      activityTypes: nested('exercise', 'activityTypes', 'Activity types', ex.activityTypes, 'Kinds of training the user does: [{ id, label, kind, intensity?, equipment?, notes? }]'),
      strength: nested('exercise', 'strength', 'Strength training', ex.strength, 'Resistance training: { sessionsPerWeek?, sessionMinutes?, intensity?, modalities?, split?, focus?, notes? }'),
      conditioning: nested('exercise', 'conditioning', 'Conditioning', ex.conditioning, 'Conditioning: { sessionsPerWeek?, sessionMinutes?, intensity?, modalities?, notes? }'),
      constraints: nested('exercise', 'constraints', 'Constraints', ex.constraints, 'Real-life limits: { location?, gymMembership?, maxSessionMinutes?, notes? }'),
    },
  },
  schedule: {
    title: 'Schedule',
    fields: {
      dayTypes: top('dayTypes', 'Day types', z.array(dayTypeSchema).min(1).max(7), 'Kinds of day: [{ id, label }]'),
      week: top('schedule', 'Weekly schedule', weekScheduleSchema, 'Default day type per weekday: { mon: dayTypeId, …, sun: dayTypeId } (all 7 required)'),
      requirements: top(
        'requirements',
        'Requirements',
        z.array(planParts.requirement).max(20),
        'Daily needs any one of several activities can meet: [{ id, label, purpose, detail?, required?, when? | time?, leadMinutes? }]. Activities point at one with "satisfies".',
        true,
      ),
      timing: top(
        'timing',
        'Due times',
        timingSchema,
        'When an item with an exact time becomes due ("Do this next"), in minutes before that time, per activity kind: { leadMinutes: { meal?, exercise?, habit? } } (whole minutes, 0–240). Defaults when absent: meal 15, habit 15, exercise 30. A single activity or requirement can override this with its own leadMinutes. Before an item is due the app only previews it.',
        true,
      ),
      activities: {
        schema: z.array(scheduled).max(40),
        clearable: false,
        title: 'Scheduled activities',
        doc: 'Planned exercise and habits (not meals): [{ id, kind: "exercise"|"habit", label, detail?, time? | when?, leadMinutes?, duration?, required?, appliesTo?, tracking?, purpose?, after?: [activityId], satisfies?: requirementId, session?: { minutes?, exercises: [{ movement, label?, sets?, reps?, seconds?, loadKg?, notes? }], short?: { minutes?, exercises } }, notifications?: [{ offsetMinutes? | at?, title, body }] }]. notifications (optional, max 3): local reminders for this activity, each { offsetMinutes | at, title, body }: exactly one of offsetMinutes (minutes from the activity\'s start: its time, or the start of its day part; negative = before) or at ("HH:MM"). Omit or [] for no reminder. Reminders only fire if the user has turned them on in the app; never try to turn them on or off from here.',
        read: (raw) => (raw.activities ?? []).filter((a: any) => a.kind !== 'meal'),
        write: (raw, value) => replaceActivities(raw, (a) => a.kind !== 'meal', value as unknown[]),
        mergeById: true,
        merge: mergeActivities((a) => a.kind !== 'meal'),
      } satisfies Field,
    },
  },
  tracking: {
    title: 'Tracking',
    fields: {
      measurements: { ...top('measurements', 'Measurements', z.array(planParts.measurement).max(8), 'What to record: [{ id, label, quantity: "mass"|"length"|"number", unitLabel?, decimals?, cadence }]'), mergeById: true },
      quickLogs: top('quickLogs', 'Quick logs', z.array(quickLogSchema).max(2), 'One-tap event buttons: [{ id, label, detail? }] (max 2)'),
    },
  },
} satisfies Record<string, { title: string; fields: Record<string, Field> }>;

export type SectionName = keyof typeof sections;
export const sectionNames = Object.keys(sections) as SectionName[];

/** Current configuration, section by section, read from the raw plan. Omits empty fields. */
export function readConfig(raw: RawPlan): Record<SectionName, Record<string, unknown>> {
  return Object.fromEntries(
    sectionNames.map((s) => [
      s,
      Object.fromEntries(
        Object.entries(sections[s].fields as Record<string, Field>)
          .map(([k, f]) => [k, f.read(raw)])
          .filter(([, v]) => v !== undefined),
      ),
    ]),
  ) as Record<SectionName, Record<string, unknown>>;
}

/** Strict patch schema for a section: every field optional; clearable fields accept null. */
export function sectionPatchSchema(name: SectionName) {
  const shape = Object.fromEntries(
    Object.entries(sections[name].fields as Record<string, Field>).map(([k, f]) => {
      const whole = f.clearable ? f.schema.nullable() : f.schema;
      if (!f.mergeById) return [k, whole.optional()];
      // Pick the schema by shape (not z.union), so errors keep their exact paths for the AI.
      const merge = z.strictObject({ merge: z.array((f.schema as z.ZodArray<z.ZodTypeAny>).element).min(1).max(20) });
      const either = z.any().superRefine((v, ctx) => {
        const r = (isMerge(v) || (v && typeof v === 'object' && !Array.isArray(v)) ? merge : whole).safeParse(v);
        if (!r.success) for (const i of r.error.issues) ctx.addIssue({ code: 'custom', message: i.message, path: i.path });
      });
      return [k, either.optional()];
    }),
  );
  return z.strictObject(shape).refine((o) => Object.keys(o).length > 0, { message: `"${name}" is empty: include at least one field` });
}

export const isMerge = (v: unknown): v is { merge: { id: string }[] } =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Array.isArray((v as { merge?: unknown }).merge);

/** `{ merge }` applied to the current list: same id → replaced in place, new id → appended, others untouched. */
export function mergeById(current: unknown, merge: { id: string }[]): unknown[] {
  const list = (Array.isArray(current) ? current : []) as { id: string }[];
  const byId = new Map(merge.map((m) => [m.id, m]));
  const out = list.map((item) => byId.get(item.id) ?? item);
  const existing = new Set(list.map((i) => i.id));
  return [...out, ...merge.filter((m) => !existing.has(m.id))];
}

export function fieldOf(section: SectionName, key: string): Field {
  return (sections[section].fields as Record<string, Field>)[key];
}
