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
      origin: z.enum(['seed', 'config', 'import', 'onboarding']).optional(),
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
      activity: z.object({ start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }), exerciseType: z.number().int().optional(), distanceMeters: z.number().finite().nonnegative().optional(), distancePartial: z.boolean().optional() }).optional(),
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
      variant: z.enum(['full', 'short']).optional(),
      requirementId: z.string().optional(),
      exercisesDone: z.array(z.string()).optional(),
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
  /** Append-only completion history and what was prescribed each day (contract 08). Added in-version; optional when reading. */
  completionEvents: z
    .array(
      z.object({
        id: z.string(), planId: z.string(), date, activityId: z.string(), requirementId: z.string().nullable(),
        action: z.enum(['complete', 'progress', 'undo', 'skip', 'restore', 'tick', 'untick', 'switch']), count: z.number(),
        variant: z.enum(['full', 'short']).nullable(), label: z.string(), purpose: z.string().nullable(), at: z.string(),
      }),
    )
    .default([]),
  daySnapshots: z
    .array(z.object({ planId: z.string(), date, planRevision: z.number(), prescribed: z.unknown(), updatedAt: z.string() }))
    .default([]),
  /** Exercises logged outside sessions and sore/injured muscle reports (#56). Added in-version; optional when reading. */
  exerciseLogs: z
    .array(
      z.object({
        id: z.string(), movement: z.string(), date, at: z.string(), sets: z.number(), reps: z.number().nullable(), seconds: z.number().nullable(),
        intensity: z.enum(['light', 'moderate', 'hard']).nullable(),
      }),
    )
    .default([]),
  muscleReports: z
    .array(z.object({ id: z.string(), muscle: z.string(), kind: z.enum(['sore', 'injured']), at: z.string(), clearedAt: z.string().nullable() }))
    .default([]),
  /**
   * Meals actually eaten (#97, contract 15). Added in-version; optional when reading. Photos are listed by their
   * on-device location only: the export never contains image data.
   */
  mealLogs: z
    .array(
      z.object({
        id: z.string(), date, at: z.string(), planId: z.string().nullable(), activityId: z.string().nullable(), replacedLabel: z.string().nullable(),
        name: z.string(),
        items: z.array(z.object({
          name: z.string(), quantity: z.number().nullable(), unit: z.string().nullable(),
          energyKj: z.number().nullable(), proteinG: z.number().nullable(), carbsG: z.number().nullable(), fatG: z.number().nullable(),
        })),
        aiTotals: z.object({ energyKj: z.number().nullable(), proteinG: z.number().nullable(), carbsG: z.number().nullable(), fatG: z.number().nullable() }).nullable(),
        confidence: z.enum(['low', 'medium', 'high']).nullable(),
        assumptions: z.array(z.string()), uncertainties: z.array(z.string()),
        source: z.enum(['photo-ai', 'manual']), schemaVersion: z.number().nullable(), edited: z.boolean(),
        photos: z.array(z.object({ id: z.string(), uri: z.string(), addedAt: z.string(), width: z.number().nullable(), height: z.number().nullable() })),
        recordedAt: z.string(), updatedAt: z.string(),
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
    ...(s.exerciseLogs ?? []).map((l) => l.date),
    ...(s.mealLogs ?? []).map((m) => m.date),
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
      completionEvents: s.completionEvents.length,
      daySnapshots: s.daySnapshots.length,
      exerciseLogs: (s.exerciseLogs ?? []).length,
      muscleReports: (s.muscleReports ?? []).length,
      mealLogs: (s.mealLogs ?? []).length,
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
    completionEvents: s.completionEvents,
    daySnapshots: s.daySnapshots,
    exerciseLogs: s.exerciseLogs ?? [],
    muscleReports: s.muscleReports ?? [],
    mealLogs: s.mealLogs ?? [],
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
      completionEvents: e.completionEvents,
      daySnapshots: e.daySnapshots.map((d) => ({ ...d, prescribed: d.prescribed as unknown })),
      exerciseLogs: e.exerciseLogs,
      muscleReports: e.muscleReports,
      mealLogs: e.mealLogs,
    },
  };
}
