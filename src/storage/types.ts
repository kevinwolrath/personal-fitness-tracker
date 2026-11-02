import type { ImportSession, Observation } from '../observations/types';
import type { LocalDate } from '../plan/dates';

/** The verbatim plan package plus import metadata (contract 04 `plan`). */
export type StoredPlan = {
  planId: string;
  revision: number;
  formatVersion: number;
  json: string;
  importedAt: string;
  /** Where this plan came from. Only an untouched `seed` may be replaced by a newer bundled seed. Missing = seed. */
  origin?: 'seed' | 'config' | 'import';
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
};

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
  /** Latest **observed** (never inferred) value on or before `date`: latest date, then latest recordedAt. */
  latestObservation(metric: string, onOrBefore: LocalDate): Promise<Observation | null>;
  /** Save an import session and its confirmed observations together (all or nothing). */
  saveImport(session: ImportSession, observations: Observation[]): Promise<void>;

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
  snapshot(): Promise<StoreSnapshot>;
  /** Upsert every record of a snapshot (ids are stable), e.g. after reinstall. */
  restore(snapshot: StoreSnapshot): Promise<void>;
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
