import { newId } from '../storage/types';
import type { Candidate } from './extraction';
import type { ImportSession, Observation } from './types';

export type ReviewedCandidate = Candidate & {
  /** What the user typed, if they edited the value. */
  editedText?: string;
};

export type BuildResult = { ok: true; observations: Observation[] } | { ok: false; errors: Record<string, string> };

/** Accept "97,25" as well as "97.25". */
function parseNumber(text: string): number | null {
  const n = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(n) ? n : null;
}

/**
 * Turn the user's confirmed review into canonical observations with full provenance.
 * Pure. Only included candidates are saved; inferred ones keep kind "inferred" (contract 06).
 */
export function buildObservations(
  session: ImportSession,
  reviewed: ReviewedCandidate[],
  recordedAt: string,
  makeId: () => string = newId,
): BuildResult {
  const errors: Record<string, string> = {};
  const observations: Observation[] = [];
  const assets = new Map(session.assets.map((a) => [a.id, a]));

  for (const c of reviewed) {
    if (!c.include) continue;
    let value = c.value;
    let edited = false;
    if (c.editedText !== undefined) {
      const n = parseNumber(c.editedText);
      if (n === null) {
        errors[c.key] = 'Enter a number';
        continue;
      }
      if (n < 0 && c.metric !== 'weight_change') {
        errors[c.key] = 'Must not be negative';
        continue;
      }
      edited = n !== c.value;
      value = n;
    }
    const asset = assets.get(c.assetId);
    observations.push({
      id: makeId(),
      date: c.date,
      metric: c.metric,
      value,
      unit: c.unit,
      kind: c.kind,
      label: c.metric === 'exercise_session' || c.metric === 'other' ? c.label : null,
      note: null,
      source: {
        type: 'screenshot',
        app: asset?.sourceApp ?? null,
        capturedAt: asset?.capturedAt ?? null,
        confidence: c.confidence,
        importId: session.id,
        assetId: c.assetId,
        evidence: c.evidence,
        edited,
      },
      recordedAt,
    });
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, observations };
}
