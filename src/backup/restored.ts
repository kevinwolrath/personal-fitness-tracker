import { useEffect, useState } from 'react';

/**
 * After a full restore (#128) every screen, provider and cached preference must start again from the restored data.
 * The root layout keys the app on this epoch, so a restore remounts everything (stores, theme, gamification,
 * reminders) without restarting the process. The notice is shown once by the app shell after the remount.
 */
let epoch = 0;
let notice: string | null = null;
const listeners = new Set<(n: number) => void>();

export function signalRestored(message: string): void {
  notice = message;
  epoch += 1;
  listeners.forEach((l) => l(epoch));
}

export function useRestoreEpoch(): number {
  const [n, setN] = useState(epoch);
  useEffect(() => {
    listeners.add(setN);
    return () => {
      listeners.delete(setN);
    };
  }, []);
  return n;
}

/** The message for the toast after a restore, once. */
export function takeRestoreNotice(): string | null {
  const n = notice;
  notice = null;
  return n;
}
