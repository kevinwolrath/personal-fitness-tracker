import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../providers/AppProvider';
import { secrets } from '../platform/secrets';
import { useClock } from '../features/daily-log/useDay';
import { gameFrom, type Game } from './model';
import { weekStart } from '../progress/series';

export const GAME_PREFERENCE = 'pft.gamification.v1';
type Preference = { version: 1; enabled: boolean; seen: string[] };
type State = { enabled: boolean; ready: boolean; game: Game | null; error: string | null; setEnabled: (on: boolean) => void; celebration: { id: string; title: string; detail: string } | null; dismiss: () => void };
const Context = createContext<State | null>(null);
export const useGamification = () => useContext(Context);

/** Device preference v1. Tracking remains the sole source of reward truth; there is no XP database to migrate. */
export function GamificationProvider({ children }: { children: ReactNode }) {
  const { store, plan, dataVersion } = useApp();
  const { today } = useClock();
  const [pref, setPref] = useState<Preference | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<State['celebration']>(null);
  const initialized = useRef(false);
  const latest = useRef(pref); latest.current = pref;
  const writes = useRef(Promise.resolve());
  const save = useCallback((p: Preference) => {
    latest.current = p; setPref(p);
    writes.current = writes.current.catch(() => undefined).then(() => secrets.set(GAME_PREFERENCE, JSON.stringify(p))).then(() => setSaveError(null), () => setSaveError('Applied for this session. Could not save gamification settings; try again.'));
  }, []);
  useEffect(() => {
    let active = true;
    secrets.get(GAME_PREFERENCE).then(raw => {
      let p: Preference = { version: 1, enabled: false, seen: [] };
      try { const v = JSON.parse(raw ?? 'null'); if (v?.version === 1 && typeof v.enabled === 'boolean' && Array.isArray(v.seen)) p = { ...p, enabled: v.enabled, seen: v.seen.filter((x: unknown) => typeof x === 'string') }; } catch { /* old or invalid preferences start off */ }
      if (active) setPref(p);
    }, () => { if (active) setPref({ version: 1, enabled: false, seen: [] }); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!pref?.enabled) { setGame(null); setCelebration(null); initialized.current = false; return; }
    let active = true;
    store.snapshot().then(snapshot => {
      if (!active || !latest.current?.enabled) return;
      const next = gameFrom(snapshot,plan,today);
      setGame(next); setError(null);
      setCelebration(current => current && !next.earned.includes(current.id) ? null : current);
      const p = latest.current;
      // Only current quests can celebrate; correcting old history still adjusts totals and milestones.
      // Keep device preferences small enough for native secure storage instead of persisting a daily reward ledger.
      const levelPrefix = `level:${plan.id}:`;
      const highestSeen = p.seen.filter(id => id.startsWith(levelPrefix)).reduce((n,id) => Math.max(n,Number(id.slice(levelPrefix.length)) || 0),1);
      const eligible = next.earned.filter(id => {
        if (id.startsWith('quest:')) return id.includes(`:${today}:`);
        if (id.startsWith('week:')) return id.endsWith(`:${weekStart(today)}`);
        if (id.startsWith(levelPrefix)) return id === `${levelPrefix}${next.level}`;
        return true;
      });
      const unseen = eligible.filter(id => !p.seen.includes(id) && (!id.startsWith(levelPrefix) || next.level > highestSeen));
      // Initial opt-in/import/restart catches up quietly. Live record changes celebrate once, in a single panel.
      if (initialized.current && unseen.length) {
        const milestone = next.achievements.find(a => a.milestone && unseen.includes(`achievement:${a.id}`));
        const level = unseen.some(id => id.startsWith('level:'));
        const badge = next.achievements.find(a => unseen.includes(`achievement:${a.id}`));
        const id = milestone ? `achievement:${milestone.id}` : level ? `${levelPrefix}${next.level}` : badge ? `achievement:${badge.id}` : unseen[0];
        setCelebration({ id, title: milestone ? 'Milestone reached' : level ? 'Level up' : badge ? 'Achievement unlocked' : 'Quest complete', detail: milestone?.title ?? (level ? `Level ${next.level} · ${next.xp} XP` : badge?.title ?? 'A steady step forward. Recovery counts, too.') });
      }
      initialized.current = true;
      if (unseen.length) {
        const retained = p.seen.filter(id => {
          if (id.startsWith('quest:') || id.startsWith('week:')) return eligible.includes(id);
          if (id.startsWith(levelPrefix)) return Number(id.slice(levelPrefix.length)) === Math.max(highestSeen,next.level);
          return true;
        });
        save({ ...p, seen: [...new Set([...retained,...unseen])] });
      }
    }, () => { if (active) setError('Could not load achievements. Your tracking records are safe.'); });
    return () => { active = false; };
  }, [pref?.enabled, store, plan, today, dataVersion, save]);
  return <Context.Provider value={{ enabled: pref?.enabled ?? false, ready: !!pref, game, error: saveError ?? error, setEnabled: on => { if (latest.current) save({ ...latest.current, enabled: on }); }, celebration, dismiss: () => setCelebration(null) }}>{children}</Context.Provider>;
}
