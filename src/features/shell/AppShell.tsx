import { router, useGlobalSearchParams } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { buildExport } from '../../export/exportFormat';
import { localIsoTimestamp } from '../../format';
import { toLocalDate } from '../../plan/dates';
import { shareJson } from '../../platform/files';
import { useApp } from '../../providers/AppProvider';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Toast, type ToastState } from '../../ui/Toast';
import { colors, space, touch } from '../../ui/theme';
import { handOffScreenshots, pickScreenshots } from '../import/useImportSession';
import { AppMenu, type AppMenuItem } from './AppMenu';

const isDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

/**
 * App shell (contract 02 "Layout layers"): the persistent app bar and the app menu.
 * Screens render below the bar and own only their screen header and content; the bar never scrolls.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { store } = useApp();
  // The open Daily Log day, so an import defaults to it (contract 06).
  const params = useGlobalSearchParams<{ date?: string }>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmExport, setConfirmExport] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const clearToast = useCallback(() => setToast(null), []);

  const importScreenshots = async () => {
    const shots = await pickScreenshots();
    if (!shots) return; // cancelled: nothing happens
    handOffScreenshots(shots);
    const date = isDate(params.date) ? params.date : toLocalDate(new Date());
    router.push({ pathname: '/import', params: { date } });
  };
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
    { key: 'import', label: 'Import from screenshots', detail: 'Read values from fitness-app screenshots', onSelect: importScreenshots },
    { key: 'configure', label: 'Configure with AI', detail: 'Change your plan, equipment and goals', onSelect: () => router.push('/configure') },
    { key: 'export', label: 'Export all data', detail: 'Your complete history as a JSON file', onSelect: () => setConfirmExport(true) },
  ];

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
          <Text style={styles.appName} numberOfLines={1}>
            Personal Fitness Tracker
          </Text>
        </View>
      </SafeAreaView>

      <View style={styles.screen}>{children}</View>

      <SafeAreaView edges={['bottom']} style={styles.toastDock} pointerEvents="box-none">
        <Toast toast={toast} onDone={clearToast} />
      </SafeAreaView>
      <AppMenu visible={menuOpen} onClose={() => setMenuOpen(false)} items={items} />
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  bar: { backgroundColor: colors.bg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, paddingHorizontal: space.sm },
  barRow: { flexDirection: 'row', alignItems: 'center', height: touch, gap: space.xs },
  menuButton: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center' },
  burger: { width: 22, gap: 5 },
  line: { height: 2.5, borderRadius: 2, backgroundColor: colors.ink },
  appName: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.ink },
  screen: { flex: 1 },
  toastDock: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: space.lg },
});
