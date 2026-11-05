import { z } from 'zod';
import { deepEqual, setKey } from './parse';

/**
 * Step 4 (#47): match property names and enum values the schema knows, case-insensitively, and rewrite them in
 * their canonical casing. Driven by the real zod schemas, so nothing is hand-listed and nothing can drift.
 *
 * - Only schema property names and enum/literal values are touched. Free text, ids and anything the schema types as
 *   a plain string are left exactly as written.
 * - Two keys that differ only in case (`goals` and `GOALS`) are an error when their values differ, and kept once when
 *   they are equal.
 * - Unknown keys are left alone, so validation still rejects them.
 */

type Schema = z.ZodTypeAny;
const def = (s: Schema): any => (s as any)._zod.def;

/** The concrete schemas behind wrappers (optional, nullable, default, pipe, lazy, union…). */
function variants(s: Schema, seen = new Set<Schema>()): Schema[] {
  if (seen.has(s)) return [];
  seen.add(s);
  const d = def(s);
  switch (d.type) {
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'readonly':
    case 'catch':
    case 'nonoptional':
      return variants(d.innerType, seen);
    case 'pipe':
      return variants(d.in, seen);
    case 'lazy':
      return variants(d.getter(), seen);
    case 'union':
      return d.options.flatMap((o: Schema) => variants(o, seen));
    case 'intersection':
      return [...variants(d.left, seen), ...variants(d.right, seen)];
    default:
      return [s];
  }
}

const objectShapes = (ss: Schema[]) => ss.filter((s) => def(s).type === 'object').map((s) => def(s).shape as Record<string, Schema>);
const arrayElements = (ss: Schema[]) => ss.filter((s) => def(s).type === 'array').map((s) => def(s).element as Schema);
const recordValues = (ss: Schema[]) => ss.filter((s) => def(s).type === 'record').map((s) => def(s).valueType as Schema);

/** Allowed string values where the schema is an enum or a string literal; null if any variant accepts free text. */
function enumValues(ss: Schema[]): string[] | null {
  const out: string[] = [];
  for (const s of ss) {
    const d = def(s);
    if (d.type === 'enum') out.push(...(Object.values(d.entries).filter((v) => typeof v === 'string') as string[]));
    else if (d.type === 'literal') out.push(...d.values.filter((v: unknown) => typeof v === 'string'));
    else if (d.type === 'string' || d.type === 'any' || d.type === 'unknown') return null;
  }
  return out.length ? out : null;
}

export type Canonical = { value: unknown; notes: string[]; errors: { path: string; message: string }[] };

export function canonicalize(input: unknown, schema: Schema): Canonical {
  const notes: string[] = [];
  const errors: { path: string; message: string }[] = [];
  const renamed: string[] = [];
  const enums: string[] = [];

  const walk = (v: unknown, ss: Schema[], path: string): unknown => {
    const vs = ss.flatMap((s) => variants(s));
    if (Array.isArray(v)) {
      const els = arrayElements(vs);
      return v.map((x, i) => walk(x, els, `${path}[${i}]`));
    }
    if (v && typeof v === 'object') {
      const shapes = objectShapes(vs);
      const known = new Map<string, Schema[]>();
      for (const sh of shapes) for (const [k, s] of Object.entries(sh)) known.set(k, [...(known.get(k) ?? []), s]);
      const records = recordValues(vs);
      const out: Record<string, unknown> = {};
      const origin = new Map<string, string>(); // canonical key → the key as it was sent
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        let key = k;
        if (!known.has(k)) {
          const matches = [...known.keys()].filter((c) => c.toLowerCase() === k.toLowerCase());
          if (matches.length === 1) {
            key = matches[0];
            renamed.push(`${path ? path + '.' : ''}${k} → ${key}`);
          }
        }
        const childSchemas = known.get(key) ?? records;
        const next = walk(child, childSchemas, path ? `${path}.${key}` : key);
        if (Object.prototype.hasOwnProperty.call(out, key)) {
          const where = path ? `${path}.${key}` : key;
          if (deepEqual(out[key], next)) notes.push(`"${origin.get(key)}" and "${k}" are the same setting with the same value; kept it once (${where}).`);
          else errors.push({ path: where, message: `"${origin.get(key)}" and "${k}" are the same setting with different values. Ask the AI to send it once.` });
          continue;
        }
        origin.set(key, k);
        setKey(out, key, next);
      }
      return out;
    }
    if (typeof v === 'string') {
      const allowed = enumValues(vs);
      if (allowed && !allowed.includes(v)) {
        const matches = allowed.filter((a) => a.toLowerCase() === v.toLowerCase());
        if (matches.length === 1) {
          enums.push(`${path}: "${v}" → "${matches[0]}"`);
          return matches[0];
        }
      }
    }
    return v;
  };

  const value = walk(input, [schema], '');
  if (renamed.length) notes.push(`Matched ${renamed.length === 1 ? 'a name' : `${renamed.length} names`} written in different capitals: ${renamed.join(', ')}.`);
  if (enums.length) notes.push(`Matched ${enums.length === 1 ? 'a value' : `${enums.length} values`} written in different capitals: ${enums.join(', ')}.`);
  return { value, notes, errors };
}
