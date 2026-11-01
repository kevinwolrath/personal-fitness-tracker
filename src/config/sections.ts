import { z } from 'zod';
import {
  dayTypeSchema,
  eatingWindowSchema,
  exerciseSection,
  goalSchema,
  planParts,
  profileSection,
  quickLogSchema,
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
    },
  },
  goals: {
    title: 'Goals',
    fields: {
      targets: top('goals', 'Measurement goals', z.array(goalSchema).max(4), 'Body measurement goals: [{ id, label, measurementId, target, direction: "decrease"|"increase"|"maintain" }]'),
    },
  },
  nutrition: {
    title: 'Nutrition',
    fields: {
      targets: nested('nutrition', 'targets', 'Daily targets', z.array(planParts.nutritionTarget).max(4), 'Daily targets: [{ id, label, quantity: "energy"|"grams", min?, max?, appliesTo? }]'),
      eatingWindow: nested('nutrition', 'eatingWindow', 'Eating window', eatingWindowSchema, '{ start: "HH:MM", end: "HH:MM" }'),
      meals: {
        schema: z.array(meal).max(20),
        clearable: false,
        title: 'Meals',
        doc: 'Planned meals (activities with kind "meal"): [{ id, kind: "meal", label, detail?, time?, appliesTo?, nutrition?: { <targetId>: amount }, flexible? }]',
        read: (raw) => (raw.activities ?? []).filter((a: any) => a.kind === 'meal'),
        write: (raw, value) => replaceActivities(raw, (a) => a.kind === 'meal', value as unknown[]),
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
      activities: {
        schema: z.array(scheduled).max(40),
        clearable: false,
        title: 'Scheduled activities',
        doc: 'Planned exercise and habits (not meals): [{ id, kind: "exercise"|"habit", label, detail?, time?, duration?, required?, appliesTo?, tracking? }]',
        read: (raw) => (raw.activities ?? []).filter((a: any) => a.kind !== 'meal'),
        write: (raw, value) => replaceActivities(raw, (a) => a.kind !== 'meal', value as unknown[]),
      } satisfies Field,
    },
  },
  tracking: {
    title: 'Tracking',
    fields: {
      measurements: top('measurements', 'Measurements', z.array(planParts.measurement).max(8), 'What to record: [{ id, label, quantity: "mass"|"length"|"number", unitLabel?, decimals?, cadence }]'),
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
    Object.entries(sections[name].fields as Record<string, Field>).map(([k, f]) => [
      k,
      (f.clearable ? f.schema.nullable() : f.schema).optional(),
    ]),
  );
  return z.strictObject(shape).refine((o) => Object.keys(o).length > 0, { message: `"${name}" is empty: include at least one field` });
}

export function fieldOf(section: SectionName, key: string): Field {
  return (sections[section].fields as Record<string, Field>)[key];
}
