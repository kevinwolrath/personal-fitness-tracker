import { router } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { toLocalDate } from '../../plan/dates';
import { useApp } from '../../providers/AppProvider';
import { Toast, type ToastState } from '../../ui/Toast';
import { space, touch, createThemedStyles } from '../../ui/theme';
import { TabBar } from './TabBar';
import { useTrendAlert } from '../progress/useTrendAlert';
import { useClock } from '../daily-log/useDay';
import { AppMenu, type AppMenuItem } from './AppMenu';
import { MuscleGrowthEditor } from '../muscle-growth/MuscleGrowthEditor';
import { HealthSyncSheet } from '../health-sync/HealthSyncSheet';
import { takeRestoreNotice } from '../../backup/restored';
import { inventoryFor } from '../../exercises/catalogue';
import { HealthConnectProvider, useHealthConnect } from '../health-connect/HealthConnectProvider';
import { HealthConnectSheet, healthConnectStatus } from '../health-connect/HealthConnectSheet';
import { APP_NAME } from '../../brand';
import { CoverageSheet } from '../muscles/CoverageSheet';
import { ShareReceiver } from '../meal-photo/ShareReceiver';
import { secrets } from '../../platform/secrets';
import { syncStatus } from '../../healthSync/service';
import { syncSummary } from '../../healthSync/summary';


/**
 * App shell (contract 02 "Layout layers"): the persistent app bar and the app menu.
 * Screens render below the bar and own only their screen header and content; the bar never scrolls.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <HealthConnectProvider>
      <Shell>{children}</Shell>
    </HealthConnectProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [growthOpen, setGrowthOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const styles = useStyles();

  const { store, plan } = useApp();
  const healthConnect = useHealthConnect();
  const [healthConnectOpen, setHealthConnectOpen] = useState(false);
  const now = new Date();
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const clearToast = useCallback(() => setToast(null), []);
  // After a full restore the app remounts (#128): say what happened, once.
  useEffect(() => {
    const notice = takeRestoreNotice();
    if (notice) setToast({ key: Date.now(), message: notice });
  }, []);

  // #174: the Health data sync row says when this phone last synced; read when the menu opens.
  const [syncDetail, setSyncDetail] = useState(() => syncSummary(null, new Date()));
  useEffect(() => {
    if (!menuOpen) return;
    let live = true;
    syncStatus(secrets).then((st) => live && setSyncDetail(syncSummary(st, new Date())), () => undefined);
    return () => { live = false; };
  }, [menuOpen, syncOpen]);
  const items: AppMenuItem[] = [
    {
      key: 'muscle-growth',
      group: 'Training',
      label: 'Muscle Growth',
      detail: plan.exercise?.muscleGrowth?.enabled ? `On · ${plan.exercise.muscleGrowth.targets.map((t) => inventoryFor(plan).muscleGroups.find((m) => m.id === t)?.label ?? t).join(', ')}` : 'Targeted routine for chosen muscles',
      onSelect: () => setGrowthOpen(true),
    },
    { key: 'coverage', group: 'Training', label: 'Muscle coverage & exercise log', detail: 'Coverage, recovery and eligible exercises', onSelect: () => setCoverageOpen(true) },
    { key: 'health-sync', group: 'Sync & Share', label: 'Health data sync', detail: syncDetail, onSelect: () => setSyncOpen(true) },
    { key: 'health-connect', group: 'Sync & Share', label: 'Health Connect', detail: healthConnectStatus(healthConnect), onSelect: () => setHealthConnectOpen(true) },
    { key: 'settings', label: 'Settings', detail: 'Plan & goals, My Gym, reminders, preferences, data', onSelect: () => router.push('/settings') },
  ];

  // #57 option b: a dot on Progress for a new weight-trend finding (and one notification when allowed).
  const { today: clockToday } = useClock();
  const trendDot = useTrendAlert(clockToday);

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.bar} testID="app-bar">
        <View style={styles.barRow}>
          <Pressable onPress={() => setMenuOpen(true)} style={styles.menuButton} accessibilityRole="button" accessibilityLabel="Menu" testID="menu-button">
            <View style={styles.burger}>
              <View style={styles.line} />
              <View style={styles.line} />
              <View style={styles.line} />
            </View>
          </Pressable>
          <Text style={styles.appName} numberOfLines={1} testID="app-name">
            {APP_NAME}
          </Text>
        </View>
      </SafeAreaView>

      <View style={styles.screen}>{children}</View>
      <TabBar badges={{ '/progress': trendDot }} />

      <SafeAreaView edges={['bottom']} style={styles.toastDock} pointerEvents="box-none">
        <Toast toast={toast} onDone={clearToast} />
      </SafeAreaView>
      <ShareReceiver />
      <AppMenu visible={menuOpen} onClose={() => setMenuOpen(false)} items={items} />
      {syncOpen && <HealthSyncSheet store={store} onClose={() => setSyncOpen(false)} />}
      {growthOpen && <MuscleGrowthEditor onClose={() => setGrowthOpen(false)} />}
      {coverageOpen && <CoverageSheet date={toLocalDate(now)} editable onClose={() => setCoverageOpen(false)} />}
      <HealthConnectSheet visible={healthConnectOpen} onClose={() => setHealthConnectOpen(false)} />
    </View>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => ({
  root: { flex: 1, backgroundColor: colors.bg },
  bar: { backgroundColor: colors.bg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, paddingHorizontal: space.sm },
  barRow: { flexDirection: 'row', alignItems: 'center', height: touch, gap: space.xs },
  menuButton: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center' },
  burger: { width: 22, gap: 5 },
  line: { height: 2.5, borderRadius: 2, backgroundColor: colors.ink },
  appName: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.ink },
  screen: { flex: 1 },
  toastDock: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: space.lg },
}));
