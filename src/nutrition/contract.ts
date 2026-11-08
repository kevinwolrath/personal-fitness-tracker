/**
 * Photo meal logging (#97, contract 15): the versioned reply contract an external AI fills in, and the stored
 * meal model. Pure types and limits only; no UI and no I/O.
 *
 * The app never calls an AI itself. The user shares the photo and the prompt (`prompt.ts`) with any AI app,
 * then pastes the reply back. Pasted text is only ever `JSON.parse`d (`parse.ts`), never run.
 */

/** The only reply version this build reads. A newer one is refused with a clear message, never guessed at. */
export const MEAL_REPLY_SCHEMA_VERSION = 1;

export const nutrientKeys = ['energyKj', 'proteinG', 'carbsG', 'fatG'] as const;
export type NutrientKey = (typeof nutrientKeys)[number];

/** Per-nutrient amounts. Null = unknown: never filled in by the app. */
export type Nutrients = Record<NutrientKey, number | null>;

export const nutrientLabels: Record<NutrientKey, { label: string; unit: 'kJ' | 'g'; short: string }> = {
  energyKj: { label: 'Energy', unit: 'kJ', short: 'kJ' },
  proteinG: { label: 'Protein', unit: 'g', short: 'Protein g' },
  carbsG: { label: 'Carbs', unit: 'g', short: 'Carbs g' },
  fatG: { label: 'Fat', unit: 'g', short: 'Fat g' },
};

/**
 * Sensible upper limits. A value above one is reported as a problem and left empty for the user to check, never
 * clipped. Generous on purpose: a large restaurant meal is ~12,000 kJ; anything near these is almost surely an error.
 */
export const limits = {
  itemNutrient: { energyKj: 15_000, proteinG: 300, carbsG: 500, fatG: 300 } satisfies Record<NutrientKey, number>,
  mealNutrient: { energyKj: 30_000, proteinG: 600, carbsG: 1_000, fatG: 600 } satisfies Record<NutrientKey, number>,
  quantity: 5_000,
  items: 30,
  name: 80,
  notes: 12,
  noteLength: 300,
  /** Pasted text larger than this isn't a single meal reply. */
  pasteChars: 100_000,
} as const;

/** Units the review shows as they are. Anything else is kept as written and flagged. */
export const knownUnits = ['g', 'ml', 'piece', 'slice', 'cup', 'tbsp', 'tsp', 'serving', 'bowl', 'handful'] as const;

export type Confidence = 'low' | 'medium' | 'high';

/** One food in a meal, after validation and normalisation. */
export type MealItem = { name: string; quantity: number | null; unit: string | null } & Nutrients;

export type MealPhoto = {
  id: string;
  /** App-private, permanent file (native document directory) or a data URI on web. Never uploaded by the app. */
  uri: string;
  addedAt: string;
  width: number | null;
  height: number | null;
};

/**
 * A meal actually eaten (#97). It records the food, not the plan: when it replaces a scheduled meal, that meal is
 * marked done for the day's progress, but its planned nutrition is never counted as eaten.
 */
export type MealLog = {
  id: string;
  /** Local date the meal was eaten. Today or past only. */
  date: string;
  /** When it was eaten or logged, ISO with offset. */
  at: string;
  /** The scheduled meal this replaced: plan id and activity id, plus its label at the time. Null for an extra meal. */
  planId: string | null;
  activityId: string | null;
  replacedLabel: string | null;
  name: string;
  items: MealItem[];
  /** The AI's own totals as pasted, kept only to show the discrepancy. Totals shown and counted come from items. */
  aiTotals: Nutrients | null;
  confidence: Confidence | null;
  assumptions: string[];
  uncertainties: string[];
  /** `photo-ai`: from a pasted AI reply; `manual`: typed in. */
  source: 'photo-ai' | 'manual';
  /** Reply contract version it was parsed from; null for manual. */
  schemaVersion: number | null;
  /** The user changed a parsed value before saving. */
  edited: boolean;
  photos: MealPhoto[];
  recordedAt: string;
  updatedAt: string;
};
