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
    if (a.kind !== 'meal' && (a.ingredients || a.preparation)) errors.push(`activity ${a.id}: ingredients/preparation are for meals only`);
    a.notifications?.forEach((n, i) => {
      if ((n.offsetMinutes === undefined) === (n.at === undefined)) {
        errors.push(`activity ${a.id}: notification ${i + 1} needs exactly one of offsetMinutes or at`);
      } else if (n.offsetMinutes !== undefined && !a.time && (!a.when || a.when === 'anytime')) {
        errors.push(`activity ${a.id}: notification ${i + 1} uses offsetMinutes, but the activity has no time or day part to count from (use "at")`);
      }
    });
    a.ingredients?.forEach((g, i) => {
      if (g.grams === undefined && g.ml === undefined && g.measure === undefined) {
        errors.push(`activity ${a.id}: ingredient ${i + 1} ("${g.name}") needs grams, ml or a measure`);
      }
    });
    for (const key of Object.keys(a.nutrition ?? {})) {
      if (!targets.has(key)) errors.push(`activity ${a.id}: unknown nutrition target "${key}"`);
    }
    if (a.duration && 'min' in a.duration && a.duration.min > a.duration.max) errors.push(`activity ${a.id}: duration min > max`);
  }
  for (const m of plan.measurements) {
    if (m.unitLabel !== undefined && m.quantity !== 'number') errors.push(`measurement ${m.id}: unitLabel is only for quantity "number"`);
  }

  // Prescription rules (contract 08)
  const activityIds = new Set(plan.activities.map((a) => a.id));
  const requirementIds = new Set((plan.requirements ?? []).map((r) => r.id));
  unique('requirement', plan.requirements ?? []);
  for (const r of plan.requirements ?? []) {
    if (activityIds.has(r.id)) errors.push(`requirement ${r.id}: id is also used by an activity`);
    if (r.time && r.when) errors.push(`requirement ${r.id}: use either time or when, not both`);
    if (!plan.activities.some((a) => a.satisfies === r.id)) errors.push(`requirement ${r.id}: no activity satisfies it`);
  }
  for (const a of plan.activities) {
    if (a.time && a.when) errors.push(`activity ${a.id}: use either time or when, not both`);
    if (a.satisfies && !requirementIds.has(a.satisfies)) errors.push(`activity ${a.id}: satisfies unknown requirement "${a.satisfies}"`);
    if (a.satisfies && a.kind === 'meal') errors.push(`activity ${a.id}: meals can't satisfy requirements`);
    for (const dep of a.after ?? []) {
      if (dep === a.id) errors.push(`activity ${a.id}: can't be after itself`);
      else if (!activityIds.has(dep)) errors.push(`activity ${a.id}: after unknown activity "${dep}"`);
    }
    if (a.session?.short && a.session.minutes && a.session.short.minutes && a.session.short.minutes >= a.session.minutes) {
      errors.push(`activity ${a.id}: session.short must be shorter than the session`);
    }
  }
  // `after` must not form a cycle.
  const deps = new Map(plan.activities.map((a) => [a.id, a.after ?? []]));
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string, path: string[]): void => {
    if (done.has(id)) return;
    if (visiting.has(id)) {
      errors.push(`activities: "after" forms a cycle (${[...path, id].join(' → ')})`);
      return;
    }
    visiting.add(id);
    for (const d of deps.get(id) ?? []) if (deps.has(d)) visit(d, [...path, id]);
    visiting.delete(id);
    done.add(id);
  };
  for (const a of plan.activities) visit(a.id, []);

  if (plan.exercise) {
    const ex = plan.exercise;
    const dupes = (what: string, keys: string[]) => {
      const seen = new Set<string>();
      for (const k of keys) {
        if (seen.has(k)) errors.push(`exercise.${what}: "${k}" is listed twice`);
        seen.add(k);
      }
    };
    dupes('limitations', (ex.limitations ?? []).map((l) => l.movement));
    dupes('substitutions', (ex.substitutions ?? []).map((x) => x.instead));
    dupes('activityTypes', (ex.activityTypes ?? []).map((a) => a.id));
    const types = new Set((ex.activityTypes ?? []).map((a) => a.id));
    for (const block of ['strength', 'conditioning'] as const) {
      for (const m of ex[block]?.modalities ?? []) {
        if (!types.has(m)) errors.push(`exercise.${block}.modalities: "${m}" is not one of exercise.activityTypes`);
      }
    }
    for (const sub of ex.substitutions ?? []) {
      if (sub.use.includes(sub.instead)) errors.push(`exercise.substitutions: "${sub.instead}" can't substitute for itself`);
      for (const u of sub.use) {
        if (ex.limitations?.some((l) => l.movement === u && l.status === 'avoid')) {
          errors.push(`exercise.substitutions: "${u}" is suggested for "${sub.instead}" but is itself marked avoid`);
        }
      }
    }
    for (const block of ['strength', 'conditioning'] as const) {
      const r = ex[block]?.sessionMinutes;
      if (r && 'min' in r && r.min > r.max) errors.push(`exercise.${block}.sessionMinutes: min > max`);
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, plan };
}
