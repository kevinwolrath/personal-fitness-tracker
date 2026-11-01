import { describeItem, describeLimitation } from './diff';
import { readConfig, sectionNames, sections, type RawPlan, type SectionName } from './sections';

export type SectionSummary = { section: SectionName; title: string; lines: string[] };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Inspectable, read-only summary of the current configuration (no settings UI). Pure. */
export function summarizeConfig(raw: RawPlan): SectionSummary[] {
  const c = readConfig(raw) as Record<SectionName, Record<string, any>>;
  const out: Record<SectionName, string[]> = {
    profile: [
      c.profile.units ? `Units: ${c.profile.units.mass}, ${c.profile.units.energy}, ${c.profile.units.length}` : null,
      c.profile.displayName ? `Name: ${c.profile.displayName}` : null,
      c.profile.heightCm ? `Height: ${c.profile.heightCm} cm` : null,
      ...(c.profile.notes ?? []),
    ].filter(Boolean) as string[],
    goals: (c.goals.targets ?? []).map((g: any) => describeItem('goals.targets', g)),
    nutrition: [
      ...(c.nutrition.targets ?? []).map((t: any) => describeItem('nutrition.targets', t)),
      c.nutrition.eatingWindow ? `Eating ${c.nutrition.eatingWindow.start}–${c.nutrition.eatingWindow.end}` : null,
      c.nutrition.meals?.length ? `Meals: ${c.nutrition.meals.map((m: any) => m.label).join(', ')}` : null,
    ].filter(Boolean) as string[],
    exercise: [
      c.exercise.goals?.length ? `Goals: ${c.exercise.goals.map((g: string) => g.replace(/_/g, ' ')).join(', ')}` : null,
      c.exercise.equipment?.length ? `Equipment: ${c.exercise.equipment.map((e: any) => describeItem('exercise.equipment', e)).join(', ')}` : null,
      ...(c.exercise.limitations ?? []).map(describeLimitation),
      ...(c.exercise.substitutions ?? []).map((x: any) => describeItem('exercise.substitutions', x)),
      c.exercise.activityTypes?.length ? `Training: ${c.exercise.activityTypes.map((a: any) => a.label).join(', ')}` : null,
      c.exercise.strength?.sessionsPerWeek !== undefined ? `Strength: ${c.exercise.strength.sessionsPerWeek}× a week` : null,
      c.exercise.conditioning?.sessionsPerWeek !== undefined ? `Conditioning: ${c.exercise.conditioning.sessionsPerWeek}× a week` : null,
      ...(c.exercise.constraints?.notes ?? []),
    ].filter(Boolean) as string[],
    schedule: [
      c.schedule.dayTypes?.length ? `Day types: ${c.schedule.dayTypes.map((d: any) => d.label).join(', ')}` : null,
      c.schedule.activities ? plural(c.schedule.activities.length, 'scheduled activity', 'scheduled activities') : null,
    ].filter(Boolean) as string[],
    tracking: [
      c.tracking.measurements?.length ? `Measure: ${c.tracking.measurements.map((m: any) => m.label).join(', ')}` : null,
      c.tracking.quickLogs?.length ? `Quick log: ${c.tracking.quickLogs.map((q: any) => q.label).join(', ')}` : null,
    ].filter(Boolean) as string[],
  };
  return sectionNames.map((s) => ({ section: s, title: sections[s].title, lines: out[s].length ? out[s] : ['Not set up yet'] }));
}
