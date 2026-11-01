import { planSchema, type Plan } from './schema';

export type PlanValidation = { ok: true; plan: Plan } | { ok: false; errors: string[] };

/** Validate a plan package: JSON Schema shape (via zod) plus contract 03 semantic rules. */
export function validatePlan(input: unknown): PlanValidation {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }
  const plan = parsed.data;
  const errors: string[] = [];

  const unique = (what: string, items: { id: string }[]) => {
    const seen = new Set<string>();
    for (const { id } of items) {
      if (seen.has(id)) errors.push(`duplicate ${what} id "${id}"`);
      seen.add(id);
    }
  };
  unique('dayType', plan.dayTypes);
  unique('measurement', plan.measurements);
  unique('goal', plan.goals);
  unique('nutrition target', plan.nutrition.targets);
  unique('activity', plan.activities);
  unique('quickLog', plan.quickLogs);

  const dayTypes = new Set(plan.dayTypes.map((d) => d.id));
  const measurements = new Set(plan.measurements.map((m) => m.id));
  const targets = new Set(plan.nutrition.targets.map((t) => t.id));

  for (const [day, type] of Object.entries(plan.schedule)) {
    if (!dayTypes.has(type)) errors.push(`schedule.${day}: unknown day type "${type}"`);
  }
  const checkAppliesTo = (where: string, a?: { dayTypes: string[] } | { days: string[] }) => {
    if (a && 'dayTypes' in a) a.dayTypes.forEach((t) => dayTypes.has(t) || errors.push(`${where}: unknown day type "${t}"`));
  };

  for (const g of plan.goals) {
    if (!measurements.has(g.measurementId)) errors.push(`goal ${g.id}: unknown measurement "${g.measurementId}"`);
  }
  for (const t of plan.nutrition.targets) {
    checkAppliesTo(`nutrition target ${t.id}`, t.appliesTo);
    if (t.min !== undefined && t.max !== undefined && t.min > t.max) errors.push(`nutrition target ${t.id}: min > max`);
  }
  for (const a of plan.activities) {
    checkAppliesTo(`activity ${a.id}`, a.appliesTo);
    if (a.kind !== 'meal' && (a.nutrition || a.flexible)) errors.push(`activity ${a.id}: nutrition/flexible are for meals only`);
    if (a.flexible && a.nutrition) errors.push(`activity ${a.id}: a flexible meal cannot also have nutrition`);
    for (const key of Object.keys(a.nutrition ?? {})) {
      if (!targets.has(key)) errors.push(`activity ${a.id}: unknown nutrition target "${key}"`);
    }
    if (a.duration && 'min' in a.duration && a.duration.min > a.duration.max) errors.push(`activity ${a.id}: duration min > max`);
  }
  for (const m of plan.measurements) {
    if (m.unitLabel !== undefined && m.quantity !== 'number') errors.push(`measurement ${m.id}: unitLabel is only for quantity "number"`);
  }

  return errors.length ? { ok: false, errors } : { ok: true, plan };
}
