import type { LocalDate } from '../plan/dates';

/**
 * How a value was obtained (contract 06):
 * - `observed`: read directly from a source (scale display, app screen, manual entry).
 * - `inferred`: calculated from other values; never used as a measurement for display.
 */
export type ObservationKind = 'observed' | 'inferred';

export type SourceType = 'manual' | 'screenshot' | 'integration';

export type Provenance = {
  type: SourceType;
  /** Normalised source app slug, e.g. "fitbit"; null for manual entry. */
  app: string | null;
  /** When the source data was captured (e.g. screenshot time), ISO with offset. */
  capturedAt: string | null;
  /** Extractor confidence 0–1; null for manual entry. */
  confidence: number | null;
  /** Import session and asset this came from (screenshot imports). */
  importId: string | null;
  assetId: string | null;
  /** The text the value was read from, e.g. "97.25 kg". */
  evidence: string | null;
  /** True when the user changed the extracted value before saving. */
  edited: boolean;
};

/** Canonical record of one value on one day. Not plan-scoped: the user's data outlives plans. */
export type Observation = {
  id: string;
  /** Local calendar date the value is about (the measurement date). */
  date: LocalDate;
  /** Catalog metric id (see metrics.ts), or a plan measurement id for custom metrics. */
  metric: string;
  value: number;
  /** Canonical unit for catalog metrics. */
  unit: string;
  kind: ObservationKind;
  /** Free label, e.g. the workout type ("Weights") or the on-screen label for `other`. */
  label: string | null;
  note: string | null;
  source: Provenance;
  /** When this record was saved, ISO. */
  recordedAt: string;
};

export type ImportAsset = {
  id: string;
  fileName: string | null;
  mimeType: string | null;
  capturedAt: string | null;
  /** Durable on-device copy of the screenshot (native); null when not retained (web). */
  storedUri: string | null;
  sourceApp: string | null;
};

export type ImportSession = {
  id: string;
  createdAt: string;
  /** What read the screenshots, e.g. "anthropic:claude-opus-5-5". */
  extractor: string;
  assets: ImportAsset[];
};

export function manualSource(): Provenance {
  return { type: 'manual', app: null, capturedAt: null, confidence: null, importId: null, assetId: null, evidence: null, edited: false };
}
