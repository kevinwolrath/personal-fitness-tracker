import type { activityLevels, ageBands, dietaryNeeds, equipmentKinds, fitnessGoals, genders, physicalLimits, weightBands } from '../plan/schema';
import type { MealSlot } from '../presets/meals';
import type { Draft } from './draft';

/** Generic wording for the setup questions (#49, #53). App vocabulary, not plan content. */

export const genderLabels: Record<(typeof genders)[number], string> = { male: 'Male', female: 'Female', other: 'Other' };

/** Adult bands show their ages; under 18 is a separate tracking-only entry point. */
export const ageLabels: Record<(typeof ageBands)[number], string> = { under_18: 'Under 18', '18_39': '18–39', '40_59': '40–59', '60_plus': '60+' };
export const adultAgeBands = ['18_39', '40_59', '60_plus'] as const;

/** Bands are defined in kg; the lb wording is the same range, rounded (1 kg = 2.2046 lb). */
export const weightBandLabels: Record<(typeof weightBands)[number], { kg: string; lb: string }> = {
  under_70: { kg: 'Under 70', lb: 'Under 155' },
  '70_99': { kg: '70–99', lb: '155–219' },
  '100_plus': { kg: '100+', lb: '220+' },
};

export const goalLabels: Record<(typeof fitnessGoals)[number], { label: string; detail: string }> = {
  maintain: { label: 'Maintain weight', detail: 'Keep steady and build the habit' },
  gradual_loss: { label: 'Gradual weight loss', detail: 'A modest, sustainable change' },
  faster_loss: { label: 'Faster weight loss', detail: 'More activity within safe limits, never a crash diet' },
  gain_muscle: { label: 'Gain muscle', detail: 'Strength work with progression' },
  improve_cardio: { label: 'Improve cardio', detail: 'From walking up to steady cardio' },
};

export const activityLabels: Record<(typeof activityLevels)[number], string> = {
  mostly_sitting: 'Mostly sitting',
  some_walking: 'Some walking',
  active_job: 'Active',
  already_training: 'Training already',
};
export const equipmentLabels: Record<(typeof equipmentKinds)[number], string> = { none: 'None', bands: 'Bands', weights: 'Dumbbells or kettlebell', gym: 'Gym' };
export const limitLabels: Record<(typeof physicalLimits)[number], string> = { knees: 'Knees', back: 'Back', shoulders: 'Shoulders' };
export const dietLabels: Record<(typeof dietaryNeeds)[number], string> = {
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  dairy_free: 'Dairy-free',
  gluten_free: 'Gluten-free',
  nut_allergy: 'Nut allergy',
};
export const slotLabels: Record<MealSlot, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
export const dayOptions = [2, 3, 4, 5] as const;

const trimNumber = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
export const cmToIn = (cm: number) => Math.round(cm / 2.54);
export const inToCm = (inches: number) => Math.round(inches * 2.54 * 10) / 10;

/** What the user told the app, as label/value lines (the review and the AI prompt). */
export function answerLines(d: Draft): { label: string; value: string }[] {
  const lines: { label: string; value: string }[] = [];
  if (d.gender) lines.push({ label: 'Gender', value: genderLabels[d.gender] });
  if (d.age) lines.push({ label: 'Age', value: String(d.age) });
  else if (d.ageBand) lines.push({ label: 'Age', value: ageLabels[d.ageBand] });
  if (d.exactWeight !== undefined) lines.push({ label: 'Weight', value: `${trimNumber(d.exactWeight)} ${d.unit}` });
  else if (d.weightBand) lines.push({ label: 'Weight', value: `${weightBandLabels[d.weightBand][d.unit]} ${d.unit} (a range)` });
  if (d.heightCm) lines.push({ label: 'Height', value: d.unit === 'lb' ? `${cmToIn(d.heightCm)} in` : `${trimNumber(d.heightCm)} cm` });
  if (d.dietary.length) lines.push({ label: 'Dietary needs', value: d.dietary.map((x) => dietLabels[x]).join(', ') });
  if (d.ageBand === 'under_18') return lines;
  if (d.fitnessGoals.length) lines.push({ label: 'Goals', value: d.fitnessGoals.map((g) => goalLabels[g].label).join(', ') });
  if (d.activityLevel) lines.push({ label: 'Activity now', value: activityLabels[d.activityLevel] });
  if (d.daysPerWeek) lines.push({ label: 'Days per week', value: `Up to ${d.daysPerWeek}` });
  if (d.equipment.length) lines.push({ label: 'Equipment', value: d.equipment.map((x) => equipmentLabels[x]).join(', ') });
  if (d.physicalLimits.length) lines.push({ label: 'Go easy on', value: d.physicalLimits.map((x) => limitLabels[x]).join(', ') });
  if (d.considerations?.trim()) lines.push({ label: 'To work around', value: d.considerations.trim() });
  return lines;
}
