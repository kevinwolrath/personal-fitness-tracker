import type { ImportSession, Observation } from '../observations/types';
import type { LocalDate } from '../plan/dates';
import type { MealLog } from '../nutrition/contract';

/** The verbatim plan package plus import metadata (contract 04 `plan`). */
export type StoredPlan = {
  planId: string;
  revision: number;
  formatVersion: number;
  json: string;
  importedAt: string;
  /** Where this plan came from. Only an untouched `seed` may be replaced by a newer bundled seed. Missing = seed. */
  /** `onboarding`: created by first-run setup (#49). */
  origin?: 'seed' | 'config' | 'import' | 'onboarding';
};

/** One applied configuration update (contract 07): what changed, from what, and how to undo it. */
export type ConfigChange = {
  id: string;
  appliedAt: string;
  /** Sections the update touched, e.g. ["exercise"]; ["undo"] for an undo. */
  sections: string[];
  /** The validated update payload as pasted (or `{ undoOf: id }`). */
  payload: unknown;
  fromRevision: number;
  toRevision: number;
  /** Exact plan JSON before the change, so it can be restored. */
  previousPlanJson: string;
};

export type ActivityStatus = 'pending' | 'done' | 'skipped';

export type ActivityLog = {
  activityId: string;
  status: ActivityStatus;
  /** Units completed for `count` tracking; 0 for `check`. */
  count: number;
  labelSnapshot: string;
  updatedAt: string;
  /** Session variant used ("short" = the shortened version). Absent = full / not applicable. */
  variant?: 'full' | 'short';
  /** Requirement this activity satisfied as an alternative (contract 08). */
  requirementId?: string;
  /**
   * Exercises ticked off within a session (#28), as keys `<variant>:<index>:<movement>` (see
   * src/prescription/exercises.ts). Kept per variant: full and short doses differ. `variant` is then the
   * version being done, even while `status` is still pending.
   */
  exercisesDone?: string[];
};

/** Append-only record of every completion action (contract 08). Never rewritten or deleted by undo. */
export type CompletionEvent = {
  id: string;
  planId: string;
  date: LocalDate;
  /** Activity id, or `req:<id>` when a whole requirement was skipped/restored. */
  activityId: string;
  requirementId: string | null;
  /** `tick`/`untick`: one exercise in a session (label = the exercise); `switch`: full ↔ short version chosen (#28). */
  action: 'complete' | 'progress' | 'undo' | 'skip' | 'restore' | 'tick' | 'untick' | 'switch';
  count: number;
  variant: 'full' | 'short' | null;
  label: string;
  purpose: string | null;
  at: string;
};

/** What was prescribed on a date, captured when the day was acted on, so later plan edits can't rewrite it. */
export type DaySnapshot = {
  planId: string;
  date: LocalDate;
  planRevision: number;
  prescribed: unknown;
  updatedAt: string;
};

export type QuickLogEntry = {
  id: string;
  planId: string;
  quickLogId: string;
  date: LocalDate;
  at: string;
};

/** How hard an exercise was, when known (#56). */
export type ExerciseIntensity = 'light' | 'moderate' | 'hard';

/**
 * An exercise logged outside any scheduled session (#56), at any time of day. Session exercises are never
 * written here (they live in their session's activity log), so muscle history counts each completion once.
 */
export type ExerciseLog = {
  id: string;
  /** Inventory movement id. */
  movement: string;
  date: LocalDate;
  at: string;
  /** Completed sets (rounds for conditioning). */
  sets: number;
  reps: number | null;
  seconds: number | null;
  intensity: ExerciseIntensity | null;
  /**
   * #122: the routine this belongs to. "muscle_growth": a Muscle Growth checklist item (one per date and movement),
   * kept apart from Resistance Training completion but counted in the same muscle history. Absent: a free log.
   */
  routine?: 'muscle_growth' | null;
  /** #122: "skipped" is an explicit skip: no work, never counted for muscles, XP or progress. Absent = done. */
  status?: 'done' | 'skipped' | null;
  /** #122: load used, in kg. */
  loadKg?: number | null;
  /** #122: reps in reserve (perceived effort), 0–10. */
  rir?: number | null;
};

/** A user report that a muscle group is sore or injured (#56). Overrides automatic readiness until cleared. */
export type MuscleReport = {
  id: string;
  /** Inventory muscle-group id. */
  muscle: string;
  kind: 'sore' | 'injured';
  at: string;
  clearedAt: string | null;
};

export type DayRecords = {
  activities: Record<string, ActivityLog>;
  dayTypeOverride: string | null;
  /** All observations about this date, any metric or source, ordered by recordedAt. */
  observations: Observation[];
  quickLogs: QuickLogEntry[];
};

export type ActivityLogRecord = ActivityLog & { planId: string; date: LocalDate };
export type DayOverrideRecord = { planId: string; date: LocalDate; dayTypeId: string };

/** Everything the store holds, for full-history export and (later) round-trip restore. */
export type StoreSnapshot = {
  plans: StoredPlan[];
  activityLogs: ActivityLogRecord[];
  dayOverrides: DayOverrideRecord[];
  observations: Observation[];
  quickLogs: QuickLogEntry[];
  imports: ImportSession[];
  configChanges: ConfigChange[];
  completionEvents: CompletionEvent[];
  daySnapshots: DaySnapshot[];
  /** #56. Absent in snapshots made before it. */
  exerciseLogs?: ExerciseLog[];
  muscleReports?: MuscleReport[];
  /** #97. Absent in snapshots made before it. */
  mealLogs?: MealLog[];
  /**
   * #134. App-owned identifiers kept with the data (e.g. the health-sync user id), so a restore on a new phone keeps
   * them. Never secrets. Absent in snapshots made before it: a restore then keeps this phone's own values.
   */
  appMeta?: Record<string, string>;
};

/** The scheduled meal's completion written with a meal log, atomically (#97): done when replaced, undone on removal. */
export type MealCompletion = { planId: string; date: LocalDate; activityId: string; log: ActivityLog | null; event: CompletionEvent; snapshot: DaySnapshot };

/**
 * The only way screens touch persisted data (contract 04).
 * Implementations: SQLite on native, key-value (localStorage) on web.
 * Both must pass the shared suite in src/storage/__tests__/store.contract.ts.
 */
export interface TrackingStore {
  getActivePlan(): Promise<StoredPlan | null>;
  setActivePlan(plan: StoredPlan): Promise<void>;

  getDay(planId: string, date: LocalDate): Promise<DayRecords>;
  /** Upsert, or delete when `log` is null (undo back to "not done"). */
  setActivity(planId: string, date: LocalDate, activityId: string, log: ActivityLog | null): Promise<void>;
  setDayOverride(planId: string, date: LocalDate, dayTypeId: string | null): Promise<void>;

  addObservations(observations: Observation[]): Promise<void>;
  removeObservation(id: string): Promise<void>;
  /**
   * Latest **observed** (never inferred) value on or before `date`: latest date; on that date a value the user
   * entered or confirmed beats an integration's (#36); then latest recordedAt.
   */
  latestObservation(metric: string, onOrBefore: LocalDate): Promise<Observation | null>;
  /** Every observed (never inferred) observation of these metrics, by date then recordedAt (#52 Progress). */
  observationsFor(metrics: string[]): Promise<Observation[]>;
  /** One plan's activity logs and day-type overrides, by date (#52 Progress: workouts done vs scheduled). */
  planHistory(planId: string): Promise<{ activityLogs: ActivityLogRecord[]; dayOverrides: DayOverrideRecord[] }>;
  /**
   * Replace one integration's observations (`source.importId`) for these dates and metrics with `observations`,
   * atomically (#36). Only that integration's records on those days and metrics are removed: manual entries,
   * screenshot imports, other days and metrics that weren't read are never touched.
   */
  replaceIntegrationObservations(importId: string, dates: LocalDate[], metrics: string[], observations: Observation[]): Promise<void>;

  addQuickLog(entry: QuickLogEntry): Promise<void>;
  removeQuickLog(id: string): Promise<void>;

  /** Replace the active plan with a configuration change, and record the change. Atomic. */
  applyConfigChange(plan: StoredPlan, change: ConfigChange): Promise<void>;
  /**
   * Record a completion action atomically: current state (null = back to not done), the append-only event,
   * and the day's prescription snapshot.
   */
  logCompletion(planId: string, date: LocalDate, activityId: string, log: ActivityLog | null, event: CompletionEvent, snapshot: DaySnapshot): Promise<void>;
  completionEvents(planId: string, date: LocalDate): Promise<CompletionEvent[]>;
  daySnapshot(planId: string, date: LocalDate): Promise<DaySnapshot | null>;

  /** Applied configuration changes, newest first. */
  configHistory(): Promise<ConfigChange[]>;

  /** Earliest date that has any record (observation, activity, override or quick log); null when empty. */
  firstRecordDate(): Promise<LocalDate | null>;

  /** Every record, from the earliest through the latest. No lookback limit. */
  /** Exercises logged outside sessions (#56), oldest first; optionally only dates in [from, to]. */
  exerciseLogs(range?: { from?: LocalDate; to?: LocalDate }): Promise<ExerciseLog[]>;
  addExerciseLog(log: ExerciseLog): Promise<void>;
  removeExerciseLog(id: string): Promise<void>;
  /** Every muscle report, oldest first (#56). */
  muscleReports(): Promise<MuscleReport[]>;
  addMuscleReport(report: MuscleReport): Promise<void>;
  /** Mark a report cleared from `at`; the report itself is kept. */
  clearMuscleReport(id: string, at: string): Promise<void>;
  /** Meals actually eaten (#97), by date then time; optionally only dates in [from, to]. */
  mealLogs(range?: { from?: LocalDate; to?: LocalDate }): Promise<MealLog[]>;
  /** Upsert a meal log (same id = same meal: saving twice can't duplicate it), with the replaced meal's completion. Atomic. */
  saveMealLog(log: MealLog, completion?: MealCompletion | null): Promise<void>;
  /** Remove a meal log, with the replaced meal's undo. Atomic. Photo files are the caller's to delete. */
  removeMealLog(id: string, completion?: MealCompletion | null): Promise<void>;
  /** An app-owned identifier stored with the data (#134), or null when not set. */
  getMeta(key: string): Promise<string | null>;
  /** Store `value` under `key` unless one is already there, atomically; returns the stored value (existing or new). */
  ensureMeta(key: string, value: string): Promise<string>;
  snapshot(): Promise<StoreSnapshot>;
  /** Upsert every record of a snapshot (ids are stable), e.g. after reinstall. */
  restore(snapshot: StoreSnapshot): Promise<void>;
  /**
   * Replace EVERYTHING with a snapshot, atomically (#128 full restore): every table/list is emptied and refilled in
   * one transaction (SQLite) or one document write (web). On failure nothing changes.
   */
  replaceAll(snapshot: StoreSnapshot): Promise<void>;
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
