import { usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { fromCanonical } from '../../observations/units';
import type { LocalDate } from '../../plan/dates';
import { notifications } from '../../platform/notifications';
import { preferences } from '../../platform/preferences';
import { shouldAlert, trendInsight } from '../../progress/forecast';
import { dailySeries } from '../../progress/series';
import { useApp } from '../../providers/AppProvider';

/**
 * Weight-trend alerts (#57, option b): a dot on the Progress tab while a new plateau or slowdown hasn't been seen,
 * and one phone notification for it, only when notifications are already allowed. At most once a week, once per
 * finding, only with fresh weigh-ins; can be turned off in Settings. Never changes the plan.
 */
export function useTrendAlert(today: LocalDate): boolean {
  const { store, plan, dataVersion } = useApp();
  const path = usePathname();
  const [key, setKey] = useState<string | null>(null);
  const [seen, setSeen] = useState<string | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    let live = true;
    (async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        if (!(await preferences.trendAlerts())) return live ? setKey(null) : undefined;
        const mass = plan.units.mass;
        const weights = dailySeries(await store.observationsFor(['weight']), 'weight').map((p) => ({ ...p, value: fromCanonical(p.value, mass, 'mass') ?? p.value }));
        const insight = trendInsight(weights, today, mass);
        const state = await preferences.trendAlertState();
        if (!live) return;
        setKey(insight.alertKey);
        setSeen(state.seenKey);
        const last = state.lastKey && state.lastAt ? { key: state.lastKey, at: state.lastAt } : null;
        if (shouldAlert(insight, weights, today, last)) {
          await notifications.notifyNow(`trend|${insight.alertKey}`, `Weight trend: ${insight.title.toLowerCase()}`, 'See what you can try in Progress. Nothing changes in your plan unless you change it.').catch(() => false);
          await preferences.setTrendAlertState({ ...state, lastKey: insight.alertKey, lastAt: today });
        }
      } finally {
        busy.current = false;
      }
    })();
    return () => {
      live = false;
    };
  }, [store, plan, today, dataVersion]);

  // Opening Progress marks the finding seen.
  useEffect(() => {
    if (!key || !path.startsWith('/progress') || seen === key) return;
    setSeen(key);
    preferences.trendAlertState().then((s) => preferences.setTrendAlertState({ ...s, seenKey: key })).catch(() => undefined);
  }, [path, key, seen]);

  return !!key && seen !== key;
}
