import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { secrets } from '../platform/secrets';
import { resolveTheme, themes, type ThemeId } from './theme';
import { ThemeContext } from './ThemeContext';

export const THEME_PREFERENCE = 'pft.display.theme';
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<ThemeId>('hero-forge');
  const [ready, setReady] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const changed = useRef(false);
  const mounted = useRef(true);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    let live = true;
    mounted.current = true;
    secrets.get(THEME_PREFERENCE).catch(() => null).then(value => {
      if (!live) return;
      if (!changed.current) setId(resolveTheme(value));
      setReady(true);
    });
    return () => { live = false; mounted.current = false; };
  }, []);
  const setTheme = useCallback((next: ThemeId) => {
    changed.current = true;
    setId(resolveTheme(next));
    setSaveError(false);
    // Serialize rapid taps so a slower old write cannot overwrite the last selection.
    writes.current = writes.current.catch(() => undefined).then(async () => {
      try { await secrets.set(THEME_PREFERENCE, resolveTheme(next)); if (mounted.current) setSaveError(false); }
      catch { if (mounted.current) setSaveError(true); }
    });
  }, []);
  const value = useMemo(() => ({ ...themes[id], setTheme, ready, saveError }), [id, setTheme, ready, saveError]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
