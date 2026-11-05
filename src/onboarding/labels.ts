import type { activityLevels, ageBands, fitnessGoals, genders, trainingPlaces, weightBands } from '../plan/schema';
import type { Draft } from './draft';

/** Generic wording for the setup questions (#49). App vocabulary, not plan content. */

export const genderLabels: Record<(typeof genders)[number], string> = {
  male: 'Male',
  female: 'Female',
  other: 'Other',
  prefer_not_to_say: 'Prefer not to say',
};

export const ageLabels: Record<(typeof ageBands)[number], string> = {
  under_18: 'Under 18',
  '18_29': '18–29',
  '30_39': '30–39',
  '40_49': '40–49',
  '50_59': '50–59',
  '60_plus': '60+',
};

/** Bands are defined in kg; the lb wording is the same range, rounded (1 kg = 2.2046 lb). */
export const weightBandLabels: Record<(typeof weightBands)[number], { kg: string; lb: string }> = {
  under_60: { kg: 'Under 60', lb: 'Under 132' },
  '60_79': { kg: '60–79', lb: '132–175' },
  '80_99': { kg: '80–99', lb: '176–219' },
  '100_119': { kg: '100–119', lb: '220–264' },
  '120_plus': { kg: '120+', lb: '265+' },
};

export const goalLabels: Record<(typeof fitnessGoals)[number], { label: string; detail: string }> = {
  maintain: { label: 'Maintain', detail: 'Keep things steady and build a routine' },
  lose_weight: { label: 'Lose a little weight', detail: 'A gentle, sustainable change' },
  gain_muscle: { label: 'Gain muscle', detail: 'Strength work with progression' },
  improve_cardio: { label: 'Improve cardio', detail: 'Fitness for everyday energy' },
};

export const placeLabels: Record<(typeof trainingPlaces)[number], string> = {
  home: 'Home',
  gym: 'Gym',
  outdoors: 'Outdoors',
  no_equipment: 'No equipment',
};

export const activityLabels: Record<(typeof activityLevels)[number], string> = {
  mostly_sitting: 'Mostly sitting',
  some_walking: 'Some walking',
  active_job: 'Active job',
  already_training: 'Already training',
};

export const dayOptions = [2, 3, 4, 5, 6] as const;
export const minuteOptions = [20, 30, 45, 60] as const;

const trimNumber = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** What the user told the app, as label/value lines ("From you" on the review, and the AI prompt). */
export function answerLines(d: Draft): { label: string; value: string }[] {
  const lines: { label: string; value: string }[] = [];
  if (d.gender) lines.push({ label: 'Gender', value: genderLabels[d.gender] });
  if (d.ageBand) lines.push({ label: 'Age', value: ageLabels[d.ageBand] });
  if (d.exactWeight !== undefined) lines.push({ label: 'Weight', value: `${trimNumber(d.exactWeight)} ${d.unit}` });
  else if (d.weightBand) lines.push({ label: 'Weight', value: `${weightBandLabels[d.weightBand][d.unit]} ${d.unit} (a range)` });
  if (d.ageBand === 'under_18') return lines;
  if (d.fitnessGoals.length) {
    const primary = d.primaryGoal ?? d.fitnessGoals[0];
    const ordered = [primary, ...d.fitnessGoals.filter((g) => g !== primary)];
    lines.push({ label: 'Goals', value: ordered.map((g, i) => goalLabels[g].label + (i === 0 && ordered.length > 1 ? ' (primary)' : '')).join(', ') });
  }
  if (d.daysPerWeek) lines.push({ label: 'Days per week', value: d.daysPerWeek >= 6 ? '6 or more' : String(d.daysPerWeek) });
  if (d.sessionMinutes) lines.push({ label: 'Time per session', value: d.sessionMinutes >= 60 ? '60 min or more' : `${d.sessionMinutes} min` });
  if (d.trainingPlaces.length) lines.push({ label: 'Where you train', value: d.trainingPlaces.map((p) => placeLabels[p]).join(', ') });
  if (d.activityLevel) lines.push({ label: 'Current activity', value: activityLabels[d.activityLevel] });
  if (d.considerations?.trim()) lines.push({ label: 'To work around', value: d.considerations.trim() });
  return lines;
}
