import data from '../../presets/exercise-routines.json';
import { equipmentKinds, physicalLimits, type activityLevels, type fitnessGoals, type Weekday } from '../plan/schema';

/**
 * Offline starter exercise plan (#53), from bundled presets. Pure. Based on goals, current activity, equipment,
 * limitations and available days. Gender is not an input: it never changes the plan.
 */
export type StarterGoal = (typeof fitnessGoals)[number];
export const equipmentOptions = equipmentKinds;
export type Equipment = (typeof equipmentKinds)[number];
export const limitationOptions = physicalLimits;
export type Limitation = (typeof physicalLimits)[number];
export type Activity = (typeof activityLevels)[number];

/** The three alternatives on the review ("Option 1 of 3"): the same answers, a different emphasis. */
export const exerciseStyles = [
  { id: 'balanced', label: 'Balanced' },
  { id: 'strength', label: 'More strength' },
  { id: 'cardio', label: 'More cardio' },
] as const;
export type ExerciseStyle = (typeof exerciseStyles)[number]['id'];

export type ExerciseInputs = {
  goals: StarterGoal[];
  activityLevel?: Activity;
  /** What the user has; none = bodyweight only. */
  equipment: Equipment[];
  limitations: Limitation[];
  /** Most training days per week the user wants. */
  daysPerWeek?: number;
  /** Override the strength routine (an equipment level the user has). */
  routineId?: string;
  style?: ExerciseStyle;
};

type Routine = (typeof data.strength)[number];
export const routines: Routine[] = data.strength;

/** Strength routines that fit the equipment, best first (gym, weights, bands, none). None always fits. */
export function routineOptions(equipment: Equipment[]): Routine[] {
  const rank: Equipment[] = ['gym', 'weights', 'bands', 'none'];
  return rank.filter((e) => e === 'none' || equipment.includes(e)).map((e) => routines.find((r) => r.id === e)!);
}

const STRENGTH_DAYS: Record<number, Weekday[]> = { 1: ['wed'], 2: ['mon', 'thu'], 3: ['mon', 'wed', 'fri'] };
const OTHER_DAYS: Weekday[] = ['tue', 'sat', 'thu', 'sun', 'wed', 'fri', 'mon'];

export type ExerciseStarter = {
  routine: Routine;
  activities: Record<string, unknown>[];
  exercise: Record<string, unknown>;
  /** Training days used (strength or cardio). */
  days: Weekday[];
};

export function exerciseStarter(inputs: ExerciseInputs): ExerciseStarter {
  const g = new Set(inputs.goals);
  const level = inputs.activityLevel ?? 'some_walking';
  const options = routineOptions(inputs.equipment);
  const routine = options.find((r) => r.id === inputs.routineId) ?? options[0];

  // How much of each: gentle for people starting from little activity.
  let strength = level === 'active_job' || level === 'already_training' ? 3 : 2;
  if (g.has('gain_muscle')) strength = 3;
  let cardio = 2;
  if (g.has('improve_cardio')) cardio = Math.max(cardio, 3);
  if (g.has('faster_loss')) cardio += 1; // more activity, never a bigger food cut
  if (g.size === 1 && g.has('gain_muscle')) cardio = 2;
  if (inputs.style === 'strength') {
    strength = 3;
    cardio = 1;
  } else if (inputs.style === 'cardio') {
    strength = Math.min(strength, 2);
    cardio += 1;
  }
  // "More strength" trades the long weekend walk for a short weekday one; "More cardio" for intervals.
  const longWalk = inputs.style !== 'strength' && inputs.style !== 'cardio' && (g.has('gradual_loss') || g.has('faster_loss') || g.has('maintain'));

  // Fit within the days available: drop cardio days first, then the long walk; keep the strength days.
  // At most 6 training days: one day always stays for rest.
  const cap = Math.min(6, Math.max(1, inputs.daysPerWeek ?? 6));
  // Each option sizes its strength days to the days available, so the three options stay different.
  if (inputs.style === 'strength') strength = Math.min(3, cap);
  else if (inputs.style === 'cardio') strength = Math.min(2, Math.max(1, Math.floor(cap / 3)));
  else strength = Math.min(strength, Math.max(1, Math.floor(cap / 2)));
  const strengthDays = STRENGTH_DAYS[Math.min(strength, cap, 3)];
  const free = OTHER_DAYS.filter((d) => !strengthDays.includes(d));
  let longDay: Weekday | null = longWalk ? 'sat' : null;
  const cardioDays = free.filter((d) => d !== longDay).slice(0, cardio);
  const total = () => strengthDays.length + cardioDays.length + (longDay ? 1 : 0);
  while (total() > cap && cardioDays.length) cardioDays.pop();
  if (total() > cap) longDay = null;
  const used = new Set<Weekday>([...strengthDays, ...cardioDays, ...(longDay ? [longDay] : [])]);
  const finalCardio = cardioDays;
  const restDay = (['sun', 'sat', 'fri'] as Weekday[]).find((d) => !used.has(d));

  const cardioPreset = inputs.style === 'cardio' ? data.cardio.intervals : g.has('improve_cardio') || level === 'active_job' || level === 'already_training' ? data.cardio.steady : data.cardio.walk;
  const activities: Record<string, unknown>[] = [
    {
      id: 'strength',
      kind: 'exercise',
      label: routine.label,
      detail: `${routine.detail} · add a set or a few reps when it feels easy`,
      when: 'evening',
      duration: { minutes: routine.session.minutes },
      purpose: 'strength',
      appliesTo: { days: strengthDays },
      session: routine.session,
    },
  ];
  if (finalCardio.length) {
    activities.push({
      id: cardioPreset === data.cardio.walk ? 'walk' : 'cardio',
      kind: 'exercise',
      label: cardioPreset.label,
      detail: cardioPreset.detail,
      when: 'morning',
      duration: { minutes: cardioPreset.minutes },
      purpose: cardioPreset === data.cardio.walk ? 'walking' : 'conditioning_low_intensity',
      appliesTo: { days: finalCardio },
    });
  }
  if (longDay) {
    activities.push({ id: 'long-walk', kind: 'exercise', label: data.cardio.longWalk.label, detail: data.cardio.longWalk.detail, when: 'morning', duration: { minutes: data.cardio.longWalk.minutes }, purpose: 'walking', appliesTo: { days: [longDay] } });
  }
  if (restDay) {
    activities.push({ id: 'stretch', kind: 'exercise', label: data.cardio.stretch.label, detail: data.cardio.stretch.detail, when: 'evening', duration: { minutes: data.cardio.stretch.minutes }, purpose: 'recovery', required: false, appliesTo: { days: [restDay] } });
  }

  const lims = inputs.limitations.map((l) => data.limitations[l]);
  const exerciseGoals = [
    ...(g.has('gradual_loss') || g.has('faster_loss') ? ['weight_loss'] : []),
    ...(g.has('gain_muscle') ? ['muscle_gain'] : []),
    ...(g.has('improve_cardio') ? ['fitness'] : []),
    ...(g.has('maintain') ? ['health'] : []),
  ];
  const exercise: Record<string, unknown> = {
    ...(exerciseGoals.length ? { goals: exerciseGoals } : {}),
    ...(lims.length
      ? {
          limitations: [...new Map(lims.flatMap((l) => l.avoid.map((m) => [m, { movement: m, status: 'avoid', reason: l.reason }]))).values()],
          substitutions: [...new Map(lims.flatMap((l) => l.substitutions).map((s) => [s.instead, s])).values()],
        }
      : {}),
    constraints: { location: routine.id === 'gym' ? 'gym' : 'home' },
  };
  return { routine, activities, exercise, days: [...used] };
}
