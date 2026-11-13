import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../providers/AppProvider';
import { secrets } from '../platform/secrets';
import { useClock } from '../features/daily-log/useDay';
import { gameFrom, type Game } from './model';
import { weekStart } from '../progress/series';

export const GAME_PREFERENCE = 'pft.gamification.v1';
type Preference = { version: 1; enabled: boolean; seen: string[] };
type State = { enabled: boolean; ready: boolean; game: Game | null; error: string | null; loading: boolean; loadFailed: boolean; retry: () => void; setEnabled: (on: boolean) => void; celebration: { id: string; title: string; detail: string } | null; dismiss: () => void };

/** #176: how long loading may take before the card offers Retry instead of waiting forever. */
export const LOAD_TIMEOUT_MS = 20_000;
export const LOAD_ERROR = 'Couldn’t load quests. Your tracking records are safe. Try again.';
/** Diagnostics for each loading step (#176): step, outcome, elapsed time and counts only, never health data. */
const trace = (step: string, details: Record<string, string | number | boolean>) => console.info(`[quests] ${step}`, JSON.stringify(details));
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
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
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
    let settled = false;
    const started = Date.now();
    setLoading(true);
    trace('load start', { attempt });
    // A store that never answers must not leave an endless spinner: offer Retry; a late answer still loads.
    const watchdog = setTimeout(() => {
      if (!active || settled) return;
      trace('load stalled', { ms: Date.now() - started });
      setError(LOAD_ERROR);
      setLoading(false);
    }, LOAD_TIMEOUT_MS);
    store.snapshot().then(snapshot => {
      settled = true;
      clearTimeout(watchdog);
      if (!active || !latest.current?.enabled) return;
      trace('snapshot ok', { ms: Date.now() - started, activityLogs: snapshot.activityLogs.length, observations: snapshot.observations.length, configChanges: snapshot.configChanges.length });
      const computeStart = Date.now();
      const next = gameFrom(snapshot,plan,today);
      trace('quests ok', { ms: Date.now() - computeStart, quests: next.quests.length, achievements: next.achievements.length });
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
    }).catch((e: unknown) => {
      // #176: a failure in the snapshot *or in building the game* (a throw inside the handler above) lands here.
      // It used to escape as an unhandled rejection and leave "Loading quests…" forever.
      settled = true;
      clearTimeout(watchdog);
      if (!active) return;
      trace('load failed', { ms: Date.now() - started, error: e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 200) : 'unknown' });
      setError(LOAD_ERROR);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; clearTimeout(watchdog); };
  }, [pref?.enabled, store, plan, today, dataVersion, save, attempt]);
  return <Context.Provider value={{ enabled: pref?.enabled ?? false, ready: !!pref, game, error: saveError ?? error, loading, loadFailed: error !== null, retry: () => setAttempt(n => n + 1), setEnabled: on => { if (latest.current) save({ ...latest.current, enabled: on }); }, celebration, dismiss: () => setCelebration(null) }}>{children}</Context.Provider>;
}
