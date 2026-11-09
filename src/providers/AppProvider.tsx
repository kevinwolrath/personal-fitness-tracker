import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { EnergyDisplay } from '../energy';
import { loadActivePlan } from '../plan/bootstrap';
import { preferences } from '../platform/preferences';
import { planSchema, type Plan } from '../plan/schema';
import { openStore } from '../storage/openStore';
import type { TrackingStore } from '../storage/types';
import { space, useTheme, createThemedStyles } from '../ui/theme';
import { SetupWizard } from '../features/onboarding/SetupWizard';
import { BrandLoading } from '../ui/BrandLoading';
import * as SplashScreen from 'expo-splash-screen';
import { observableStore } from '../storage/observableStore';
import { GamificationProvider } from '../gamification/GamificationProvider';

type AppData = {
  store: TrackingStore;
  plan: Plan;
  /** Re-read the active plan after it changed (e.g. a configuration update was applied or undone). */
  reloadPlan: () => Promise<void>;
  /**
   * How energy is shown on this phone (#39): a device preference, never plan data. Until the user picks one it
   * is the plan's own `units.energy`, so nothing changes for anyone who hasn't chosen.
   */
  energy: EnergyDisplay;
  /** Applies immediately everywhere and is remembered across restarts. Stored values never change. */
  setEnergy: (d: EnergyDisplay) => void;
  /** Bumped when records change outside a screen's own actions (a Health Connect sync), so open days reload. */
  dataVersion: number;
  notifyDataChanged: () => void;
};
const AppContext = createContext<AppData | null>(null);

export function useApp(): AppData {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp outside AppProvider');
  return ctx;
}

/**
 * Opens storage and loads the active plan. With no plan yet (a fresh install) it shows first-run setup (#49)
 * instead of the app; setup creates the user's own plan and then the app opens on Today.
 */
export function AppProvider({ children }: { children: ReactNode }) {
  const { colors, type } = useTheme();
  const styles = useStyles();

  const [state, setState] = useState<{ store: TrackingStore; plan: Plan } | { store: TrackingStore; plan: null } | { error: string } | null>(null);
  const [chosenEnergy, setChosenEnergy] = useState<EnergyDisplay | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  useEffect(() => { if (state) SplashScreen.hideAsync().catch(() => undefined); }, [state]);
  const notifyDataChanged = useCallback(() => setDataVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const store = observableStore(await openStore(), notifyDataChanged);
      const [plan, energy] = await Promise.all([loadActivePlan(store), preferences.energyDisplay().catch(() => null)]);
      if (cancelled) return;
      setChosenEnergy(energy);
      setState({ store, plan });
    })().catch((e: unknown) => !cancelled && setState({ error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, []);

  const reloadPlan = useCallback(async () => {
    if (!state || 'error' in state || !state.plan) return;
    const stored = await state.store.getActivePlan();
    if (stored) setState({ store: state.store, plan: planSchema.parse(JSON.parse(stored.json)) });
  }, [state]);
  const setEnergy = useCallback((d: EnergyDisplay) => {
    setChosenEnergy(d);
    preferences.setEnergyDisplay(d).catch(() => undefined); // still applies for this session if storage fails
  }, []);
  const value = useMemo(
    () => (state && !('error' in state) && state.plan ? { store: state.store, plan: state.plan, reloadPlan, energy: chosenEnergy ?? state.plan.units.energy, setEnergy, dataVersion, notifyDataChanged } : null),
    [state, reloadPlan, chosenEnergy, setEnergy, dataVersion, notifyDataChanged],
  );

  if (!state) {
    return <BrandLoading />;
  }
  if ('error' in state) {
    return (
      <View style={styles.center}>
        <Text style={type.body}>Couldn't load your plan</Text>
        <Text style={[type.detail, styles.error]}>{state.error}</Text>
      </View>
    );
  }
  if (!state.plan || !value) {
    return <SetupWizard store={state.store} energy={chosenEnergy ?? 'kJ'} onFinished={(plan) => setState({ store: state.store, plan })} />;
  }
  return <AppContext.Provider value={value}><GamificationProvider>{children}</GamificationProvider></AppContext.Provider>;
}

const useStyles = createThemedStyles(({ colors, type }) => ({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, backgroundColor: colors.bg },
  error: { marginTop: space.sm, textAlign: 'center' },
}));
