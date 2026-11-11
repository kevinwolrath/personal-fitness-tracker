import { isBareKey, isBareValue, parseClause, setKey } from './import/parse';
import { MAX_INPUT_CHARS } from './import/recover';
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
export function readConfigText(text: string): TextResult {
  if (text.length > MAX_INPUT_CHARS) return { ok: false, errors: [`Paste an update of at most ${MAX_INPUT_CHARS} characters.`] };
  const rows = splitLines(text);
  const starts = rows.flatMap((row, i) => startMarker.test(row) ? [i] : []);
  const ends = rows.flatMap((row, i) => isEndMarker(row) ? [i] : []);
  const fail = (i: number, message: string): TextResult => ({ ok: false, errors: [`Line ${i + 1}: ${message}`] });
  if (starts.length > 1) return fail(starts[1], 'More than one update block. Paste only the update you want to review.');
  const [start] = starts;
  const [end] = ends;
  if (start === undefined) return fail(end ?? 0, `Missing "${UPDATE_HEADER}".`);
  if (rows[start] !== UPDATE_HEADER) return fail(start, `Expected "${UPDATE_HEADER}". Copy fresh instructions from the app if the version differs.`);
  if (end === undefined) return fail(start, `Missing "${UPDATE_END}". Ask for the complete update.`);
  if (end < start || rows[end] !== UPDATE_END) return fail(end, `Expected "${UPDATE_END}" after the update.`);
  if (ends.length > 1) return fail(ends[1], 'More than one end marker.');
  const legacy = rows.findIndex((row, i) => (i < start || i > end) && /^\{?\s*"fitnessConfigUpdate"\s*:/.test(row));
  if (legacy !== -1) return fail(legacy, 'Found a JSON update as well. Paste only the update you want to review.');

  const body: Record<string, unknown> = { schemaVersion: CONFIG_SCHEMA_VERSION };
  const lines = new Map<string, number>();
  let section: SectionName | undefined;
  for (let i = start + 1; i < end; i++) {
    const row = rows[i];
    if (!row) continue;
    const heading = /^\[([A-Za-z][A-Za-z0-9_-]*)\]$/.exec(row);
    if (heading) {
      const name = sectionNames.find((s) => s === heading[1]);
      if (!name) return fail(i, `Unknown section "${heading[1]}". Use ${sectionNames.join(', ')}.`);
      section = name;
      if (!lines.has(name)) {
        lines.set(name, i + 1);
        body[name] = {};
      }
      continue;
    }
    const assignment = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*([\s\S]*)$/.exec(row);
    if (!assignment || !section) return fail(i, 'Expected a [section] heading or a field: value line inside a section.');
    const [, key, source] = assignment;
    if (!Object.prototype.hasOwnProperty.call(sections[section].fields, key)) return fail(i, `Unknown field "${key}" in [${section}].`);
    const path = `${section}.${key}`;
    if (lines.has(path)) return fail(i, `${path} was already set on line ${lines.get(path)}.`);
    lines.set(path, i + 1);
    const field = fieldOf(section, key);
    const patch = body[section] as Record<string, unknown>;
    if (source === 'CLEAR') {
      if (!field.clearable) return fail(i, `${path} cannot be cleared.`);
      patch[key] = null;
      continue;
    }
    const merge = /^MERGE\s+/.test(source);
    if (merge && !field.mergeById) return fail(i, `${path} does not support MERGE.`);
    const clause = merge ? source.replace(/^MERGE\s+/, '') : source;
    const unitValue = field.textUnit && clause.endsWith(` ${field.textUnit}`)
      ? clause.slice(0, -field.textUnit.length - 1).trimEnd()
      : clause;
    const result = parseClause(unitValue);
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
    setKey(patch, key, merge ? { merge: result.value } : result.value);
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
