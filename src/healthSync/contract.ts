/**
 * The Worker's snapshot v2 contract (#181), checked on the phone before anything is sent. A mirror of questspirestudio
 * worker/export.mjs `validateExport`: the same keys, patterns, limits and enums. When something doesn't fit, it names
 * the record (its list, position and date) and the field, never the value, so the problem can be found and fixed
 * without guessing. Pure.
 */

export type ContractProblem = { section: string; index: number | null; date: string | null; field: string; rule: string };

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(Date.parse(v)).toISOString().slice(0, 10) === v;
const isStamp = (v: unknown) => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v));
const hasControl = (v: string) => [...v].some((c) => c.charCodeAt(0) < 32);
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9;

/** One field's rule: a check and how to say it. */
type Rule = [field: string, ok: (v: any) => boolean, rule: string];
const text = (max: number, nullable = false) => (v: unknown) => (nullable && v === null) || (typeof v === 'string' && v.length <= max && !hasControl(v));
const textRule = (field: string, max: number, nullable = false): Rule => [field, (o) => text(max, nullable)(o[field]), `text of at most ${max} characters, no line breaks${nullable ? ', or empty' : ''}`];
const numRule = (field: string, nullable = false): Rule => [field, (o) => (nullable && o[field] === null) || num(o[field]), nullable ? 'a number or empty' : 'a number'];
const intRule = (field: string): Rule => [field, (o) => o[field] === null || (Number.isInteger(o[field]) && o[field] >= 0 && o[field] <= 1e6), 'a whole number from 0 to 1,000,000, or empty'];
const oneOf = (field: string, values: unknown[]): Rule => [field, (o) => values.includes(o[field]), `one of ${values.map((x) => JSON.stringify(x)).join(', ')}`];
const ID = /^[A-Za-z0-9._:-]{1,80}$/;
const idRule = (field: string): Rule => [field, (o) => typeof o[field] === 'string' && ID.test(o[field]), 'an id of 1–80 letters, digits or . _ : -'];
const dateRule = (field: string): Rule => [field, (o) => isDate(o[field]), 'a date (YYYY-MM-DD)'];
const stampRule = (field: string): Rule => [field, (o) => isStamp(o[field]), 'a date and time'];
const keysRule = (keys: string[]): Rule => ['(fields)', (o) => isObj(o) && keys.every((k) => Object.hasOwn(o, k)) && Object.keys(o).every((k) => keys.includes(k)), `exactly the fields ${keys.join(', ')}`];

/** Plan measurement ids are kebab-case (`resting-hr`); built-in metrics are snake_case (`sleep_duration`). */
export const METRIC = /^[a-z0-9_-]{1,40}$/;
const MOVEMENT = /^[a-z0-9_]{1,60}$/;

const measurement: Rule[] = [
  keysRule(['id', 'date', 'recordedAt', 'metric', 'value', 'unit', 'source']),
  idRule('id'), dateRule('date'), stampRule('recordedAt'),
  ['metric', (o) => typeof o.metric === 'string' && METRIC.test(o.metric), 'a metric name of 1–40 lowercase letters, digits, _ or -'],
  numRule('value'), textRule('unit', 16),
  ['source', (o) => isObj(o.source) && ['type', 'app', 'edited'].every((k) => Object.hasOwn(o.source, k)) && Object.keys(o.source).length === 3, 'exactly the fields type, app, edited'],
  ['source.type', (o) => ['manual', 'screenshot', 'healthConnect'].includes(o.source.type), 'one of "manual", "screenshot", "healthConnect"'],
  ['source.app', (o) => text(60, true)(o.source.app), 'text of at most 60 characters, or empty'],
  ['source.edited', (o) => typeof o.source.edited === 'boolean', 'true or false'],
];
const planned: Rule[] = [
  keysRule(['activityId', 'label', 'status', 'plannedEnergyKj', 'plannedProteinG']),
  idRule('activityId'), textRule('label', 80), oneOf('status', ['eaten (ticked)', 'replaced', 'skipped', 'not ticked']),
  numRule('plannedEnergyKj', true), numRule('plannedProteinG', true),
];
const logged: Rule[] = [
  keysRule(['id', 'at', 'name', 'replaces', 'energyKj', 'proteinG', 'carbsG', 'fatG', 'complete', 'source']),
  idRule('id'), stampRule('at'), textRule('name', 120), textRule('replaces', 80, true),
  numRule('energyKj', true), numRule('proteinG', true), numRule('carbsG', true), numRule('fatG', true),
  ['complete', (o) => typeof o.complete === 'boolean', 'true or false'], oneOf('source', ['photo-ai', 'manual']),
];
const foodDay: Rule[] = [
  keysRule(['date', 'status', 'eaten', 'plannedMeals', 'loggedMeals']),
  dateRule('date'), oneOf('status', ['complete', 'partial', 'missing', 'in progress']),
  ['eaten', (o) => isObj(o.eaten) && ['energyKj', 'proteinG', 'carbsG', 'fatG'].every((k) => o.eaten[k] === null || num(o.eaten[k])) && ['meals', 'day-total', null].includes(o.eaten.from) && Object.keys(o.eaten).length === 5, 'the eaten totals (numbers or empty) and where they came from'],
  ['plannedMeals', (o) => Array.isArray(o.plannedMeals) && o.plannedMeals.length <= 20, 'at most 20 planned meals'],
  ['loggedMeals', (o) => Array.isArray(o.loggedMeals) && o.loggedMeals.length <= 30, 'at most 30 logged meals'],
];
const session: Rule[] = [
  keysRule(['date', 'activityId', 'label', 'status', 'variant', 'exercisesDone']),
  dateRule('date'), idRule('activityId'), textRule('label', 80), oneOf('status', ['done', 'skipped', 'partial']), oneOf('variant', ['full', 'short']),
  ['exercisesDone', (o) => Array.isArray(o.exercisesDone) && o.exercisesDone.length <= 60 && o.exercisesDone.every(text(80)), 'at most 60 names of at most 80 characters'],
];
const exercise: Rule[] = [
  keysRule(['id', 'date', 'movement', 'sets', 'reps', 'seconds', 'loadKg', 'rir', 'routine', 'status']),
  idRule('id'), dateRule('date'),
  ['movement', (o) => typeof o.movement === 'string' && MOVEMENT.test(o.movement), 'a movement name of 1–60 lowercase letters, digits or _'],
  intRule('sets'), intRule('reps'), intRule('seconds'), numRule('loadKg', true), numRule('rir', true), textRule('routine', 40, true), oneOf('status', ['done', 'skipped']),
];

function firstFailure(item: unknown, rules: Rule[]): Rule | null {
  for (const r of rules) {
    try {
      if (!r[1](item)) return r;
    } catch {
      return r;
    }
  }
  return null;
}
const dateOf = (item: unknown) => (isObj(item) && typeof item.date === 'string' ? item.date.slice(0, 10) : null);

function checkList(section: string, list: unknown, max: number, rules: Rule[], nested?: (item: any, i: number) => ContractProblem | null): ContractProblem | null {
  if (!Array.isArray(list) || list.length > max) return { section, index: null, date: null, field: '(list)', rule: `a list of at most ${max.toLocaleString('en-AU')}` };
  for (let i = 0; i < list.length; i++) {
    const r = firstFailure(list[i], rules);
    if (r) return { section, index: i, date: dateOf(list[i]), field: r[0], rule: r[2] };
    const n = nested?.(list[i], i);
    if (n) return n;
  }
  return null;
}

/** The first thing in a snapshot that the server's contract rejects, or null when it all fits. */
export function contractProblem(v: any): ContractProblem | null {
  const env = (field: string, rule: string): ContractProblem => ({ section: 'envelope', index: null, date: null, field, rule });
  if (!isObj(v)) return env('(snapshot)', 'an object');
  if (v.schemaVersion !== 2 || v.format !== 'body-anvil-ai-export' || v.version !== 2) return env('schemaVersion', 'version 2 of body-anvil-ai-export');
  if (typeof v.appVersion !== 'string' || !/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(v.appVersion)) return env('appVersion', 'a version like 1.2.3');
  if (!isStamp(v.generatedAt)) return env('generatedAt', 'a date and time');
  if (!text(64)(v.timezone)) return env('timezone', 'text of at most 64 characters');
  if (!isDate(v.asOf)) return env('asOf', 'a date (YYYY-MM-DD)');
  if (!Array.isArray(v.readMe) || v.readMe.length > 12 || !v.readMe.every(text(400))) return env('readMe', 'at most 12 lines of at most 400 characters');
  const measurements = checkList('measurements', v.measurements, 15_000, measurement);
  if (measurements) return measurements;
  const food = checkList('food', v.food, 3_660, foodDay, (day, i) => {
    const where = (sub: string, j: number, r: Rule): ContractProblem => ({ section: `food[${i}].${sub}`, index: j, date: dateOf(day), field: r[0], rule: r[2] });
    for (let j = 0; j < day.plannedMeals.length; j++) { const r = firstFailure(day.plannedMeals[j], planned); if (r) return where('plannedMeals', j, r); }
    for (let j = 0; j < day.loggedMeals.length; j++) { const r = firstFailure(day.loggedMeals[j], logged); if (r) return where('loggedMeals', j, r); }
    return null;
  });
  if (food) return food;
  if (!isObj(v.training)) return env('training', 'sessions and exercises');
  const sessions = checkList('training.sessions', v.training.sessions, 15_000, session);
  if (sessions) return sessions;
  const exercises = checkList('training.exercises', v.training.exercises, 15_000, exercise);
  if (exercises) return exercises;
  const all = v as any;
  const late = [...all.measurements, ...all.food, ...all.training.sessions, ...all.training.exercises].findIndex((x: any) => x.date > all.asOf);
  if (late !== -1) return env('asOf', 'no record after the export date');
  return null;
}

const sectionNames: Record<string, string> = { measurements: 'a measurement', food: 'a food day', 'training.sessions': 'a workout', 'training.exercises': 'an exercise log' };

/** "A measurement on 13 Nov 2026 (measurements[12]): metric must be …". Names the record and field, never the value. */
export function describeProblem(p: ContractProblem): string {
  const base = p.section.replace(/\[\d+\]\..*$/, '');
  const what = p.section.includes('loggedMeals') ? 'a logged meal' : p.section.includes('plannedMeals') ? 'a planned meal' : sectionNames[base] ?? 'the upload';
  const when = p.date ? ` on ${new Date(`${p.date}T12:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}` : '';
  const at = p.index === null ? p.section : `${p.section}[${p.index}]`;
  return `${what[0].toUpperCase()}${what.slice(1)}${when} (${at}): ${p.field} must be ${p.rule}.`;
}
