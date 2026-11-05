import { z } from 'zod';
import { activityLevels, ageBands, fitnessGoals, genders, trainingPlaces, weightBands } from '../plan/schema';

/**
 * First-run setup (#49): the answers so far and where the user is. Kept on the device while the wizard runs, so
 * it resumes after a restart; removed once setup finishes (the plan then holds the profile). Pure data.
 */
export const steps = ['about', 'goals', 'context', 'generate', 'review'] as const;
export type Step = (typeof steps)[number];
export type Goal = (typeof fitnessGoals)[number];
export type Place = (typeof trainingPlaces)[number];

export const draftSchema = z.object({
  v: z.literal(1),
  step: z.enum(steps),
  unit: z.enum(['kg', 'lb']),
  gender: z.enum(genders).optional(),
  ageBand: z.enum(ageBands).optional(),
  weightBand: z.enum(weightBands).optional(),
  /** Exact weight in `unit`, instead of a band. */
  exactWeight: z.number().positive().max(1500).optional(),
  /** Also record the exact weight as today's weigh-in. Off unless the user ticks it; never for a band. */
  logWeighIn: z.boolean(),
  fitnessGoals: z.array(z.enum(fitnessGoals)).max(4),
  primaryGoal: z.enum(fitnessGoals).optional(),
  daysPerWeek: z.number().int().min(1).max(7).optional(),
  sessionMinutes: z.number().int().min(5).max(240).optional(),
  trainingPlaces: z.array(z.enum(trainingPlaces)).max(4),
  activityLevel: z.enum(activityLevels).optional(),
  considerations: z.string().max(200).optional(),
  /** On the review step: reviewing the AI's suggestion, or the basic profile (AI skipped). */
  path: z.enum(['ai', 'basic']).optional(),
});
export type Draft = z.infer<typeof draftSchema>;

export const newDraft = (unit: 'kg' | 'lb' = 'kg'): Draft => ({ v: 1, step: 'about', unit, logWeighIn: false, fitnessGoals: [], trainingPlaces: [] });

/** A stored draft, or a fresh one if it's missing or unreadable (never a crash). */
export function readDraft(json: string | null): Draft {
  if (!json) return newDraft();
  try {
    const r = draftSchema.safeParse(JSON.parse(json));
    return r.success ? r.data : newDraft();
  } catch {
    return newDraft();
  }
}

/** Under 18: no personalised plan, goals or AI step; tracking only. */
export const isMinor = (d: Pick<Draft, 'ageBand'>) => d.ageBand === 'under_18';

/** Toggle a goal. The first goal chosen leads; removing the primary passes it to the next one. */
export function toggleGoal(d: Draft, g: Goal): Draft {
  const has = d.fitnessGoals.includes(g);
  const goals = has ? d.fitnessGoals.filter((x) => x !== g) : [...d.fitnessGoals, g];
  const primary = goals.includes(d.primaryGoal as Goal) ? d.primaryGoal : goals[0];
  return { ...d, fitnessGoals: goals, primaryGoal: primary };
}

/** Choosing a band clears an exact weight (and its weigh-in), and the other way round. */
export const chooseWeightBand = (d: Draft, band: Draft['weightBand']): Draft => ({ ...d, weightBand: band, exactWeight: undefined, logWeighIn: false });
export const enterExactWeight = (d: Draft, value: number | undefined): Draft => ({ ...d, exactWeight: value, weightBand: undefined, logWeighIn: value === undefined ? false : d.logWeighIn });

/** The plan's `profile` for these answers (formatVersion 6). Only what the user gave; nothing invented. */
export function toProfile(d: Draft): Record<string, unknown> {
  const minor = isMinor(d);
  const p: Record<string, unknown> = {
    gender: d.gender,
    ageBand: d.ageBand,
    weightBand: d.exactWeight === undefined ? d.weightBand : undefined,
    weight: d.exactWeight,
    // Under 18: no goals or training context, so nothing can be personalised from them.
    fitnessGoals: !minor && d.fitnessGoals.length ? d.fitnessGoals : undefined,
    primaryGoal: !minor && d.fitnessGoals.length ? d.primaryGoal ?? d.fitnessGoals[0] : undefined,
    daysPerWeek: minor ? undefined : d.daysPerWeek,
    sessionMinutes: minor ? undefined : d.sessionMinutes,
    trainingPlaces: !minor && d.trainingPlaces.length ? d.trainingPlaces : undefined,
    activityLevel: minor ? undefined : d.activityLevel,
    considerations: minor ? undefined : d.considerations?.trim() || undefined,
  };
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined));
}
