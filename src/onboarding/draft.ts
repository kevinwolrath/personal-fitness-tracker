import { z } from 'zod';
import { activityLevels, ageBandOf, ageBands, dietaryNeeds, equipmentKinds, fitnessGoals, genders, physicalLimits, weightBands } from '../plan/schema';
import { exerciseStyles } from '../presets/exercisePlan';
import { mealSlots } from '../presets/meals';

/**
 * Setup answers and review choices (#49, #53). Kept on the device during first-run setup so it resumes after a
 * restart; removed once setup finishes (the plan then holds the profile). Pure data.
 */
export const steps = ['about', 'goals', 'review'] as const;
export type Step = (typeof steps)[number];
export type Goal = (typeof fitnessGoals)[number];

export const draftSchema = z.object({
  v: z.literal(2),
  step: z.enum(steps),
  unit: z.enum(['kg', 'lb']),
  gender: z.enum(genders).optional(),
  ageBand: z.enum(ageBands).optional(),
  /** Exact age (18+), only if given. */
  age: z.number().int().min(18).max(120).optional(),
  weightBand: z.enum(weightBands).optional(),
  /** Exact weight in `unit`, instead of a band. */
  exactWeight: z.number().positive().max(1500).optional(),
  /** Also record the exact weight as today's weigh-in. Off unless ticked; never for a band. */
  logWeighIn: z.boolean(),
  heightCm: z.number().min(50).max(260).optional(),
  fitnessGoals: z.array(z.enum(fitnessGoals)).max(5),
  daysPerWeek: z.number().int().min(1).max(7).optional(),
  activityLevel: z.enum(activityLevels).optional(),
  equipment: z.array(z.enum(equipmentKinds)).max(4),
  physicalLimits: z.array(z.enum(physicalLimits)).max(3),
  dietary: z.array(z.enum(dietaryNeeds)).max(5),
  considerations: z.string().max(200).optional(),
  // Review choices.
  exerciseOption: z.number().int().min(0).max(exerciseStyles.length - 1),
  mealOption: z.number().int().min(0).max(2),
  /** A meal slot swapped to another template (id), or left unplanned (null). */
  mealSwaps: z.partialRecord(z.enum(mealSlots), z.string().nullable()),
  /** Plan activities the user took out on the review. */
  removed: z.array(z.string()).max(20),
});
export type Draft = z.infer<typeof draftSchema>;

export const newDraft = (unit: 'kg' | 'lb' = 'kg'): Draft => ({
  v: 2, step: 'about', unit, logWeighIn: false, fitnessGoals: [], equipment: [], physicalLimits: [], dietary: [],
  exerciseOption: 0, mealOption: 0, mealSwaps: {}, removed: [],
});

/** A stored draft, or a fresh one if it's missing, unreadable or from an older version (never a crash). */
export function readDraft(json: string | null): Draft {
  if (!json) return newDraft();
  try {
    const r = draftSchema.safeParse(JSON.parse(json));
    return r.success ? r.data : newDraft();
  } catch {
    return newDraft();
  }
}

/** Under 18: tracking only. No goals, no plan, no AI. */
export const isMinor = (d: Pick<Draft, 'ageBand'>) => d.ageBand === 'under_18';

/** Toggle a goal. Gradual and faster loss exclude each other; maintain excludes both. Changing goals resets review choices. */
export function toggleGoal(d: Draft, g: Goal): Draft {
  const has = d.fitnessGoals.includes(g);
  const clash: Record<Goal, Goal[]> = {
    maintain: ['gradual_loss', 'faster_loss'],
    gradual_loss: ['faster_loss', 'maintain'],
    faster_loss: ['gradual_loss', 'maintain'],
    gain_muscle: [],
    improve_cardio: [],
  };
  const goals = has ? d.fitnessGoals.filter((x) => x !== g) : [...d.fitnessGoals.filter((x) => !clash[g].includes(x)), g];
  return resetChoices({ ...d, fitnessGoals: goals });
}

/** Answers changed: the review starts again from option 1 with no swaps. */
export const resetChoices = (d: Draft): Draft => ({ ...d, exerciseOption: 0, mealOption: 0, mealSwaps: {}, removed: [] });

/** Toggle a value in one of the multi-choice answers. */
export function toggleIn<K extends 'equipment' | 'physicalLimits' | 'dietary'>(d: Draft, key: K, v: Draft[K][number]): Draft {
  const xs = d[key] as string[];
  return resetChoices({ ...d, [key]: xs.includes(v) ? xs.filter((x) => x !== v) : [...xs, v] });
}

/** Choosing an age band clears an exact age; an exact age sets its band. Under 18 clears adult goals. */
export function chooseAgeBand(d: Draft, band: Draft['ageBand']): Draft {
  const next = { ...d, ageBand: band, age: undefined };
  return band === 'under_18' ? { ...next, fitnessGoals: [] } : next;
}
export function enterAge(d: Draft, age: number | undefined): Draft {
  if (age === undefined) return { ...d, age: undefined };
  if (age < 18) return chooseAgeBand(d, 'under_18');
  return { ...d, age, ageBand: ageBandOf(age) };
}

/** Choosing a band clears an exact weight (and its weigh-in), and the other way round. */
export const chooseWeightBand = (d: Draft, band: Draft['weightBand']): Draft => ({ ...d, weightBand: band, exactWeight: undefined, logWeighIn: false });
export const enterExactWeight = (d: Draft, value: number | undefined): Draft => ({ ...d, exactWeight: value, weightBand: undefined, logWeighIn: value === undefined ? false : d.logWeighIn });

/** The plan's `profile` for these answers (formatVersion 6). Only what the user gave; nothing invented. */
export function toProfile(d: Draft): Record<string, unknown> {
  const minor = isMinor(d);
  const list = <T,>(xs: T[]) => (!minor && xs.length ? xs : undefined);
  const p: Record<string, unknown> = {
    gender: d.gender,
    ageBand: d.ageBand,
    age: minor ? undefined : d.age,
    weightBand: d.exactWeight === undefined ? d.weightBand : undefined,
    weight: d.exactWeight,
    heightCm: d.heightCm,
    fitnessGoals: list(d.fitnessGoals),
    daysPerWeek: minor ? undefined : d.daysPerWeek,
    activityLevel: minor ? undefined : d.activityLevel,
    equipment: list(d.equipment),
    physicalLimits: list(d.physicalLimits),
    dietary: d.dietary.length ? d.dietary : undefined,
    considerations: minor ? undefined : d.considerations?.trim() || undefined,
  };
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined));
}

/** A draft from an existing plan's profile, for "Edit setup answers". */
export function draftFromProfile(profile: Record<string, any> | undefined, unit: 'kg' | 'lb'): Draft {
  const parsed = draftSchema.safeParse({ ...newDraft(unit), ...pick(profile ?? {}), exactWeight: profile?.weight });
  return parsed.success ? parsed.data : newDraft(unit);
}
const pick = (p: Record<string, any>) =>
  Object.fromEntries(
    ['gender', 'ageBand', 'age', 'weightBand', 'heightCm', 'fitnessGoals', 'daysPerWeek', 'activityLevel', 'equipment', 'physicalLimits', 'dietary', 'considerations']
      .filter((k) => p[k] !== undefined)
      .map((k) => [k, p[k]]),
  );
