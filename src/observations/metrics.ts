/**
 * Canonical metric catalog (contract 06). External sources map *into* these ids;
 * no provider's schema is the model. Values are stored in the canonical unit.
 */
export type Dimension =
  | 'mass'
  | 'mass_change'
  | 'length'
  | 'distance'
  | 'energy'
  | 'duration'
  | 'count'
  | 'score'
  | 'percent'
  | 'rate'
  | 'grams';

export const canonicalUnit: Record<Dimension, string> = {
  mass: 'kg',
  mass_change: 'kg',
  length: 'cm',
  distance: 'km',
  energy: 'kJ',
  duration: 'min',
  count: 'count',
  score: 'score',
  percent: '%',
  rate: 'bpm',
  grams: 'g',
};

export type MetricDef = { id: string; label: string; dimension: Dimension; decimals: number; hint: string };

export const metrics = [
  { id: 'weight', label: 'Weight', dimension: 'mass', decimals: 2, hint: 'Body weight' },
  { id: 'weight_change', label: 'Weight change', dimension: 'mass_change', decimals: 2, hint: 'Change shown by the app, negative for loss' },
  { id: 'body_fat', label: 'Body fat', dimension: 'percent', decimals: 1, hint: 'Body fat percentage' },
  { id: 'waist', label: 'Waist', dimension: 'length', decimals: 1, hint: 'Waist circumference' },
  { id: 'steps', label: 'Steps', dimension: 'count', decimals: 0, hint: 'Step count for the day' },
  { id: 'distance', label: 'Distance', dimension: 'distance', decimals: 2, hint: 'Distance walked/run for the day' },
  { id: 'floors', label: 'Floors', dimension: 'count', decimals: 0, hint: 'Floors climbed' },
  { id: 'active_minutes', label: 'Active minutes', dimension: 'duration', decimals: 0, hint: 'Active / zone minutes' },
  { id: 'active_energy', label: 'Active energy', dimension: 'energy', decimals: 0, hint: 'Activity calories burned' },
  { id: 'total_energy', label: 'Energy burned', dimension: 'energy', decimals: 0, hint: 'Total calories burned' },
  { id: 'energy_intake', label: 'Energy eaten', dimension: 'energy', decimals: 0, hint: 'Food calories logged' },
  { id: 'protein_intake', label: 'Protein eaten', dimension: 'grams', decimals: 0, hint: 'Protein logged' },
  { id: 'sleep_duration', label: 'Sleep', dimension: 'duration', decimals: 0, hint: 'Time asleep' },
  { id: 'sleep_score', label: 'Sleep score', dimension: 'score', decimals: 0, hint: 'Sleep score' },
  { id: 'readiness_score', label: 'Readiness', dimension: 'score', decimals: 0, hint: 'Readiness / recovery / body battery style score' },
  { id: 'cardio_score', label: 'Cardio score', dimension: 'score', decimals: 0, hint: 'Cardio fitness / cardio load / activity score' },
  { id: 'resting_heart_rate', label: 'Resting heart rate', dimension: 'rate', decimals: 0, hint: 'Resting heart rate' },
  { id: 'exercise_session', label: 'Workout', dimension: 'duration', decimals: 0, hint: 'One workout/exercise session; value is its duration, label is the exercise type' },
] as const satisfies readonly MetricDef[];

export type MetricId = (typeof metrics)[number]['id'];
export const metricIds = metrics.map((m) => m.id) as [MetricId, ...MetricId[]];

export function metricDef(id: string): MetricDef | undefined {
  return (metrics as readonly MetricDef[]).find((m) => m.id === id);
}
