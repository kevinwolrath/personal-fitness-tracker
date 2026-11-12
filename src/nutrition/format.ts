import { formatEnergy, type EnergyDisplay } from '../energy';
import type { MealLog, Nutrients } from './contract';
import type { DayIntake } from './intake';
import { mealTotals } from './totals';

/**
 * How eaten amounts read (#97). Pure. Estimates are rounded (energy to the display step, grams to whole numbers)
 * and marked "≈": no false precision. Unknown is "—", never 0.
 */

const g = (n: number) => `${Math.round(n)} g`;

/** "≈ 2,950 kJ · 38 g protein", or with carbs and fat when `full`. Unknown parts are left out. */
export function formatNutrients(n: Nutrients, energy: EnergyDisplay, full = false): string | null {
  const parts = [
    n.energyKj !== null ? formatEnergy(n.energyKj, 'kJ', energy) : null,
    n.proteinG !== null ? `${g(n.proteinG)} protein` : null,
    ...(full ? [n.carbsG !== null ? `${g(n.carbsG)} carbs` : null, n.fatG !== null ? `${g(n.fatG)} fat` : null] : []),
  ].filter(Boolean);
  return parts.length ? `≈ ${parts.join(' · ')}` : null;
}

export function mealSummary(m: MealLog, energy: EnergyDisplay, full = false): string | null {
  const t = mealTotals(m.items);
  const text = formatNutrients(t, energy, full);
  const unknown = Math.max(...Object.values(t.unknown));
  return text && unknown > 0 ? `${text} (some foods unknown)` : text;
}

export const sourceTag = (m: MealLog) => (m.source === 'photo-ai' ? (m.photos.length ? 'Photo estimate' : 'AI estimate') : 'Entered by you');

/**
 * The Daily Log's "Eaten" line: what was eaten that day (logged meals, and ticked plan meals at their planned
 * estimates, #154), with where it came from. Null when nothing is known. Says when a day total is used instead of the meals, so nothing looks double counted.
 */
export function intakeLines(d: DayIntake, energy: EnergyDisplay): { main: string; note: string } | null {
  const v = d.values;
  const main = formatNutrients(
    { energyKj: v.energyKj?.value ?? null, proteinG: v.proteinG?.value ?? null, carbsG: v.carbsG?.value ?? null, fatG: v.fatG?.value ?? null },
    energy,
    true,
  );
  const n = d.meals.length;
  const t = d.confirmed.length;
  // #154: ticked plan meals with no planned values: say so rather than show nothing (or a zero).
  if (!main) return t ? { main: 'Eaten: not known yet', note: `${t} ticked meal${t === 1 ? '' : 's'} with no planned energy or protein` } : null;
  const notes = [
    n ? `from ${n} logged meal${n === 1 ? '' : 's'}` : null,
    t ? `${n ? '' : 'from '}${t} ticked meal${t === 1 ? '' : 's'} at plan estimates` : null,
    d.overridden.length ? `${d.overridden.map((k) => (k === 'energyKj' ? 'energy' : 'protein')).join(' and ')} from your day total, not added to the meals` : !n && !t ? 'your day total' : null,
    Object.values(v).some((x) => x?.incomplete) ? (t ? 'some values unknown, so it may be low' : 'some foods unknown, so it may be low') : null,
  ].filter(Boolean);
  return { main: `Eaten ${main}`, note: notes.join(' · ') };
}
