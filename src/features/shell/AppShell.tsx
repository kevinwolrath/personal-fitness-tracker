import { router } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { buildExport } from '../../export/exportFormat';
import { localIsoTimestamp } from '../../format';
import { toLocalDate } from '../../plan/dates';
import { shareJson } from '../../platform/files';
import { useApp } from '../../providers/AppProvider';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Toast, type ToastState } from '../../ui/Toast';
import { space, touch, createThemedStyles } from '../../ui/theme';
import { TabBar } from './TabBar';
import { useTrendAlert } from '../progress/useTrendAlert';
import { useClock } from '../daily-log/useDay';
import { AppMenu, type AppMenuItem } from './AppMenu';
import { MyGymSheet } from '../my-gym/MyGymSheet';
import { RemindersProvider, useReminders } from '../reminders/RemindersProvider';
import { RemindersSheet, remindersStatus } from '../reminders/RemindersSheet';
import { SettingsSheet } from '../settings/SettingsSheet';
import { MuscleGrowthEditor } from '../muscle-growth/MuscleGrowthEditor';
import { BackupSheet } from '../backup/BackupSheet';
import { HealthSyncSheet } from '../health-sync/HealthSyncSheet';
import { takeRestoreNotice } from '../../backup/restored';
import { inventoryFor } from '../../exercises/catalogue';
import { HealthConnectProvider, useHealthConnect } from '../health-connect/HealthConnectProvider';
import { HealthConnectSheet, healthConnectStatus } from '../health-connect/HealthConnectSheet';
import { energyDisplayDetail } from '../../energy';
import { APP_NAME } from '../../brand';
import { CoverageSheet } from '../muscles/CoverageSheet';


/**
 * App shell (contract 02 "Layout layers"): the persistent app bar and the app menu.
 * Screens render below the bar and own only their screen header and content; the bar never scrolls.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <RemindersProvider>
      <HealthConnectProvider>
        <Shell>{children}</Shell>
      </HealthConnectProvider>
    </RemindersProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [growthOpen, setGrowthOpen] = useState(false);
  const [gymOpen, setGymOpen] = useState(false);
  const [backupMode, setBackupMode] = useState<'backup' | 'restore' | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const styles = useStyles();

  const { store, energy, plan } = useApp();
  const reminders = useReminders();
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const healthConnect = useHealthConnect();
  const [healthConnectOpen, setHealthConnectOpen] = useState(false);
  const now = new Date();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmExport, setConfirmExport] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const clearToast = useCallback(() => setToast(null), []);
  // After a full restore the app remounts (#128): say what happened, once.
  useEffect(() => {
    const notice = takeRestoreNotice();
    if (notice) setToast({ key: Date.now(), message: notice });
  }, []);

  const exportAll = async () => {
    const today = toLocalDate(new Date());
    try {
      const doc = buildExport(await store.snapshot(), { exportedAt: localIsoTimestamp(), today, appVersion: '0.1.0' });
      await shareJson(`fitness-export-${today}.json`, JSON.stringify(doc, null, 2));
      setToast({ key: Date.now(), message: `Exported ${doc.counts.observations + doc.counts.activityLogs + doc.counts.quickLogs} records` });
    } catch {
      setToast({ key: Date.now(), message: "Export didn't complete" });
    }
  };
  const items: AppMenuItem[] = [
    { key: 'health-connect', label: 'Health Connect', detail: healthConnectStatus(healthConnect), onSelect: () => setHealthConnectOpen(true) },
    { key: 'configure', label: 'Configure with AI', detail: 'Change your plan, equipment and goals', onSelect: () => router.push('/configure') },
    { key: 'my-gym', label: 'My Gym', detail: 'Equipment access for all your training', onSelect: () => setGymOpen(true) },
    { key: 'setup', label: 'Edit setup answers', detail: 'Rebuild your starter plan from new answers', onSelect: () => router.push('/setup') },
    {
      key: 'reminders',
      label: 'Reminders',
      detail: remindersStatus(reminders, now.getHours() * 60 + now.getMinutes()),
      onSelect: () => setRemindersOpen(true),
    },
    { key: 'settings', label: 'Settings', detail: energyDisplayDetail(energy), onSelect: () => setSettingsOpen(true) },
    {
      key: 'muscle-growth',
      label: 'Muscle Growth',
      detail: plan.exercise?.muscleGrowth?.enabled ? `On · ${plan.exercise.muscleGrowth.targets.map((t) => inventoryFor(plan).muscleGroups.find((m) => m.id === t)?.label ?? t).join(', ')}` : 'Targeted routine for chosen muscles',
      onSelect: () => setGrowthOpen(true),
    },
    { key: 'coverage', label: 'Muscle coverage & exercise log', detail: 'Coverage, recovery and eligible exercises', onSelect: () => setCoverageOpen(true) },
    { key: 'backup', label: 'Back up data', detail: 'Everything, with meal photos, in one file', onSelect: () => setBackupMode('backup') },
    { key: 'restore', label: 'Restore data', detail: "Replace this phone's data from a backup", onSelect: () => setBackupMode('restore') },
    { key: 'health-sync', label: 'Health data sync', detail: 'Private server copy and read-only AI links', onSelect: () => setSyncOpen(true) },
    { key: 'export', label: 'Export all data', detail: 'Readable JSON history (not a full backup)', onSelect: () => setConfirmExport(true) },
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
      <AppMenu visible={menuOpen} onClose={() => setMenuOpen(false)} items={items} />
      <RemindersSheet visible={remindersOpen} onClose={() => setRemindersOpen(false)} />
      <SettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {backupMode && <BackupSheet store={store} mode={backupMode} onClose={() => setBackupMode(null)} />}
      {syncOpen && <HealthSyncSheet store={store} onClose={() => setSyncOpen(false)} />}
      {gymOpen && <MyGymSheet onClose={() => setGymOpen(false)} />}
      {growthOpen && <MuscleGrowthEditor onClose={() => setGrowthOpen(false)} />}
      {coverageOpen && <CoverageSheet date={toLocalDate(now)} editable onClose={() => setCoverageOpen(false)} />}
      <HealthConnectSheet visible={healthConnectOpen} onClose={() => setHealthConnectOpen(false)} />
      <ConfirmDialog
        visible={confirmExport}
        title="Export all fitness data?"
        message="This creates a JSON file containing your complete fitness-tracker history, configuration and recorded observations."
        confirmLabel="Export JSON"
        onCancel={() => setConfirmExport(false)}
        onConfirm={() => {
          setConfirmExport(false);
          exportAll();
        }}
      />
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
