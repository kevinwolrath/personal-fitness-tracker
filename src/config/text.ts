import { deepEqual, isBareKey, isBareValue, parseClause, setKey } from './import/parse';
import { MAX_INPUT_CHARS, normalizeQuotes, repair } from './import/recover';
import { canonicalize } from './import/canonicalize';
import { CONFIG_SCHEMA_VERSION, fieldOf, isMerge, sectionNames, sections, type SectionName } from './sections';

export const UPDATE_START = 'BODY ANVIL UPDATE';
export const UPDATE_END = 'END UPDATE';
export const UPDATE_HEADER = `${UPDATE_START} v${CONFIG_SCHEMA_VERSION}`;
export const CONFIG_ENVELOPE = 'fitnessConfigUpdate';

const startMarker = /^BODY ANVIL UPDATE(?:\s+v\S*)?$/i;
const isEndMarker = (line: string) => line.toUpperCase() === UPDATE_END;
const splitLines = (text: string) => text.split(/\r\n|\n|\r/).map((line) => line.trim());
export const isConfigText = (text: string) => /^[^\S\r\n]*(?:BODY ANVIL UPDATE(?:[^\S\r\n]+v\S*)?|END UPDATE)[^\S\r\n]*$/im.test(text);

type TextResult =
  | { ok: true; value: unknown; lines: Map<string, number> }
  | { ok: false; errors: string[] };

/** Extract exactly one block. Sections can repeat, but each field can occur only once. */
export function readConfigText(text: string, tolerant = false): TextResult {
  if (text.length > MAX_INPUT_CHARS) return { ok: false, errors: [`Paste an update of at most ${MAX_INPUT_CHARS} characters.`] };
  const rows = splitLines(text).map((row) => tolerant ? row.replace(/^[-*•]\s+/, '') : row);
  const starts = rows.flatMap((row, i) => startMarker.test(row) ? [i] : []);
  const ends = rows.flatMap((row, i) => isEndMarker(row) ? [i] : []);
  const fail = (i: number, message: string): TextResult => ({ ok: false, errors: [`Line ${i + 1}: ${message}`] });
  if (starts.length > 1) return fail(starts[1], 'More than one update block. Paste only the update you want to review.');
  const [start] = starts;
  const [end] = ends;
  if (start === undefined) return fail(end ?? 0, `Missing "${UPDATE_HEADER}".`);
  if ((tolerant ? rows[start].toUpperCase() : rows[start]) !== (tolerant ? UPDATE_HEADER.toUpperCase() : UPDATE_HEADER)) return fail(start, `Expected "${UPDATE_HEADER}". Copy fresh instructions from the app if the version differs.`);
  if (end === undefined) return fail(start, `Missing "${UPDATE_END}". Ask for the complete update.`);
  if (end < start || (!tolerant && rows[end] !== UPDATE_END)) return fail(end, `Expected "${UPDATE_END}" after the update.`);
  if (ends.length > 1) return fail(ends[1], 'More than one end marker.');
  const legacy = rows.findIndex((row, i) => (i < start || i > end) && /^\{?\s*"fitnessConfigUpdate"\s*:/.test(row));
  if (legacy !== -1) return fail(legacy, 'Found a JSON update as well. Paste only the update you want to review.');

  const body: Record<string, unknown> = { schemaVersion: CONFIG_SCHEMA_VERSION };
  const lines = new Map<string, number>();
  let section: SectionName | undefined;
  for (let i = start + 1; i < end; i++) {
    const row = rows[i];
    if (!row) continue;
    const heading = /^\[([A-Za-z][A-Za-z0-9_ -]*)\]$/.exec(row);
    if (heading) {
      const name = sectionNames.find((s) => tolerant ? s.toLowerCase() === heading[1].toLowerCase() || sections[s].title.toLowerCase() === heading[1].toLowerCase() : s === heading[1]);
      if (!name) return fail(i, `Unknown section "${heading[1]}". Use ${sectionNames.join(', ')}.`);
      section = name;
      if (!lines.has(name)) {
        lines.set(name, i + 1);
        body[name] = {};
      }
      continue;
    }
    const assignment = (tolerant ? /^([A-Za-z_][A-Za-z0-9_ -]*?)\s*[:=]\s*([\s\S]*)$/ : /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*([\s\S]*)$/).exec(row);
    if (!assignment || !section) return fail(i, 'Expected a [section] heading or a field: value line inside a section.');
    let [, key, source] = assignment;
    if (tolerant) {
      const normalized = (name: string) => name.replace(/[ _-]/g, '').toLowerCase();
      const matches = Object.keys(sections[section].fields).filter((name) => normalized(name) === normalized(key) || normalized(fieldOf(section!, name).title) === normalized(key));
      if (matches.length === 1) key = matches[0];
    }
    if (!Object.prototype.hasOwnProperty.call(sections[section].fields, key)) return fail(i, `Unknown field "${key}" in [${section}].`);
    const path = `${section}.${key}`;
    const duplicate = lines.has(path);
    if (duplicate && !tolerant) return fail(i, `${path} was already set on line ${lines.get(path)}.`);
    if (!duplicate) lines.set(path, i + 1);
    const field = fieldOf(section, key);
    const patch = body[section] as Record<string, unknown>;
    if ((tolerant ? source.toUpperCase() : source) === 'CLEAR') {
      if (!field.clearable) return fail(i, `${path} cannot be cleared.`);
      if (duplicate && patch[key] !== null) return fail(i, `${path} conflicts with line ${lines.get(path)}.`);
      patch[key] = null;
      continue;
    }
    const merge = (tolerant ? /^MERGE\s+/i : /^MERGE\s+/).test(source);
    if (merge && !field.mergeById) return fail(i, `${path} does not support MERGE.`);
    const clause = merge ? source.replace(/^MERGE\s+/i, '') : source;
    const unitValue = field.textUnit && (tolerant ? clause.toLowerCase() : clause).endsWith(` ${field.textUnit}`)
      ? clause.slice(0, -field.textUnit.length - 1).trimEnd()
      : clause;
    const punctuation = tolerant ? repair(normalizeQuotes(unitValue, 0).text.replace(/,\s*$/, '')) : null;
    const safePunctuation = punctuation?.ok && punctuation.notes.every((note) => /trailing comma/.test(note));
    const result = parseClause(safePunctuation ? punctuation.text : unitValue);
    if (!result.ok) {
      const detail = field.textUnit && /^[-+\d.]/.test(clause) && /\s/.test(clause)
        ? `Expected a number, optionally followed by ${field.textUnit}.`
        : result.error.replace(/ at line 1, column \d+/g, '');
      return fail(i, `${path}: ${detail}`);
    }
    if (merge && !Array.isArray(result.value)) return fail(i, 'MERGE requires a list of complete items.');
    if (field.mergeById && !merge && isMerge(result.value)) return fail(i, `Use "${key}: MERGE [items]" to merge by id.`);
    if (field.mergeById && Array.isArray(result.value)) {
      const ids = new Set<string>();
      for (const item of result.value) {
        if (typeof item?.id !== 'string') continue; // schema validation reports missing or invalid ids
        if (ids.has(item.id)) return fail(i, `Duplicate id "${item.id}" in ${path}.`);
        ids.add(item.id);
      }
    }
    const canonical = tolerant ? canonicalize(result.value, field.schema) : { value: result.value, errors: [] };
    if (canonical.errors.length) return fail(i, canonical.errors.map((e) => e.message).join(' '));
    const value = merge ? { merge: canonical.value } : canonical.value;
    if (duplicate && !deepEqual(patch[key], value)) return fail(i, `${path} conflicts with line ${lines.get(path)}.`);
    setKey(patch, key, value);
  }
  if (lines.size === 0) return fail(start, 'Include at least one section with a field.');
  return { ok: true, value: { [CONFIG_ENVELOPE]: body }, lines };
}

const reserved = new Set(['true', 'false', 'null', 'CLEAR', 'MERGE']);

function formatClause(value: unknown): string {
  if (typeof value === 'string') return isBareValue(value) && !reserved.has(value) ? value : JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(formatClause).join(', ')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined).map(([key, v]) => {
      const label = isBareKey(key) ? key : JSON.stringify(key);
      return `${label}: ${formatClause(v)}`;
    }).join(', ')}}`;
  }
  return JSON.stringify(value);
}

export function formatConfigText(
  config: Partial<Record<SectionName, Record<string, unknown>>>,
  heading = UPDATE_HEADER,
  footer = UPDATE_END,
): string {
  const lines = [heading];
  for (const section of sectionNames) {
    const fields = config[section];
    if (!fields) continue;
    const entries = Object.keys(sections[section].fields).filter((key) => fields[key] !== undefined);
    if (!entries.length) continue;
    lines.push(`[${section}]`);
    for (const key of entries) {
      const value = fields[key];
      const field = fieldOf(section, key);
      const clause = value === null ? 'CLEAR'
        : field.mergeById && isMerge(value) ? `MERGE ${formatClause(value.merge)}`
        : typeof value === 'number' && field.textUnit ? `${value} ${field.textUnit}`
        : formatClause(value);
      lines.push(`${key}: ${clause}`);
    }
  }
  lines.push(footer);
  return lines.join('\n');
}
