import { newId } from '../storage/types';
import type { Candidate } from './extraction';
import type { ImportSession, Observation } from './types';
import { formatMinutes } from './units';

export type ReviewedCandidate = Candidate & {
  /** What the user typed, if they edited the value. */
  editedText?: string;
};

export type BuildResult = { ok: true; observations: Observation[] } | { ok: false; errors: Record<string, string> };

/** Accept "97,25" as well as "97.25", and thousands separators ("13,765"). */
function parseNumber(text: string): number | null {
  const t = text.trim();
  const plain = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
  const n = Number(plain);
  return t !== '' && Number.isFinite(n) ? n : null;
}

/** "7h 45m", "7h45", "7:45", "45m" or plain minutes ("465") → minutes. */
function parseMinutes(text: string): number | null {
  const t = text.trim().toLowerCase();
  const hm = t.match(/^(\d+)\s*h(?:r)?(?:\s*(\d+)\s*m(?:in)?)?$/) ?? t.match(/^(\d+)h(\d+)$/) ?? t.match(/^(\d+):(\d{1,2})$/);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2] ?? 0);
  const m = t.match(/^(\d+(?:[.,]\d+)?)\s*(?:m(?:in)?)?$/);
  return m ? Number(m[1].replace(',', '.')) : null;
}

/** The value as the review shows it, formatted like the Daily Log: "13,765", "7 hr 45 min", "97.25". Still editable. */
export function formatReviewValue(unit: string, value: number): string {
  if (unit === 'min') {
    return formatMinutes(value);
  }
  return Number.isInteger(value) && Math.abs(value) >= 1000 ? value.toLocaleString('en-AU') : String(value);
}

/** Inverse of formatReviewValue, also accepting plain numbers. Null when it isn't a value. */
export function parseReviewValue(unit: string, text: string): number | null {
  return unit === 'min' ? parseMinutes(text) : parseNumber(text);
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
      const n = parseReviewValue(c.unit, c.editedText);
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
