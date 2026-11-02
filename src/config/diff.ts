import { fieldOf, sectionNames, sections, type RawPlan, type SectionName } from './sections';
import type { ConfigUpdate } from './update';

export type ChangeLine = { kind: 'add' | 'remove' | 'change'; text: string };
export type SectionPreview = {
  section: SectionName;
  title: string;
  /** supplied: the update includes this section; otherwise it is guaranteed untouched. */
  supplied: boolean;
  lines: ChangeLine[];
};

const words = (s: string) => s.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * How the preview formats amounts, from the plan being previewed: the user's energy unit and the
 * nutrition targets (so { energy: 2100, protein: 55 } reads "energy 2,100 kJ, protein 55 g").
 * Set by previewUpdate for the duration of one preview.
 */
type FormatContext = { energyUnit: string; targets: Map<string, { label: string; quantity: string }>; activityNames: Map<string, string> };
let fmt: FormatContext = { energyUnit: 'kJ', targets: new Map(), activityNames: new Map() };

const num = (n: number) => n.toLocaleString('en-AU', { maximumFractionDigits: 2 });
const amount = (quantity: string | undefined, n: number) => `${num(n)}${quantity === 'energy' ? ` ${fmt.energyUnit}` : quantity === 'grams' ? ' g' : ''}`;

/** Plain-language names for plan fields that don't read well as split words. */
const fieldLabels: Record<string, string> = {
  when: 'time of day',
  after: 'runs after',
  satisfies: 'counts toward',
  appliesTo: 'days',
  sessionsPerWeek: 'sessions a week',
  sessionMinutes: 'session length',
  maxSessionMinutes: 'longest session',
  modalities: 'activities',
  weightsKg: 'weights',
  notifications: 'reminders',
  nutrition: '', // a meal's amounts read on their own: "energy 2,100 kJ, protein 55 g"
};
const fieldLabel = (k: string) => fieldLabels[k] ?? words(k);
const labelled = (k: string, value: string) => (fieldLabel(k) ? `${fieldLabel(k)} ${value}` : value);
const isRange = (o: Record<string, unknown>) => 'min' in o && 'max' in o && Object.keys(o).length === 2;

function compact(v: unknown): string {
  if (v === undefined || v === null) return 'none';
  if (Array.isArray(v)) return v.length ? v.map(compact).join(', ') : 'none';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('minutes' in o && Object.keys(o).length === 1) return `${o.minutes} min`;
    if (isRange(o)) return `${num(o.min as number)}–${num(o.max as number)}`;
    // A reminder (#30): "“Lunch in 5 minutes” 5 min before", "“Time for your snack” at 16:00".
    if (typeof o.title === 'string' && typeof o.body === 'string' && ('offsetMinutes' in o || 'at' in o)) {
      const m = o.offsetMinutes as number | undefined;
      const when = o.at ? `at ${o.at}` : m === 0 ? 'at the start' : m! < 0 ? `${-m!} min before` : `${m} min after`;
      return `“${o.body}” ${when}`;
    }
    // A meal ingredient (#26): "Rolled oats 40 g (~½ cup)".
    if (typeof o.name === 'string' && ('grams' in o || 'ml' in o || 'measure' in o)) {
      const amount = [o.grams !== undefined ? `${num(o.grams as number)} g` : null, o.ml !== undefined ? `${num(o.ml as number)} ml` : null].filter(Boolean).join(' / ');
      return [o.name, amount || null, o.measure ? `(${o.measure})` : null].filter(Boolean).join(' ');
    }
    // Nutrition amounts keyed by target id.
    const keys = Object.keys(o);
    if (keys.length && keys.every((k) => fmt.targets.has(k) && typeof o[k] === 'number')) {
      return keys.map((k) => `${fmt.targets.get(k)!.label.toLowerCase()} ${amount(fmt.targets.get(k)!.quantity, o[k] as number)}`).join(', ');
    }
    return Object.entries(o)
      .filter(([, x]) => x !== undefined)
      .map(([k, x]) => labelled(k, fieldValue(k, x)))
      .join(', ');
  }
  // Humanise identifiers (snake_case enums/ids); keep free text exactly as written.
  if (typeof v === 'string') return fmt.activityNames.get(v) ?? (/^[a-z0-9]+([_-][a-z0-9]+)*$/.test(v) ? words(v) : v);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return num(v);
  return String(v);
}

/** A field's value with its unit where the field name implies one ("sessionMinutes" → "30–45 min"). */
const fieldValue = (k: string, v: unknown) => `${compact(v)}${/minutes$/i.test(k) && v !== undefined && v !== null && !(typeof v === 'object' && 'minutes' in (v as object)) ? ' min' : ''}`;

/** "nutrition energy 900 kJ; cleared: purpose, time of day" — never "→ —". */
function fieldChanges(old: Record<string, unknown>, next: Record<string, unknown>, keys: string[]): string {
  const parts: string[] = [];
  const cleared: string[] = [];
  for (const k of keys) {
    if (next[k] === undefined) cleared.push(fieldLabel(k) || words(k));
    else if (old[k] === undefined) parts.push(labelled(k, fieldValue(k, next[k])));
    else parts.push(labelled(k, `${fieldValue(k, old[k])} → ${fieldValue(k, next[k])}`));
  }
  if (cleared.length) parts.push(`cleared: ${list(cleared)}`);
  return parts.join('; ');
}

type Item = Record<string, any>;
type Describer = {
  key: (i: Item) => string;
  name: (i: Item) => string;
  added?: (i: Item) => string;
  removed?: (i: Item) => string;
  /** Whole-item wording for a change, when per-field wording reads badly. */
  changed?: (old: Item, next: Item) => string;
};

const targetRange = (i: Item) =>
  i.min !== undefined && i.max !== undefined
    ? `${num(i.min)}–${amount(i.quantity, i.max)}`
    : i.max !== undefined
      ? `≤ ${amount(i.quantity, i.max)}`
      : `≥ ${amount(i.quantity, i.min)}`;

/** Item wording for list fields, so the preview reads like the issue's example. */
const describers: Record<string, Describer> = {
  'exercise.equipment': {
    key: (i) => `${i.type}|${i.brand ?? ''}|${i.label ?? ''}`,
    name: (i) => {
      const base = i.label ?? (i.brand ? `${i.brand} ${words(i.type)}` : words(i.type));
      if (i.weightsKg?.length) return `${list(i.weightsKg.map((w: number) => `${w} kg`))} ${words(i.type)}${i.weightsKg.length > 1 ? 's' : ''}`;
      return cap(base);
    },
  },
  'exercise.limitations': {
    key: (i) => i.movement,
    name: (i) => words(i.movement),
    added: (i) => {
      const what = i.status === 'avoid' ? `Avoid ${words(i.movement)}` : i.status === 'caution' ? `Caution with ${words(i.movement)}` : `${cap(words(i.movement))} permitted`;
      return i.reason ? `${what} (${i.reason})` : what;
    },
  },
  'exercise.substitutions': {
    key: (i) => i.instead,
    name: (i) => `instead of ${words(i.instead)}: ${list(i.use.map(words))}`,
    added: (i) => `Instead of ${words(i.instead)}, use ${list(i.use.map(words))}`,
  },
  'exercise.activityTypes': { key: (i) => i.id, name: (i) => `${i.label} (${words(i.kind)}${i.intensity ? `, ${i.intensity} intensity` : ''})` },
  'goals.targets': { key: (i) => i.id, name: (i) => `${i.label}: ${words(i.direction)} to ${i.target}` },
  'nutrition.targets': {
    key: (i) => i.id,
    name: (i) => `${i.label} ${targetRange(i)}`,
    changed: (o, n) => `${n.label}: ${targetRange(o)} → ${targetRange(n)}`,
  },
  'nutrition.meals': { key: (i) => i.id, name: (i) => `${i.label}${i.time ? ` at ${i.time}` : ''}` },
  'schedule.activities': { key: (i) => i.id, name: (i) => `${i.label}${i.time ? ` at ${i.time}` : ''}` },
  'schedule.dayTypes': { key: (i) => i.id, name: (i) => i.label },
  'tracking.measurements': { key: (i) => i.id, name: (i) => i.label },
  'tracking.quickLogs': { key: (i) => i.id, name: (i) => i.label },
};

/** Readable name for one list item at `section.field` (e.g. "16 kg and 24 kg kettlebells"), or compact JSON. */
export function describeItem(path: string, item: unknown): string {
  const d = describers[path];
  if (d && item && typeof item === 'object') return cap(d.name(item as Item));
  return cap(compact(item));
}

export function describeLimitation(i: { movement: string; status: string; reason?: string }): string {
  return describers['exercise.limitations'].added!(i);
}

function diffList(path: string, title: string, before: unknown, after: unknown): ChangeLine[] {
  const a = (Array.isArray(before) ? before : []) as unknown[];
  const b = (Array.isArray(after) ? after : []) as unknown[];
  const d = describers[path];
  if (!d || a.some((x) => typeof x !== 'object') || b.some((x) => typeof x !== 'object')) {
    // Lists of plain values (e.g. goals, notes).
    const as = a.map((x) => JSON.stringify(x));
    const bs = b.map((x) => JSON.stringify(x));
    const added = b.filter((_, i) => !as.includes(bs[i])).map(compact);
    const removed = a.filter((_, i) => !bs.includes(as[i])).map(compact);
    return [
      ...(added.length ? [{ kind: 'add' as const, text: `${title}: ${added.join(', ')}` }] : []),
      ...(removed.length ? [{ kind: 'remove' as const, text: `${title}: ${removed.join(', ')}` }] : []),
    ];
  }
  const byKey = (xs: unknown[]) => new Map((xs as Item[]).map((x) => [d.key(x), x]));
  const am = byKey(a);
  const bm = byKey(b);
  const lines: ChangeLine[] = [];
  for (const [k, item] of bm) {
    const old = am.get(k);
    if (!old) lines.push({ kind: 'add', text: d.added ? d.added(item) : `Added ${d.name(item)}` });
    else if (JSON.stringify(old) !== JSON.stringify(item)) {
      const fields = [...new Set([...Object.keys(old), ...Object.keys(item)])].filter((f) => JSON.stringify(old[f]) !== JSON.stringify(item[f]));
      lines.push({ kind: 'change', text: d.changed ? d.changed(old, item) : `${cap(d.name(old))}: ${fieldChanges(old, item, fields)}` });
    }
  }
  for (const [k, item] of am) if (!bm.has(k)) lines.push({ kind: 'remove', text: d.removed ? d.removed(item) : `Removed ${d.name(item)}` });
  return lines;
}

function diffValue(path: string, title: string, before: unknown, after: unknown): ChangeLine[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (Array.isArray(before) || Array.isArray(after)) return diffList(path, title, before, after);
  if (after === undefined) return [{ kind: 'remove', text: `${title}: cleared (was ${compact(before)})` }];
  if (before === undefined) return [{ kind: 'add', text: `${title}: ${compact(after)}` }];
  if (typeof before === 'object' && typeof after === 'object') {
    const o = before as Record<string, unknown>;
    const n = after as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])].filter((k) => JSON.stringify(o[k]) !== JSON.stringify(n[k]));
    return [{ kind: 'change', text: `${title}: ${fieldChanges(o, n, keys)}` }];
  }
  return [{ kind: 'change', text: `${title}: ${compact(before)} → ${compact(after)}` }];
}

/** Human-readable preview for every section: supplied ones with their changes, others marked untouched. */
export function previewUpdate(currentRaw: RawPlan, nextRaw: RawPlan, update: ConfigUpdate): SectionPreview[] {
  return withFormat(nextRaw, () => previewSections(currentRaw, nextRaw, update));
}

/** Run `fn` with amounts formatted for `plan` (its energy unit, target units and activity names). */
export function withFormat<T>(plan: RawPlan, fn: () => T): T {
  const previous = fmt;
  const raw = plan as {
    units?: { energy?: string };
    nutrition?: { targets?: { id: string; label: string; quantity: string }[] };
    exercise?: { activityTypes?: { id: string; label: string }[] };
  };
  fmt = {
    energyUnit: raw.units?.energy ?? 'kJ',
    targets: new Map((raw.nutrition?.targets ?? []).map((t) => [t.id, t])),
    activityNames: new Map((raw.exercise?.activityTypes ?? []).map((a) => [a.id, a.label])),
  };
  try {
    return fn();
  } finally {
    fmt = previous;
  }
}

function previewSections(currentRaw: RawPlan, nextRaw: RawPlan, update: ConfigUpdate): SectionPreview[] {
  return sectionNames.map((section) => {
    const fields = update.sections[section];
    if (!fields) return { section, title: sections[section].title, supplied: false, lines: [] };
    const lines = Object.keys(fields).flatMap((key) => {
      const f = fieldOf(section, key);
      return diffValue(`${section}.${key}`, f.title, f.read(currentRaw), f.read(nextRaw));
    });
    return { section, title: sections[section].title, supplied: true, lines };
  });
}
