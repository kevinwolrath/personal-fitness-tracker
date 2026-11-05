import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { HC_IMPORT_ID, mapHealthConnect, summarizeRead, syncDates, type HcType } from '../../observations/healthConnect';
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
  /** Ask for read access (the only place the app asks), then sync. */
  connect: () => Promise<void>;
  /** Re-read the last 7 days now (30 if nothing has synced yet). Never throws. */
  syncNow: () => void;
  openSettings: () => void;
  openInstall: () => void;
};

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
  const chain = useRef<Promise<void>>(Promise.resolve());
  const syncRef = useRef<HcSyncState | null>(null);

  const runSync = useCallback(
    async (types: HcType[]) => {
      if (!types.length) return;
      const previous = syncRef.current ?? (await preferences.healthConnectSync());
      const dates = syncDates(toLocalDate(new Date()), !previous?.firstDone);
      setSyncing(true);
      let next: HcSyncState;
      try {
        const { read, failed } = await healthConnect.read(types, dates);
        const mapped = mapHealthConnect(read, dates, localIsoTimestamp());
        await store.replaceIntegrationObservations(HC_IMPORT_ID, dates, mapped.metrics, mapped.observations);
        next = {
          at: localIsoTimestamp(),
          ok: failed.length === 0,
          days: dates.length,
          failed,
          firstDone: (previous?.firstDone ?? false) || mapped.metrics.length > 0,
          types: summarizeRead(read, failed, types, dates),
        };
        notifyDataChanged();
      } catch {
        next = { at: localIsoTimestamp(), ok: false, days: dates.length, failed: types, firstDone: previous?.firstDone ?? false, types: summarizeRead({}, types, types, dates) };
      }
      syncRef.current = next;
      setSync(next);
      setSyncing(false);
      await preferences.setHealthConnectSync(next).catch(() => undefined);
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
        await runSync(g);
      })
      .catch(() => undefined);
  }, [runSync]);

  useEffect(() => {
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

  const connect = useCallback(async () => {
    let g: HcType[] = [];
    try {
      g = await healthConnect.request();
    } catch {
      g = [];
    }
    setGranted(g);
    setRefused(g.length === 0);
    if (g.length) {
      chain.current = chain.current.then(() => runSync(g)).catch(() => undefined);
      await chain.current;
    }
  }, [runSync]);

  const value = useMemo<HealthConnectState>(
    () => ({
      availability,
      granted,
      sync,
      syncing,
      refused,
      checkFailed,
      connect,
      syncNow: refresh,
      openSettings: healthConnect.openSettings,
      openInstall: healthConnect.openInstall,
    }),
    [availability, granted, sync, syncing, refused, checkFailed, connect, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
