import { z } from 'zod';
import { validatePlan } from '../plan/validate';
import type { Plan } from '../plan/schema';
import { CONFIG_SCHEMA_VERSION, fieldOf, sectionNames, sectionPatchSchema, type RawPlan, type SectionName } from './sections';

/** A validated update: which sections, and within each, which fields (null = clear). */
export type ConfigUpdate = {
  schemaVersion: number;
  sections: Partial<Record<SectionName, Record<string, unknown>>>;
};

export type ParseResult = { ok: true; update: ConfigUpdate; json: unknown } | { ok: false; errors: string[] };

const ENVELOPE = 'fitnessConfigUpdate';

function zodErrors(prefix: string, error: z.ZodError): string[] {
  return error.issues.map((i) => {
    const path = i.path.reduce<string>((acc, p) => (typeof p === 'number' ? `${acc}[${p}]` : `${acc}.${String(p)}`), prefix);
    return `${path}: ${i.message}`;
  });
}

/**
 * Deterministic payload parsing (contract 07). Accepts the JSON on its own, or exactly one fenced
 * ```json block (chat apps wrap code that way). Never interprets prose.
 */
export function parseConfigUpdate(text: string): ParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, errors: ['Paste the update the AI gave you.'] };

  let jsonText = trimmed;
  const fences = [...trimmed.matchAll(/```[a-zA-Z]*\s*\n?([\s\S]*?)```/g)];
  if (fences.length > 1) return { ok: false, errors: ['Found more than one code block. Paste only the one update block.'] };
  if (fences.length === 1) jsonText = fences[0][1].trim();

  let json: unknown;
  try {
    json = JSON.parse(jsonText);
  } catch (e) {
    return { ok: false, errors: [`This isn't valid JSON (${e instanceof Error ? e.message : 'parse error'}). Ask the AI to resend the update as one JSON code block.`] };
  }

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
      fieldOf(name, key).write(next, value === null ? undefined : JSON.parse(JSON.stringify(value)));
    }
  }
  next.formatVersion = 3; // updates always produce the current format (a superset of 1 and 2)
  next.revision = (Number(currentRaw.revision) || 0) + 1;

  const result = validatePlan(next);
  if (!result.ok) {
    return {
      ok: false,
      errors: result.errors.map((e) => `After this update the configuration would be invalid: ${e}`),
    };
  }
  return { ok: true, nextRaw: next, plan: result.plan, touched };
}
