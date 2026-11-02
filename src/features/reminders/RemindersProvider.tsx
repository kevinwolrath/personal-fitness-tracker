import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { addDays, toLocalDate } from '../../plan/dates';
import { notifications, type Permission } from '../../platform/notifications';
import { preferences } from '../../platform/preferences';
import { useApp } from '../../providers/AppProvider';
import { HORIZON_DAYS, desiredReminders, reconcile, remindersForDay, type Reminder } from '../../reminders/schedule';

type RemindersState = {
  /** The device preference (explicit opt-in, remembered). Not plan data. */
  enabled: boolean;
  permission: Permission;
  /** The plan's reminders for today, with status (for the Reminders sheet). */
  today: Reminder[];
  /** The plan defines at least one reminder. */
  planHasReminders: boolean;
  /** Turn on: asks the OS for permission if it hasn't decided yet (this is the only place we ask). */
  enable: () => Promise<void>;
  /** Turn off: cancels every pending reminder; the plan's reminder definitions are untouched. */
  disable: () => Promise<void>;
  /** Re-reconcile now (after a completion, skip, day-type change or plan change). */
  sync: () => void;
  openSettings: () => void;
};

const Ctx = createContext<RemindersState | null>(null);

export function useReminders(): RemindersState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useReminders outside RemindersProvider');
  return ctx;
}

/**
 * Keeps the system's pending reminders equal to what the plan and today's records call for (contract 10).
 * Runs on start, on foreground, on plan change and when asked (`sync`). Reconciling is idempotent: running it
 * twice, or after a restart, never creates duplicates. Syncs are serialized so they can't race.
 */
export function RemindersProvider({ children }: { children: ReactNode }) {
  const { store, plan } = useApp();
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [permission, setPermission] = useState<Permission>('undetermined');
  const [today, setToday] = useState<Reminder[]>([]);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const runSync = useCallback(async () => {
    const date = toLocalDate(new Date());
    const now = new Date();
    const nowMinute = now.getHours() * 60 + now.getMinutes();
    const days = await Promise.all(
      Array.from({ length: HORIZON_DAYS }, (_, i) => addDays(date, i)).map(async (d) => ({ date: d, records: await store.getDay(plan.id, d) })),
    );
    setToday(remindersForDay(plan, date, days[0].records));
    const perm = (await notifications.permission()).status;
    setPermission(perm);
    const wanted = enabledRef.current && perm === 'granted' ? desiredReminders(plan, days, date, nowMinute) : [];
    const change = reconcile(wanted, await notifications.scheduledIds());
    if (change.cancel.length) await notifications.cancel(change.cancel);
    for (const r of change.schedule) await notifications.schedule(r);
  }, [store, plan]);

  const sync = useCallback(() => {
    chain.current = chain.current.then(runSync).catch(() => undefined);
  }, [runSync]);

  // Load the preference, then sync; and again whenever the plan changes.
  useEffect(() => {
    let live = true;
    preferences.remindersEnabled().then((on) => {
      if (!live) return;
      enabledRef.current = on;
      setEnabled(on);
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (loaded) sync();
  }, [loaded, sync, plan]);

  // Back in the foreground (possibly a new day): top the schedule up.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && sync());
    return () => sub.remove();
  }, [sync]);

  // A tapped reminder opens that day with the activity's details (contract 10).
  useEffect(() => {
    const open = (r: { date: string; activityId: string }) => router.navigate({ pathname: '/', params: { date: r.date, focus: r.activityId } });
    notifications.lastOpened().then((r) => r && open(r));
    return notifications.onOpen(open);
  }, []);

  const enable = useCallback(async () => {
    let perm = (await notifications.permission()).status;
    if (perm !== 'granted') perm = await notifications.request(); // explicit user action: the one place we ask
    setPermission(perm);
    enabledRef.current = true;
    setEnabled(true);
    await preferences.setRemindersEnabled(true);
    sync();
  }, [sync]);

  const disable = useCallback(async () => {
    enabledRef.current = false;
    setEnabled(false);
    await preferences.setRemindersEnabled(false);
    sync(); // reconciles against nothing: cancels all of ours
  }, [sync]);

  const value = useMemo<RemindersState>(
    () => ({
      enabled,
      permission,
      today,
      planHasReminders: plan.activities.some((a) => a.notifications?.length),
      enable,
      disable,
      sync,
      openSettings: notifications.openSettings,
    }),
    [enabled, permission, today, plan, enable, disable, sync],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
