import { z } from 'zod';
import { CONFIG_SCHEMA_VERSION, sectionNames, sections } from '../sections';
import { canonicalize } from './canonicalize';
import { parseJson } from './parse';
import { extract, repair, type Problem } from './recover';
import { excerpt, lineCol } from './scan';

/**
 * Fault-tolerant import of an AI's configuration update (#47, contract 07 "Import"). Four pure, deterministic
 * steps, each reporting what it changed: extract → repair → parse → canonicalise. Validation, preview and the
 * atomic apply then work exactly as before (update.ts). Model output is never evaluated or executed.
 */

export type Prepared =
  | { ok: true; value: unknown; notes: string[] }
  | {
      ok: false;
      errors: string[];
      notes: string[];
      /** Sections that were complete before the problem: shown so the user knows, never applied. */
      recoverable: string[];
      /** Where each error was found in the repaired text, for diagnostics. */
      problems: Problem[];
      text?: string;
    };

/** The shape an update can have, for matching names and values (mergeable lists also take { merge: [items] }). */
const walkSchema = (() => {
  const sectionShape = (name: (typeof sectionNames)[number]) =>
    z.object(
      Object.fromEntries(
        Object.entries(sections[name].fields as Record<string, { schema: z.ZodTypeAny; mergeById?: boolean }>).map(([k, f]) => [
          k,
          f.mergeById ? z.union([f.schema, z.object({ merge: z.array((f.schema as any)._zod.def.element) })]) : f.schema,
        ]),
      ),
    );
  return z.object({
    fitnessConfigUpdate: z.object({ schemaVersion: z.number(), ...Object.fromEntries(sectionNames.map((n) => [n, sectionShape(n)])) }),
  });
})();

/** Which sections (and fields) a partial update would have changed, by name. */
function describeSections(value: unknown): string[] {
  const body = (value as any)?.fitnessConfigUpdate;
  if (!body || typeof body !== 'object') return [];
  return Object.keys(body)
    .filter((k) => (sectionNames as string[]).includes(k))
    .map((k) => {
      const fields = body[k] && typeof body[k] === 'object' ? Object.keys(body[k]) : [];
      const title = sections[k as keyof typeof sections].title;
      return fields.length ? `${title} (${fields.join(', ')})` : title;
    });
}

export function prepareUpdate(text: string): Prepared {
  const ex = extract(text);
  if (!ex.ok) return { ok: false, errors: ex.errors.map((e) => e.message), notes: ex.notes, recoverable: [], problems: ex.errors };

  const rp = repair(ex.text);
  const notes = [...ex.notes, ...rp.notes];
  if (!rp.ok) {
    let recoverable: string[] = [];
    if (rp.recoverableText) {
      const p = parseJson(rp.recoverableText);
      if (p.ok) recoverable = describeSections(canonicalize(p.value, walkSchema).value);
    }
    return { ok: false, errors: rp.errors.map((e) => e.message), notes, recoverable, problems: rp.errors, text: rp.text };
  }

  const ps = parseJson(rp.text);
  if (!ps.ok) return { ok: false, errors: [ps.error], notes, recoverable: [], problems: [{ message: ps.error, offset: ps.offset }], text: rp.text };

  const cn = canonicalize(ps.value, walkSchema);
  const allNotes = [...notes, ...ps.notes, ...cn.notes];
  if (cn.errors.length) {
    const errors = cn.errors.map((e) => `${e.path}: ${e.message}`);
    return { ok: false, errors, notes: allNotes, recoverable: [], problems: errors.map((message) => ({ message })), text: rp.text };
  }
  return { ok: true, value: cn.value, notes: allNotes };
}

/**
 * Copyable details for an AI (or a person) to fix a failed import. Contains the errors, what was repaired and an
 * excerpt at each error; the pasted text itself is only quoted around the errors.
 */
export function importDiagnostics(input: string, result: { errors: string[]; notes?: string[]; recoverable?: string[]; problems?: Problem[]; text?: string }): string {
  const lines = [
    'Fitness tracker: configuration update could not be imported.',
    `Schema version expected: ${CONFIG_SCHEMA_VERSION}. Pasted text: ${input.length.toLocaleString('en-AU')} characters.`,
    '',
    'Errors:',
    ...result.errors.map((e) => `- ${e}`),
  ];
  if (result.notes?.length) lines.push('', 'Already fixed automatically:', ...result.notes.map((n) => `- ${n}`));
  if (result.recoverable?.length) lines.push('', `Complete before the problem (not applied): ${result.recoverable.join('; ')}`);
  const located = (result.problems ?? []).filter((p) => p.offset !== undefined && result.text);
  for (const p of located.slice(0, 3)) {
    const { line, col } = lineCol(result.text!, p.offset!);
    lines.push('', `Near line ${line}, column ${col}:`, excerpt(result.text!, p.offset!));
  }
  lines.push('', 'Please resend the whole update as one JSON object: {"fitnessConfigUpdate": {"schemaVersion": 1, …}}, with only the sections you change.');
  return lines.join('\n');
}
