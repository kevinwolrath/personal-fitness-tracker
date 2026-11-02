import type { Reminder } from '../reminders/schedule';

/**
 * Web test surface: browsers can't deliver these local reminders, so this is an in-memory stand-in with the
 * same interface. It lets the E2E suite drive the real reconcile logic and simulate a tap
 * (`window.__pftReminders`). Permission answers "granted" unless a test sets `window.__pftDenyNotifications`.
 */
export type Permission = 'granted' | 'denied' | 'undetermined';
export type OpenedReminder = { date: string; activityId: string };

// Persisted like a phone keeps them across restarts, so restart/no-duplicate behaviour is testable.
const KEY = 'pft.test.notifications';
type Saved = { status: Permission; scheduled: Reminder[] };
const load = (): Saved => {
  try {
    return { status: 'undetermined', scheduled: [], ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { status: 'undetermined', scheduled: [] };
  }
};
const saved = load();
const scheduled = new Map<string, Reminder>(saved.scheduled.map((r) => [r.id, r]));
let status: Permission = saved.status;
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ status, scheduled: [...scheduled.values()] }));
  } catch {
    // storage unavailable: in-memory only
  }
};
const listeners = new Set<(r: OpenedReminder) => void>();

type TestHook = { scheduled: () => Reminder[]; open: (id: string) => void; status: () => Permission };
const w = (typeof window !== 'undefined' ? window : {}) as { __pftReminders?: TestHook; __pftDenyNotifications?: boolean };
w.__pftReminders = {
  scheduled: () => [...scheduled.values()],
  open: (id) => {
    const r = scheduled.get(id);
    if (r) listeners.forEach((cb) => cb({ date: r.date, activityId: r.activityId }));
  },
  status: () => status,
};

export const notifications = {
  real: false,
  async permission() {
    return { status, canAskAgain: status === 'undetermined' };
  },
  async request(): Promise<Permission> {
    status = w.__pftDenyNotifications ? 'denied' : 'granted';
    save();
    return status;
  },
  async scheduledIds() {
    return [...scheduled.keys()];
  },
  async cancel(ids: string[]) {
    ids.forEach((id) => scheduled.delete(id));
    save();
  },
  async schedule(r: Reminder) {
    scheduled.set(r.id, r);
    save();
  },
  onOpen(cb: (r: OpenedReminder) => void) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  async lastOpened(): Promise<OpenedReminder | null> {
    return null;
  },
  openSettings() {},
};
