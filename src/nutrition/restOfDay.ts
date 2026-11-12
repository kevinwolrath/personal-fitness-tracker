import { convertEnergy, formatEnergy, type EnergyDisplay } from '../energy';
import type { Observation } from '../observations/types';
import type { Plan } from '../plan/schema';
import type { PrescriptionItem } from '../prescription/prescribe';
import type { MealLog } from './contract';
import type { ConfirmedMeal } from './plannedMeals';
import { dayIntake } from './intake';

/**
 * "Rest of today" (#99): optional suggestions after a logged meal, from what was actually eaten (#97), the meals
 * still planned, the day's targets, the time and the day's activity. Pure and deterministic; no AI.
 *
 * Rules (contract 15, "Rest of today"):
 * 1. Shown only on today, and only once a meal has been logged.
 * 2. A flexible meal still to come (dinner) keeps 1,500 kJ of room. Eaten = the day's actual intake (`dayIntake`: logged meals, or a day total from elsewhere, never both). Planned
 *    meals still to come add their planned nutrition; meals without numbers make the projection uncertain.
 * 3. "Keep the plan" is always the first option. Within or under the target, it's the only food suggestion.
 * 4. Over the energy target: an optional smaller or skipped snack only if protein would still reach its minimum;
 *    otherwise keep the snack for protein. A remaining dinner is never skipped: "smaller, protein-rich" instead.
 * 5. Protein short: a protein-rich dinner, and keep a protein snack.
 * 6. Activity: only when over, before 7:30 pm, not a rest day, no injury, weight known. A walk, given as a range
 *    for the user's weight, marked as an estimate, and never as "earning" food. A planned workout still to do is
 *    pointed to instead of extra exercise.
 * 7. Late (after the eating window or 8 pm): nothing to change today.
 * 8. Missing targets or unknown intake: limited guidance, no numbers invented.
 */

export type Suggestion = { id: string; kind: 'keep' | 'snack' | 'dinner' | 'protein' | 'activity' | 'late'; title: string; detail: string | null };

export type RestOfDay = {
  show: boolean;
  status: 'within' | 'over' | 'under' | 'unknown';
  headline: string;
  suggestions: Suggestion[];
  /** Plain explanation lines for the expandable part. */
  explanation: string[];
  uncertain: boolean;
};

export type RestOfDayInput = {
  plan: Plan;
  date: string;
  today: string;
  /** Local minutes since midnight. */
  nowMinutes: number;
  items: PrescriptionItem[];
  mealLogs: MealLog[];
  /** Ticked planned meals, counted as eaten at their planned estimates (#154). */
  confirmed?: ConfirmedMeal[];
  observations: Observation[];
  energy: EnergyDisplay;
  /** Latest body weight in kg, for activity estimates. */
  weightKg: number | null;
  restDay: boolean;
  injured: boolean;
};

const OVER_MARGIN = 0.05;
const ACTIVITY_MIN_OVER_KJ = 400;
/** Room kept for a flexible meal still to come (a modest dinner), so it's never planned down to nothing. */
const DINNER_RESERVE_KJ = 1500;
const KCAL_KJ = 4.184;

const hidden: RestOfDay = { show: false, status: 'unknown', headline: '', suggestions: [], explanation: [], uncertain: true };

export function restOfDay(i: RestOfDayInput): RestOfDay {
  if (i.date !== i.today || !i.mealLogs.some((m) => m.date === i.date)) return hidden;
  const { plan } = i;
  const fmtE = (kj: number) => formatEnergy(kj, 'kJ', i.energy);
  const toKj = (v: number) => convertEnergy(v, plan.units.energy, 'kJ');
  const energyT = plan.nutrition.targets.find((t) => t.quantity === 'energy');
  const proteinT = plan.nutrition.targets.find((t) => t.quantity === 'grams' && /protein/i.test(`${t.id} ${t.label}`));
  const intake = dayIntake(i.date, i.mealLogs, i.observations, i.confirmed ?? []);
  const eatenKj = intake.values.energyKj?.value ?? null;
  const eatenP = intake.values.proteinG?.value ?? null;

  // Meals still to come today: scheduled meals not done or skipped (a replaced meal is done).
  const remaining = i.items.filter((it) => it.kind === 'activity' && it.activity?.kind === 'meal' && (it.state === 'pending' || it.state === 'partial'));
  const known = (it: PrescriptionItem, id?: string) => (id ? it.activity!.nutrition?.[id] : undefined);
  const flexible = remaining.find((it) => it.activity!.flexible);
  const fixed = remaining.filter((it) => !it.activity!.flexible);
  const plannedKj = fixed.reduce((s, it) => s + (energyT && known(it, energyT.id) !== undefined ? toKj(known(it, energyT.id)!) : 0), 0);
  const plannedP = fixed.reduce((s, it) => s + (proteinT ? known(it, proteinT.id) ?? 0 : 0), 0);
  const unknownMeals = fixed.filter((it) => (energyT && known(it, energyT.id) === undefined)).map((it) => it.label);
  const uncertain = !!intake.values.energyKj?.incomplete || unknownMeals.length > 0 || !!flexible;

  const keep: Suggestion = { id: 'keep', kind: 'keep', title: 'Keep the plan', detail: 'Often the best choice: one bigger meal doesn’t need making up for.' };
  const late = i.nowMinutes >= Math.min(20 * 60, plan.nutrition.eatingWindow ? toMin(plan.nutrition.eatingWindow.end) : 24 * 60);
  if (late) {
    return { show: true, status: 'unknown', headline: 'Nothing to change today', suggestions: [{ id: 'late', kind: 'late', title: 'Nothing to change today', detail: 'Tomorrow is a fresh day. Don’t make up for today by eating less tomorrow.' }], explanation: [], uncertain };
  }
  if (!energyT?.max || eatenKj === null) {
    return {
      show: true,
      status: 'unknown',
      headline: 'Keep the plan',
      suggestions: [keep],
      explanation: [!energyT?.max ? 'Your plan has no energy limit, so there’s nothing to compare with.' : 'Today’s food has no energy numbers yet, so suggestions would be guesses.'],
      uncertain: true,
    };
  }

  const maxKj = toKj(energyT.max);
  const projected = eatenKj + plannedKj;
  const projectedP = eatenP === null ? null : eatenP + plannedP;
  const reserve = flexible ? DINNER_RESERVE_KJ : 0;
  const over = projected + reserve - maxKj;
  const status: RestOfDay['status'] = over > maxKj * OVER_MARGIN ? 'over' : !flexible && over < -maxKj * 0.25 ? 'under' : 'within';
  const proteinShort = proteinT?.min !== undefined && projectedP !== null ? Math.max(0, proteinT.min - projectedP) : 0;

  const explanation = [
    `Eaten so far ≈ ${fmtE(eatenKj)}${eatenP !== null ? ` · ${Math.round(eatenP)} g protein` : ''}${intake.values.energyKj?.incomplete ? ' (some foods unknown)' : ''}.`,
    fixed.length ? `Still planned: ${fixed.map((it) => it.label).join(', ')}${plannedKj ? ` (≈ ${fmtE(plannedKj)}${plannedP ? ` · ${Math.round(plannedP)} g protein` : ''})` : ''}${flexible ? `, and ${flexible.label}` : ''}.` : flexible ? `Still planned: ${flexible.label}.` : 'No more planned meals today.',
    ...(flexible ? [`About ${fmtE(DINNER_RESERVE_KJ)} is kept for ${flexible.label}, so it’s never planned down to nothing.`] : []),
    `Your limit is ${fmtE(maxKj)}${proteinT?.min ? `; protein at least ${proteinT.min} g` : ''}.`,
    ...(unknownMeals.length ? [`${unknownMeals.join(', ')} ${unknownMeals.length === 1 ? 'has' : 'have'} no numbers in your plan, so this is approximate.`] : []),
    'These are estimates. Skipping a protein snack lowers both energy and protein.',
  ];

  const suggestions: Suggestion[] = [keep];
  const snack = fixed.find((it) => energyT && known(it, energyT.id) !== undefined && (it.window.at >= i.nowMinutes || it.window.part === 'anytime' || it.window.end >= i.nowMinutes));
  if (status === 'over') {
    if (snack) {
      const sKj = toKj(known(snack, energyT.id)!);
      const sP = proteinT ? known(snack, proteinT.id) ?? 0 : 0;
      const pWithout = projectedP === null ? null : projectedP - sP;
      if (proteinT?.min === undefined || (pWithout !== null && pWithout >= proteinT.min)) {
        suggestions.push({ id: 'snack', kind: 'snack', title: `Optional: halve or skip ${snack.label}`, detail: `Saves ≈ ${fmtE(sKj)}${sP ? `; protein would still reach about ${Math.round(pWithout!)} g` : ''}.` });
      } else {
        suggestions.push({ id: 'snack', kind: 'snack', title: `Keep ${snack.label}`, detail: `It brings ${Math.round(sP)} g protein you’d otherwise miss. If anything changes, make it a smaller dinner.` });
      }
    }
    if (flexible) {
      const left = maxKj - projected;
      suggestions.push({
        id: 'dinner',
        kind: 'dinner',
        title: `Optional: a smaller, protein-rich ${flexible.label.toLowerCase()}`,
        detail: left > 1500 ? `About ${fmtE(Math.round(left / 10) * 10)} would keep you near your limit.` : 'Lean protein and vegetables, with a smaller starchy side. Don’t skip it.',
      });
    }
  } else if (flexible && status === 'within') {
    const left = maxKj - projected;
    if (left > 0) suggestions.push({ id: 'dinner', kind: 'dinner', title: `${flexible.label}: about ${fmtE(Math.round(left / 10) * 10)} left`, detail: 'An estimate from what’s logged and planned.' });
  }
  if (proteinShort >= 10) {
    suggestions.push({ id: 'protein', kind: 'protein', title: 'Make protein a priority', detail: `About ${Math.round(proteinShort)} g short of your minimum: a protein-rich ${flexible ? flexible.label.toLowerCase() : 'meal'}${snack ? `, and keep ${snack.label}` : ''}.` });
  }

  // Activity: optional, only when over, and never as compensation or "earning" food.
  if (status === 'over' && over > ACTIVITY_MIN_OVER_KJ && !i.restDay && !i.injured && i.nowMinutes < 19 * 60 + 30) {
    const plannedWorkout = i.items.find((it) => (it.session || it.purpose === 'strength' || it.purpose === 'conditioning_high_intensity') && (it.state === 'pending' || it.state === 'partial'));
    if (plannedWorkout) {
      suggestions.push({ id: 'activity', kind: 'activity', title: `Your ${plannedWorkout.label.toLowerCase()} is still planned`, detail: 'Doing it as planned is enough; there’s no need for extra exercise.' });
    } else if (i.weightKg) {
      // Brisk walking ≈ 3.5–4.3 MET; kcal = MET × kg × hours. A range, not a measurement.
      const lo = Math.round((3.5 * i.weightKg * 0.5 * KCAL_KJ) / 10) * 10;
      const hi = Math.round((4.3 * i.weightKg * 0.5 * KCAL_KJ) / 10) * 10;
      suggestions.push({ id: 'activity', kind: 'activity', title: 'Optional: a 30-minute brisk walk', detail: `Roughly ${fmtE(lo)}–${fmtE(hi)} for your weight, an estimate. It doesn’t “earn” food back.` });
    }
  }

  const headline =
    status === 'over' ? `About ${fmtE(Math.round(over / 10) * 10)} over your limit if you eat as planned` : status === 'under' ? 'Under your limit: keep the plan' : 'On track: keep the plan';
  return { show: true, status, headline, suggestions, explanation, uncertain };
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
