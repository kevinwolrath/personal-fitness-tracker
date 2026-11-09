import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import { parseLocalDate } from '../plan/dates';
import type { Reminder } from '../reminders/schedule';

/**
 * Local notifications (native). Plan-driven reminders only: no push server, no network (contract 10).
 * See notifications.web.ts for the web test surface's stand-in.
 */
export type Permission = 'granted' | 'denied' | 'undetermined';
export type OpenedReminder = { date: string; activityId: string };

const CHANNEL = 'reminders';
let ready: Promise<void> | null = null;

/** Show reminders that arrive while the app is open, too; create the Android channel once. */
function setup(): Promise<void> {
  ready ??= (async () => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Reminders', importance: Notifications.AndroidImportance.DEFAULT });
    }
  })();
  return ready;
}

const toOpened = (data: unknown): OpenedReminder | null => {
  const d = data as Partial<OpenedReminder> | undefined;
  return d && typeof d.date === 'string' && typeof d.activityId === 'string' ? { date: d.date, activityId: d.activityId } : null;
};

export const notifications = {
  /** Whether this surface can deliver real notifications. */
  real: true,

  async permission(): Promise<{ status: Permission; canAskAgain: boolean }> {
    const p = await Notifications.getPermissionsAsync();
    return { status: p.granted ? 'granted' : p.status === 'undetermined' ? 'undetermined' : 'denied', canAskAgain: p.canAskAgain };
  },

  /** Asks the OS. Only ever called from an explicit "Turn on reminders" (never on launch). */
  async request(): Promise<Permission> {
    await setup();
    const p = await Notifications.requestPermissionsAsync();
    return p.granted ? 'granted' : p.status === 'undetermined' ? 'undetermined' : 'denied';
  },

  async scheduledIds(): Promise<string[]> {
    return (await Notifications.getAllScheduledNotificationsAsync()).map((n) => n.identifier);
  },

  async cancel(ids: string[]): Promise<void> {
    await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id)));
  },

  /** Schedules at the reminder's local date and time (inexact on Android: no exact-alarm permission). */
  async schedule(r: Reminder): Promise<void> {
    await setup();
    const at = parseLocalDate(r.date);
    at.setHours(Math.floor(r.minute / 60), r.minute % 60, 0, 0);
    await Notifications.scheduleNotificationAsync({
      identifier: r.id,
      content: { title: r.title, body: r.body, data: { date: r.date, activityId: r.activityId } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL },
    });
  },

  /** Taps on a reminder while the app runs. Returns an unsubscribe function. */
  onOpen(cb: (r: OpenedReminder) => void): () => void {
    const sub = Notifications.addNotificationResponseReceivedListener((res) => {
      const r = toOpened(res.notification.request.content.data);
      if (r) cb(r);
    });
    return () => sub.remove();
  },

  /** The tap that launched the app, if any. */
  async lastOpened(): Promise<OpenedReminder | null> {
    const res = await Notifications.getLastNotificationResponseAsync();
    return res ? toOpened(res.notification.request.content.data) : null;
  },

  /**
   * Show one notification now (#57 trend alerts), only if notifications are already allowed: never asks. Its id has
   * no reminder prefix, so reminder reconciling never touches it.
   */
  async notifyNow(id: string, title: string, body: string): Promise<boolean> {
    const p = await Notifications.getPermissionsAsync();
    if (!p.granted) return false;
    await setup();
    await Notifications.scheduleNotificationAsync({ identifier: id, content: { title, body, data: { open: 'progress' } }, trigger: null });
    return true;
  },

  openSettings(): void {
    Linking.openSettings();
  },
};
