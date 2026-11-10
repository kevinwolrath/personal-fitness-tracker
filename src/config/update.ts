import { z } from 'zod';
import { validatePlan } from '../plan/validate';
import { catalogueErrors } from '../exercises/catalogue';
import { CURRENT_FORMAT_VERSION, type Plan } from '../plan/schema';
import { importDiagnostics, prepareUpdate } from './import';
import { CONFIG_SCHEMA_VERSION, fieldOf, isMerge, mergeById, sectionNames, sectionPatchSchema, type RawPlan, type SectionName } from './sections';

/** A validated update: which sections, and within each, which fields (null = clear). */
export type ConfigUpdate = {
  schemaVersion: number;
  sections: Partial<Record<SectionName, Record<string, unknown>>>;
};

/**
 * `notes`: what the import repaired or normalised before validating (#47), shown with the preview so nothing is
 * changed silently. On failure, `recoverable` names sections that were complete before the problem (never applied)
 * and `diagnostics` is copyable text for the AI.
 */
export type ParseResult =
  | { ok: true; update: ConfigUpdate; json: unknown; notes: string[] }
  | { ok: false; errors: string[]; notes: string[]; recoverable: string[]; diagnostics: string };

const ENVELOPE = 'fitnessConfigUpdate';

function zodErrors(prefix: string, error: z.ZodError): string[] {
  return error.issues.map((i) => {
    const path = i.path.reduce<string>((acc, p) => (typeof p === 'number' ? `${acc}[${p}]` : `${acc}.${String(p)}`), prefix);
    return `${path}: ${i.message}`;
  });
}

/**
 * Deterministic payload parsing (contract 07). The text goes through the fault-tolerant import first
 * (src/config/import: extract → repair → parse → canonicalise, every change reported), then the same strict
 * validation as always. Never interprets prose, never evaluates anything, never applies a partial update.
 */
export function parseConfigUpdate(text: string): ParseResult {
  const prepared = prepareUpdate(text);
  if (!prepared.ok) return { ok: false, errors: prepared.errors, notes: prepared.notes, recoverable: prepared.recoverable, diagnostics: importDiagnostics(text, prepared) };
  const r = validateEnvelope(prepared.value);
  if (r.ok) return { ...r, notes: prepared.notes };
  return { ok: false, errors: r.errors, notes: prepared.notes, recoverable: [], diagnostics: importDiagnostics(text, { errors: r.errors, notes: prepared.notes }) };
}

/** The strict checks on the parsed object: envelope, schema version, sections, every field. */
function validateEnvelope(json: unknown): { ok: true; update: ConfigUpdate; json: unknown } | { ok: false; errors: string[] } {
  if (typeof json !== 'object' || json === null || Array.isArray(json) || !(ENVELOPE in json)) {
    return { ok: false, errors: [`Expected an object with a "${ENVELOPE}" key at the top level.`] };
  }
  const extraTop = Object.keys(json).filter((k) => k !== ENVELOPE);
  if (extraTop.length) return { ok: false, errors: [`Unexpected top-level key${extraTop.length > 1 ? 's' : ''}: ${extraTop.join(', ')}. Only "${ENVELOPE}" is allowed.`] };

  const body = (json as Record<string, unknown>)[ENVELOPE];
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, errors: [`"${ENVELOPE}" must be an object.`] };
  const b = body as Record<string, unknown>;

  if (!('schemaVersion' in b)) return { ok: false, errors: [`${ENVELOPE}.schemaVersion is missing. This app expects schemaVersion ${CONFIG_SCHEMA_VERSION}.`] };
  if (b.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [`${ENVELOPE}.schemaVersion is ${JSON.stringify(b.schemaVersion)}, but this app supports ${CONFIG_SCHEMA_VERSION}. Copy fresh AI instructions from the app and ask again.`],
    };
  }

  const supplied = Object.keys(b).filter((k) => k !== 'schemaVersion');
  const unknown = supplied.filter((k) => !(sectionNames as string[]).includes(k));
  if (unknown.length) {
    return { ok: false, errors: unknown.map((k) => `${ENVELOPE}.${k}: unknown section. Valid sections: ${sectionNames.join(', ')}.`) };
  }
  if (!supplied.length) return { ok: false, errors: [`The update has no sections. Include at least one of: ${sectionNames.join(', ')}.`] };

  // Validate every supplied section before deciding anything: report all problems at once.
  const errors: string[] = [];
  const sections: ConfigUpdate['sections'] = {};
  for (const name of supplied as SectionName[]) {
    const r = sectionPatchSchema(name).safeParse(b[name]);
    if (r.success) sections[name] = b[name] as Record<string, unknown>; // keep the payload's own values (no defaults added)
    else errors.push(...zodErrors(`${ENVELOPE}.${name}`, r.error));
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, update: { schemaVersion: CONFIG_SCHEMA_VERSION, sections }, json };
}

export type ApplyResult =
  | { ok: true; nextRaw: RawPlan; plan: Plan; touched: SectionName[] }
  | { ok: false; errors: string[] };

/**
 * Apply an update to the raw plan JSON. Pure: returns a new object, never mutates `currentRaw`.
 * Omitted sections and fields are left exactly as they were. The merged result must pass full
 * plan validation (cross-section rules included) or nothing is applied.
 */
export function applyConfigUpdate(currentRaw: RawPlan, update: ConfigUpdate): ApplyResult {
  const next: RawPlan = JSON.parse(JSON.stringify(currentRaw));
  const touched = Object.keys(update.sections) as SectionName[];
  for (const name of touched) {
    for (const [key, value] of Object.entries(update.sections[name]!)) {
      const field = fieldOf(name, key);
      const copy = value === null ? undefined : JSON.parse(JSON.stringify(value));
      if (field.mergeById && isMerge(copy)) {
        if (field.merge) field.merge(next, copy.merge);
        else field.write(next, mergeById(field.read(next), copy.merge));
      } else field.write(next, copy);
    }
  }
  next.formatVersion = CURRENT_FORMAT_VERSION; // updates always produce the current format (a superset of the older ones)
  next.revision = (Number(currentRaw.revision) || 0) + 1;

  const result = validatePlan(next);
  if (!result.ok) {
    return {
      ok: false,
      errors: result.errors.map((e) => `After this update the configuration would be invalid: ${e}`),
    };
  }
  // The shared exercise catalogue (#122): custom exercises can't duplicate built-ins, muscles must exist, and a
  // Muscle Growth routine only uses catalogue exercises that work a target and aren't marked "avoid".
  const catalogue = catalogueErrors(result.plan);
  if (catalogue.length) return { ok: false, errors: catalogue };
  return { ok: true, nextRaw: next, plan: result.plan, touched };
}
