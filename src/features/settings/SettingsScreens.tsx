import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { planSummary } from '../../config/planSummary';
import { energyDisplayDetail } from '../../energy';
import { buildExport } from '../../export/exportFormat';
import { localIsoTimestamp } from '../../format';
import { toLocalDate } from '../../plan/dates';
import { shareJson } from '../../platform/files';
import { useApp } from '../../providers/AppProvider';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Toast, type ToastState } from '../../ui/Toast';
import { radius, space, useTheme, createThemedStyles } from '../../ui/theme';
import { BackupSheet } from '../backup/BackupSheet';
import { MyGymSheet } from '../my-gym/MyGymSheet';
import { useReminders } from '../reminders/RemindersProvider';
import { RemindersSheet, remindersStatus } from '../reminders/RemindersSheet';
import { AppPreferences } from './AppPreferences';
import { SettingsPage, SettingsRow, SettingsSection } from './SettingsPage';

/**
 * Settings (#174, contract 02): the landing page for infrequent setup, preferences and data maintenance. Each row
 * opens a subpage (a stack route, so Android back and deep links work) or the feature's existing sheet.
 */
export function SettingsScreen() {
  const { plan, energy } = useApp();
  const { id: themeId } = useTheme();
  const reminders = useReminders();
  const [gymOpen, setGymOpen] = useState(false);
  const [remindersOpen, setRemindersOpen] = useState(false);
  const now = new Date();
  return (
    <SettingsPage title="Settings" back="/" testID="settings-screen">
      <View>
        <SettingsRow label="Plan & goals" detail={`${plan.title} · targets and goals`} onPress={() => router.push('/settings/plan')} testID="settings-plan" />
        <SettingsRow label="My Gym" detail="Equipment and the exercises it allows" onPress={() => setGymOpen(true)} testID="settings-my-gym" />
        <SettingsRow label="Reminders" detail={remindersStatus(reminders, now.getHours() * 60 + now.getMinutes())} onPress={() => setRemindersOpen(true)} testID="settings-reminders" />
        <SettingsRow label="App preferences" detail={`${themeId === 'classic' ? 'Classic light' : 'Hero Forge'} · ${energyDisplayDetail(energy)}`} onPress={() => router.push('/settings/preferences')} testID="settings-preferences" />
        <SettingsRow label="Data management" detail="Back up, restore and export your data" onPress={() => router.push('/settings/data')} testID="settings-data" />
      </View>
      {gymOpen && <MyGymSheet onClose={() => setGymOpen(false)} />}
      <RemindersSheet visible={remindersOpen} onClose={() => setRemindersOpen(false)} />
    </SettingsPage>
  );
}

/** Plan & goals: the plan's targets and goals at a glance; changing them is Configure with AI or Edit setup answers. */
export function PlanGoalsScreen() {
  const { plan, energy } = useApp();
  const { type } = useTheme();
  const styles = useStyles();
  const s = planSummary(plan, energy);
  return (
    <SettingsPage title="Plan & goals" back="/settings" testID="settings-plan-screen">
      <View>
        <SettingsRow label="Configure with AI" detail="Change your plan, equipment and goals" onPress={() => router.push('/configure')} testID="settings-configure" />
        <SettingsRow label="Edit setup answers" detail="Rebuild your starter plan from new answers" onPress={() => router.push('/setup')} testID="settings-setup" />
      </View>
      <SettingsSection title="Current plan">
        <View style={styles.card} testID="plan-summary">
          <Text style={type.body}>{s.title}</Text>
          {s.targets.length === 0 && s.goals.length === 0 && <Text style={type.detail}>No daily targets or goals in this plan.</Text>}
          {s.targets.map((t) => <Text key={t} style={type.detail}>{t}</Text>)}
          {s.goals.map((g) => <Text key={g} style={type.detail}>{g}</Text>)}
        </View>
      </SettingsSection>
    </SettingsPage>
  );
}

/** App preferences: Quests, appearance, energy units and weight-trend alerts (device choices, never plan data). */
export function PreferencesScreen() {
  return (
    <SettingsPage title="App preferences" back="/settings" testID="settings-preferences-screen">
      <AppPreferences />
    </SettingsPage>
  );
}

/** Data management: back up, restore and export. Frequent sync and sharing stay in the menu's Sync & Share. */
export function DataScreen() {
  const { store } = useApp();
  const styles = useStyles();
  const [backupMode, setBackupMode] = useState<'backup' | 'restore' | null>(null);
  const [confirmExport, setConfirmExport] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const clearToast = useCallback(() => setToast(null), []);
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
  return (
    <SettingsPage
      title="Data management"
      back="/settings"
      testID="settings-data-screen"
      footer={
        <SafeAreaView edges={['bottom']} style={styles.toastDock} pointerEvents="box-none">
          <Toast toast={toast} onDone={clearToast} />
        </SafeAreaView>
      }
    >
      <View>
        <SettingsRow label="Back up data" detail="Everything, with meal photos, in one file" onPress={() => setBackupMode('backup')} testID="settings-backup" />
        <SettingsRow label="Restore data" detail="Replace this phone's data from a backup" onPress={() => setBackupMode('restore')} testID="settings-restore" />
        <SettingsRow label="Export all data" detail="Readable JSON history (not a full backup)" onPress={() => setConfirmExport(true)} testID="settings-export" />
      </View>
      {backupMode && <BackupSheet store={store} mode={backupMode} onClose={() => setBackupMode(null)} onRestored={() => router.replace('/')} />}
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
    </SettingsPage>
  );
}

const useStyles = createThemedStyles(({ colors }) => ({
  card: { gap: space.xs, padding: space.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  toastDock: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: space.lg },
}));
