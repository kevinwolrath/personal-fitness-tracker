import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { loadActivePlan } from '../plan/bootstrap';
import type { Plan } from '../plan/schema';
import { openStore } from '../storage/openStore';
import type { TrackingStore } from '../storage/types';
import { colors, space, type } from '../ui/theme';

type AppData = { store: TrackingStore; plan: Plan };
const AppContext = createContext<AppData | null>(null);

export function useApp(): AppData {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp outside AppProvider');
  return ctx;
}

/** Opens storage and loads the active plan (installing the seed on first run). */
export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppData | { error: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const store = await openStore();
      const plan = await loadActivePlan(store);
      if (!cancelled) setState({ store, plan });
    })().catch((e: unknown) => !cancelled && setState({ error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }
  if ('error' in state) {
    return (
      <View style={styles.center}>
        <Text style={type.body}>Couldn't load your plan</Text>
        <Text style={[type.detail, styles.error]}>{state.error}</Text>
      </View>
    );
  }
  return <AppContext.Provider value={state}>{children}</AppContext.Provider>;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, backgroundColor: colors.bg },
  error: { marginTop: space.sm, textAlign: 'center' },
});
