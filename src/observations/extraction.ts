import { z } from 'zod';
import { addDays, type LocalDate } from '../plan/dates';
import { canonicalUnit, metricDef, metricIds } from './metrics';
import type { ObservationKind } from './types';
import { round, toCanonical } from './units';

/**
 * What an extractor returns for ONE screenshot. Provider-neutral: the Claude extractor
 * produces it via structured output; a future OCR or API source can produce the same shape.
 */
export const extractionSchema = z.object({
  sourceApp: z.string().nullable().describe('App or device the screenshot is from, e.g. "Fitbit", "Renpho", "Health Connect". null if unknown.'),
  screenDate: z
    .string()
    .nullable()
    .describe('YYYY-MM-DD of the day the screen shows, resolved against the provided local date. null if the screen does not say.'),
  observations: z.array(
    z.object({
      metric: z.enum([...metricIds, 'other']).describe('Canonical metric id, or "other" if none fits.'),
      label: z.string().describe('Label as shown on screen, e.g. "Steps", or the workout type for exercise_session, e.g. "Weights".'),
      value: z.number().describe('Numeric value exactly as displayed, in the displayed unit (durations: total minutes).'),
      unit: z.string().describe('Displayed unit, e.g. "kg", "lb", "kcal", "min", "steps", "score", "%", "bpm".'),
      kind: z
        .enum(['observed', 'inferred'])
        .describe('"observed" if the number is printed on screen. "inferred" if you calculated it from other numbers.'),
      evidence: z.string().describe('The exact on-screen text the value came from, or for inferred values the calculation.'),
      date: z.string().nullable().describe('YYYY-MM-DD if this value is for a different day than screenDate, else null.'),
      confidence: z.number().describe('0 to 1: how sure you are the value, unit and metric are read correctly.'),
    }),
  ),
});

export type Extraction = z.infer<typeof extractionSchema>;
type Extracted = Extraction['observations'][number];

export type Candidate = {
  /** Stable key within a review session. */
  key: string;
  assetId: string;
  metric: string;
  label: string;
  /** Canonical value and unit (see metrics.ts). */
  value: number;
  unit: string;
  kind: ObservationKind;
  evidence: string;
  confidence: number;
  date: LocalDate;
  /** Default: observed values included, inferred values excluded (contract 06). */
  include: boolean;
};

export type MappedScreenshot = {
  assetId: string;
  sourceApp: string | null;
  candidates: Candidate[];
  /** Human-readable reasons for values that could not be used. */
  dropped: string[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "Fitbit" / "Google Fit " → "fitbit" / "google-fit". */
export function slugApp(name: string | null | undefined): string | null {
  const slug = (name ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || null;
}

/** Dates must be real calendar days, not in the future, and within a year. */
function acceptDate(d: string | null | undefined, today: LocalDate): LocalDate | null {
  if (!d || !ISO_DATE.test(d)) return null;
  const parsed = new Date(`${d}T12:00:00`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== d) return null;
  if (d > today || d < addDays(today, -366)) return null;
  return d;
}

/**
 * Map one screenshot's extraction to reviewable candidates in canonical units.
 * Pure. Drops anything that can't be stored faithfully, with a reason for the review screen.
 */
export function mapExtraction(
  assetId: string,
  raw: unknown,
  ctx: { defaultDate: LocalDate; today: LocalDate },
): MappedScreenshot {
  // Validate the envelope, then each value on its own: one malformed value must not discard the rest.
  const envelope = extractionSchema.extend({ observations: z.array(z.unknown()) }).safeParse(raw);
  if (!envelope.success) return { assetId, sourceApp: null, candidates: [], dropped: ['The extractor returned an unreadable result.'] };
  const itemSchema = extractionSchema.shape.observations.element;
  const ex = { ...envelope.data, observations: [] as Extracted[] };
  const unreadable: string[] = [];
  for (const item of envelope.data.observations) {
    const r = itemSchema.safeParse(item);
    if (r.success) ex.observations.push(r.data);
    else {
      const label = (item as { label?: unknown })?.label;
      unreadable.push(`${typeof label === 'string' && label ? label : 'A value'}: not a number`);
    }
  }

  const screenDate = acceptDate(ex.screenDate, ctx.today) ?? ctx.defaultDate;
  const dropped: string[] = [];
  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  ex.observations.forEach((o: Extracted, i) => {
    const name = o.label || o.metric;
    if (!Number.isFinite(o.value)) return dropped.push(`${name}: not a number`);

    let metric: string = o.metric;
    let value = o.value;
    let unit = o.unit.trim();
    const def = metric === 'other' ? undefined : metricDef(metric);
    if (def) {
      const canonical = toCanonical(o.value, o.unit, def.dimension);
      if (canonical === null) return dropped.push(`${name}: unit "${o.unit}" doesn't fit ${def.label.toLowerCase()}`);
      value = round(canonical, def.decimals);
      unit = canonicalUnit[def.dimension];
      if (def.dimension !== 'mass_change' && value < 0) return dropped.push(`${name}: negative value`);
    } else {
      metric = 'other';
    }

    const date = o.date ? acceptDate(o.date, ctx.today) ?? screenDate : screenDate;
    const dedupe = `${metric}|${o.label.toLowerCase()}|${date}|${value}|${o.kind}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);

    candidates.push({
      key: `${assetId}:${i}`,
      assetId,
      metric,
      label: def && metric !== 'exercise_session' && metric !== 'other' ? def.label : o.label || def?.label || 'Value',
      value,
      unit,
      kind: o.kind,
      evidence: o.evidence,
      confidence: Math.min(1, Math.max(0, Number.isFinite(o.confidence) ? o.confidence : 0)),
      date,
      include: o.kind === 'observed',
    });
  });

  return { assetId, sourceApp: slugApp(ex.sourceApp), candidates, dropped: [...dropped, ...unreadable] };
}

