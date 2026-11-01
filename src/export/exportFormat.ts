import { z } from 'zod';
import type { LocalDate } from '../plan/dates';
import type { StoreSnapshot } from '../storage/types';

/**
 * Full-history export, version 1 (contract 06). Everything the app stores, from the earliest
 * record through `range.to`, with provenance and timestamps. Designed for round-trip import:
 * every record keeps its stable id/key, and `toSnapshot` is the exact inverse of `buildExport`.
 */
export const EXPORT_FORMAT = 'pft-export';
export const EXPORT_VERSION = 1;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const provenance = z.object({
  type: z.enum(['manual', 'screenshot', 'integration']),
  app: z.string().nullable(),
  capturedAt: z.string().nullable(),
  confidence: z.number().nullable(),
  importId: z.string().nullable(),
  assetId: z.string().nullable(),
  evidence: z.string().nullable(),
  edited: z.boolean(),
});

export const exportSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  exportVersion: z.literal(EXPORT_VERSION),
  exportedAt: z.string(),
  app: z.object({ name: z.string(), version: z.string() }),
  /** `from` is the earliest dated record, or null when there is no history yet. */
  range: z.object({ from: date.nullable(), to: date }),
  counts: z.record(z.string(), z.number()),
  plans: z.array(
    z.object({
      planId: z.string(),
      revision: z.number(),
      formatVersion: z.number(),
      importedAt: z.string(),
      origin: z.enum(['seed', 'config', 'import']).optional(),
      /** The plan package as imported (goals, targets, schedule live here). */
      plan: z.unknown(),
    }),
  ),
  observations: z.array(
    z.object({
      id: z.string(),
      date,
      metric: z.string(),
      value: z.number(),
      unit: z.string(),
      kind: z.enum(['observed', 'inferred']),
      label: z.string().nullable(),
      note: z.string().nullable(),
      source: provenance,
      recordedAt: z.string(),
    }),
  ),
  activityLogs: z.array(
    z.object({
      planId: z.string(),
      date,
      activityId: z.string(),
      status: z.enum(['pending', 'done', 'skipped']),
      count: z.number(),
      labelSnapshot: z.string(),
      updatedAt: z.string(),
    }),
  ),
  dayOverrides: z.array(z.object({ planId: z.string(), date, dayTypeId: z.string() })),
  quickLogs: z.array(z.object({ id: z.string(), planId: z.string(), quickLogId: z.string(), date, at: z.string() })),
  imports: z.array(
    z.object({
      id: z.string(),
      createdAt: z.string(),
      extractor: z.string(),
      assets: z.array(
        z.object({
          id: z.string(),
          fileName: z.string().nullable(),
          mimeType: z.string().nullable(),
          capturedAt: z.string().nullable(),
          storedUri: z.string().nullable(),
          sourceApp: z.string().nullable(),
        }),
      ),
    }),
  ),
  /** Applied AI configuration updates with the previous plan for each (contract 07). Added in-version; optional when reading. */
  configChanges: z
    .array(
      z.object({
        id: z.string(),
        appliedAt: z.string(),
        sections: z.array(z.string()),
        payload: z.unknown(),
        fromRevision: z.number(),
        toRevision: z.number(),
        previousPlanJson: z.string(),
      }),
    )
    .default([]),
});

export type ExportDocument = z.infer<typeof exportSchema>;

export function earliestDate(s: StoreSnapshot): LocalDate | null {
  const dates = [
    ...s.observations.map((o) => o.date),
    ...s.activityLogs.map((a) => a.date),
    ...s.dayOverrides.map((d) => d.date),
    ...s.quickLogs.map((q) => q.date),
  ];
  return dates.length ? dates.reduce((a, b) => (b < a ? b : a)) : null;
}

/** Pure. No filtering by date: the export is the whole store. */
export function buildExport(s: StoreSnapshot, meta: { exportedAt: string; today: LocalDate; appVersion: string }): ExportDocument {
  return {
    format: EXPORT_FORMAT,
    exportVersion: EXPORT_VERSION,
    exportedAt: meta.exportedAt,
    app: { name: 'personal-fitness-tracker', version: meta.appVersion },
    range: { from: earliestDate(s), to: meta.today },
    counts: {
      observations: s.observations.length,
      activityLogs: s.activityLogs.length,
      dayOverrides: s.dayOverrides.length,
      quickLogs: s.quickLogs.length,
      imports: s.imports.length,
      configChanges: s.configChanges.length,
    },
    plans: s.plans.map((p) => ({
      planId: p.planId,
      revision: p.revision,
      formatVersion: p.formatVersion,
      importedAt: p.importedAt,
      origin: p.origin ?? 'seed',
      plan: JSON.parse(p.json),
    })),
    observations: s.observations,
    activityLogs: s.activityLogs,
    dayOverrides: s.dayOverrides,
    quickLogs: s.quickLogs,
    imports: s.imports,
    configChanges: s.configChanges,
  };
}

/** Inverse of buildExport, for a future "Restore from export". Validates first. */
export function toSnapshot(input: unknown): { ok: true; snapshot: StoreSnapshot } | { ok: false; error: string } {
  const parsed = exportSchema.safeParse(input);
  if (!parsed.success) {
    const head = parsed.error.issues[0];
    return { ok: false, error: `${head?.path.join('.') || '(root)'}: ${head?.message ?? 'invalid export'}` };
  }
  const e = parsed.data;
  return {
    ok: true,
    snapshot: {
      plans: e.plans.map((p) => ({
        planId: p.planId,
        revision: p.revision,
        formatVersion: p.formatVersion,
        importedAt: p.importedAt,
        origin: p.origin ?? 'seed',
        json: JSON.stringify(p.plan),
      })),
      observations: e.observations,
      activityLogs: e.activityLogs,
      dayOverrides: e.dayOverrides,
      quickLogs: e.quickLogs,
      imports: e.imports,
      configChanges: e.configChanges.map((c) => ({ ...c, payload: c.payload as unknown })),
    },
  };
}
