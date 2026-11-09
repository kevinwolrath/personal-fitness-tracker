import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { HC_IMPORT_ID, hcTypes, mapHealthConnect, summarizeRead, syncDates, type HcType } from '../../observations/healthConnect';
import { setupChanges, setupRows, wantedTypes, type HcSetupChange, type HcSetupRow } from '../../observations/healthConnectSetup';
import { toLocalDate } from '../../plan/dates';
import { healthConnect, type HcAvailability } from '../../platform/healthConnect';
import { preferences, type HcSyncState } from '../../platform/preferences';
import { useApp } from '../../providers/AppProvider';
import { localIsoTimestamp } from '../../format';

export type HealthConnectState = {
  /** Null while checking. */
  availability: HcAvailability | null;
  /** The types the user allowed (read only). Empty = not connected. */
  granted: HcType[];
  /** The last finished sync on this phone, if any. */
  sync: HcSyncState | null;
  syncing: boolean;
  /** The last Connect allowed nothing. */
  refused: boolean;
  /** Checking permissions failed on the last open (#44): the connection is unknown, not "off". */
  checkFailed: boolean;
  /** The types the user ticked (#116): only these are asked for and read. */
  wanted: HcType[];
  /** Per type: off, needs access, no data, working… (#116). */
  rows: HcSetupRow[];
  /** The last check the user started (Check again, a fix, or returning from Health Connect), and what it changed. */
  lastCheck: { at: string; changes: HcSetupChange[] } | null;
  /** Ask for read access to the ticked types (the only place the app asks), then sync. */
  connect: () => Promise<void>;
  /** Tick or untick a type. Unticking stops reading it; what was imported stays. */
  setWanted: (type: HcType, on: boolean) => void;
  /** Ask Android for one type's read access (a fix), then check again. */
  allow: (type: HcType) => Promise<void>;
  /** Re-check permissions and re-read now; the result is reported in `lastCheck`. Never throws. */
  checkAgain: () => void;
  /** Same as checkAgain, without reporting (older callers). */
  syncNow: () => void;
  /** Open Health Connect; the check on return reports what changed. */
  openSettings: () => void;
  openInstall: () => void;
  /** Forget the last check's report (the sheet closed). */
  clearCheck: () => void;
};

/** The app each type last came from, kept across syncs (#116). */
function lastAppsAfter(previous: HcSyncState | null, types: Record<string, { app?: string | null }>): Partial<Record<HcType, string>> {
  const out: Partial<Record<HcType, string>> = { ...(previous?.lastApps ?? {}) };
  for (const t of hcTypes) {
    const app = types[t]?.app;
    if (app) out[t] = app;
  }
  return out;
}

const Ctx = createContext<HealthConnectState | null>(null);

export function useHealthConnect(): HealthConnectState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useHealthConnect outside HealthConnectProvider');
  return ctx;
}

/**
 * Keeps imported Health Connect values current (contract 12): on app start, on return to the foreground and on
 * "Sync now". No background sync. A sync re-reads a window of days and replaces that window's imported values,
 * so it is idempotent and picks up edits and deletions made in other apps. Failures are recorded, never thrown:
 * the Daily Log always opens and works.
 */
export function HealthConnectProvider({ children }: { children: ReactNode }) {
  const { store, notifyDataChanged } = useApp();
  const [availability, setAvailability] = useState<HcAvailability | null>(null);
  const [granted, setGranted] = useState<HcType[]>([]);
  const [sync, setSync] = useState<HcSyncState | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [refused, setRefused] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [storedWanted, setStoredWanted] = useState<HcType[] | null>(null);
  const [lastCheck, setLastCheck] = useState<HealthConnectState['lastCheck']>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const syncRef = useRef<HcSyncState | null>(null);
  const wantedRef = useRef<HcType[] | null>(null);
  const wantedLoaded = useRef<Promise<void> | null>(null);
  /** The rows when the user started a check or left for Health Connect: the next refresh reports against them. */
  const before = useRef<HcSetupRow[] | null>(null);
  const rowsRef = useRef<HcSetupRow[]>([]);

  const storeWanted = useCallback((w: HcType[]) => {
    wantedRef.current = w;
    setStoredWanted(w);
    preferences.setHealthConnectWanted(w).catch(() => undefined);
  }, []);

  const runSync = useCallback(
    async (types: HcType[]): Promise<HcSyncState | null> => {
      if (!types.length) return syncRef.current;
      const previous = syncRef.current ?? (await preferences.healthConnectSync());
      const today = toLocalDate(new Date());
      // Backfill from the last fully successful sync (#46). States saved before #46 have no lastFullSync: use the
      // day of their last sync when it fully succeeded.
      const lastFull = previous?.lastFullSync ?? (previous?.ok ? toLocalDate(new Date(previous.at)) : null);
      const dates = syncDates(today, !previous?.firstDone, lastFull);
      setSyncing(true);
      let next: HcSyncState;
      try {
        const { read, failed } = await healthConnect.read(types, dates);
        const mapped = mapHealthConnect(read, dates, localIsoTimestamp());
        const results = summarizeRead(read, failed, types, dates);
        await store.replaceIntegrationObservations(HC_IMPORT_ID, dates, mapped.metrics, mapped.observations);
        next = {
          at: localIsoTimestamp(),
          ok: failed.length === 0,
          days: dates.length,
          failed,
          firstDone: (previous?.firstDone ?? false) || mapped.metrics.length > 0,
          types: results,
          lastApps: lastAppsAfter(previous, results),
          // Only a sync that read every allowed type moves the backfill start; otherwise its gap is re-read.
          lastFullSync: failed.length === 0 ? today : (lastFull ?? undefined),
        };
        notifyDataChanged();
      } catch {
        next = { at: localIsoTimestamp(), ok: false, days: dates.length, failed: types, firstDone: previous?.firstDone ?? false, types: summarizeRead({}, types, types, dates), lastFullSync: lastFull ?? undefined, lastApps: previous?.lastApps };
      }
      syncRef.current = next;
      setSync(next);
      setSyncing(false);
      await preferences.setHealthConnectSync(next).catch(() => undefined);
      return next;
    },
    [store, notifyDataChanged],
  );

  /** Re-check availability and permissions (they can change in Health Connect's own settings), then sync. */
  const refresh = useCallback(() => {
    chain.current = chain.current
      .then(async () => {
        const a = await healthConnect.availability();
        setAvailability(a);
        if (a !== 'available') return setGranted([]);
        let g: HcType[];
        try {
          g = await healthConnect.granted();
          setCheckFailed(false);
        } catch {
          // Don't show "not connected" because a check failed: keep what we knew and say so (#44).
          setCheckFailed(true);
          return;
        }
        setGranted(g);
        await wantedLoaded.current;
        // Connected before #116: keep what Health Connect allows now as the choice, so a later revocation shows
        // as "needs access" instead of quietly unticking the type.
        if (!wantedRef.current && g.length) storeWanted(wantedTypes(null, g));
        const wanted = wantedTypes(wantedRef.current, g);
        const next = await runSync(g.filter((t) => wanted.includes(t)));
        if (before.current) {
          const after = setupRows(wanted, g, next?.types);
          setLastCheck({ at: localIsoTimestamp(), changes: setupChanges(before.current, after) });
          before.current = null;
        }
      })
      .catch(() => undefined);
  }, [runSync, storeWanted]);

  useEffect(() => {
    wantedLoaded.current = preferences.healthConnectWanted().then((w) => {
      if (w && !wantedRef.current) {
        wantedRef.current = w;
        setStoredWanted(w);
      }
    });
    preferences.healthConnectSync().then((s) => {
      syncRef.current = s;
      setSync(s);
    });
    refresh();
  }, [refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => sub.remove();
  }, [refresh]);

  const wanted = useMemo(() => wantedTypes(storedWanted, granted), [storedWanted, granted]);
  const rows = useMemo(() => setupRows(wanted, granted, sync?.types), [wanted, granted, sync]);
  rowsRef.current = rows;

  const connect = useCallback(async () => {
    const ticked = wantedTypes(wantedRef.current, []);
    let g: HcType[] = [];
    try {
      g = await healthConnect.request(ticked);
    } catch {
      g = [];
    }
    storeWanted(ticked);
    setGranted(g);
    setRefused(!g.some((t) => ticked.includes(t)));
    if (g.length) {
      chain.current = chain.current.then(() => runSync(g.filter((t) => ticked.includes(t)))).then(() => undefined).catch(() => undefined);
      await chain.current;
    }
  }, [runSync, storeWanted]);

  /** Start a reported check: remember the rows now, then re-check (or let returning to the app re-check). */
  const markBefore = useCallback(() => {
    before.current ??= rowsRef.current;
  }, []);
  const checkAgain = useCallback(() => {
    markBefore();
    refresh();
  }, [markBefore, refresh]);

  const setWanted = useCallback(
    (type: HcType, on: boolean) => {
      const current = wantedTypes(wantedRef.current, granted);
      storeWanted(hcTypes.filter((t) => (t === type ? on : current.includes(t))));
      setLastCheck(null);
      if (on) refresh();
    },
    [granted, storeWanted, refresh],
  );

  const allow = useCallback(
    async (type: HcType) => {
      markBefore();
      try {
        setGranted(await healthConnect.request([type]));
      } catch {
        // Not asked or not allowed: the check below reports it.
      }
      refresh();
      await chain.current;
    },
    [markBefore, refresh],
  );

  const openSettings = useCallback(() => {
    markBefore();
    healthConnect.openSettings();
  }, [markBefore]);

  const clearCheck = useCallback(() => {
    setLastCheck(null);
    before.current = null;
  }, []);

  const value = useMemo<HealthConnectState>(
    () => ({
      availability,
      granted,
      sync,
      syncing,
      refused,
      checkFailed,
      wanted,
      rows,
      lastCheck,
      connect,
      setWanted,
      allow,
      checkAgain,
      syncNow: refresh,
      openSettings,
      openInstall: healthConnect.openInstall,
      clearCheck,
    }),
    [availability, granted, sync, syncing, refused, checkFailed, wanted, rows, lastCheck, connect, setWanted, allow, checkAgain, refresh, openSettings, clearCheck],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
