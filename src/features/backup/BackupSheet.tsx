import { useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import type { BackupManifest } from '../../backup/archive';
import { signalRestored } from '../../backup/restored';
import { EXCLUDED_FROM_BACKUP, createBackup, previewBackup, restoreBackup, type RestorePreview } from '../../backup/service';
import { localIsoTimestamp } from '../../format';
import { toLocalDate } from '../../plan/dates';
import { backupIO, pickBackupFile, saveBackupFile } from '../../platform/backupFiles';
import { newId, type TrackingStore } from '../../storage/types';
import { Button } from '../../ui/Button';
import { ModalHeader } from '../../ui/ModalHeader';
import { ScrollView } from '../../ui/ScrollView';
import { Sheet } from '../../ui/Sheet';
import { createThemedStyles, radius, space, useTheme } from '../../ui/theme';

const APP_VERSION = '0.1.0';
const RECORD_KEYS = ['observations', 'activityLogs', 'dayOverrides', 'quickLogs', 'imports', 'configChanges', 'completionEvents', 'daySnapshots', 'exerciseLogs', 'muscleReports', 'mealLogs'];
const records = (c: Record<string, number>) => RECORD_KEYS.reduce((n, k) => n + (c[k] ?? 0), 0);
const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`);
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};
const n = (x: number | undefined, one: string, many = `${one}s`) => `${(x ?? 0).toLocaleString()} ${(x ?? 0) === 1 ? one : many}`;

/** What a backup holds, in words, for the success screen and the restore preview. */
function Contents({ m }: { m: BackupManifest }) {
  const { type } = useTheme();
  const c = m.counts;
  const lines = [
    `${n(records(c), 'record')}${m.range.from ? `, ${m.range.from} to ${m.range.to}` : ''}`,
    `${n(c.mealLogs, 'meal')} with ${n(c.mealPhotos, 'photo')}`,
    `${n(c.exerciseLogs, 'exercise log')}, ${n(c.activityLogs, 'activity record')}`,
    `${n(c.observations, 'measurement or imported value', 'measurements and imported values')}`,
    `${n(c.planVersions, 'plan version')}, ${n(c.preferences, 'setting')}`,
    `${size(c.bytes ?? 0)}`,
  ];
  return (
    <View testID="backup-contents">
      {lines.map((l) => (
        <Text key={l} style={type.detail}>
          • {l}
        </Text>
      ))}
    </View>
  );
}

/**
 * Back up data / Restore data (#128). Back up: one ZIP with everything the app keeps, shared or saved through the
 * system. Restore: pick a file, check it completely, preview it, then replace everything after an explicit
 * confirmation. Nothing changes until "Replace my data", and a failed restore puts the previous data back.
 */
/** `store` is passed in: first-run setup (no plan yet, no app context) can restore too. */
export function BackupSheet({ store, mode: initialMode, onClose }: { store: TrackingStore; mode: 'backup' | 'restore'; onClose: () => void }) {
  const { type } = useTheme();
  const styles = useStyles();
  const [mode, setMode] = useState(initialMode);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ manifest: BackupManifest; fileName: string } | null>(null);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [current, setCurrent] = useState<number | null>(null);
  const running = useRef(false);

  const run = async (fn: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      running.current = false;
      setBusy(null);
    }
  };

  const backUp = () =>
    run(async () => {
      setBusy('Starting…');
      const now = new Date();
      const b = await createBackup(store, backupIO, { createdAt: localIsoTimestamp(), today: toLocalDate(now), appVersion: APP_VERSION }, setBusy);
      setBusy('Opening save and share…');
      const r = await saveBackupFile(b.fileName, b.bytes);
      if (r === 'unavailable') throw new Error("This phone can't save or share files here. Nothing was lost; try again later.");
      setMade({ manifest: b.manifest, fileName: b.fileName });
    });

  const choose = () =>
    run(async () => {
      setPreview(null);
      const picked = await pickBackupFile();
      if (!picked) return; // cancelled: nothing happens
      setBusy('Checking the backup…');
      await new Promise((r) => setTimeout(r, 0)); // let the progress show before the work
      const p = previewBackup(picked.bytes);
      if (!p.ok) throw new Error(p.error);
      const now = await store.snapshot();
      setCurrent(records({ observations: now.observations.length, activityLogs: now.activityLogs.length, mealLogs: (now.mealLogs ?? []).length, exerciseLogs: (now.exerciseLogs ?? []).length, quickLogs: now.quickLogs.length }));
      setPreview(p);
    });

  const replace = () =>
    run(async () => {
      if (!preview) return;
      setBusy('Starting…');
      const r = await restoreBackup(store, backupIO, preview, { restoreId: newId().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24), progress: setBusy });
      if (!r.ok) throw new Error(r.error);
      onClose();
      signalRestored(`Restored the backup from ${when(r.manifest.createdAt)}.`);
    });

  const title = mode === 'backup' ? 'Back up data' : 'Restore data';
  return (
    <Sheet visible onClose={() => !busy && onClose()} label={title} fill>
      <ModalHeader title={title} dismiss={{ label: made ? 'Close' : 'Cancel', a11yLabel: `Close ${title.toLowerCase()}`, onPress: () => !busy && onClose() }} />
      <ScrollView style={styles.flex} contentContainerStyle={styles.content} testID={`${mode}-sheet`}>
        {busy && (
          <View style={styles.progress} testID="backup-progress" accessibilityLiveRegion="polite">
            <ActivityIndicator />
            <Text style={[type.body, styles.flex]}>{busy}</Text>
          </View>
        )}
        {error && (
          <View style={[styles.panel, styles.errorPanel]} testID="backup-error" accessibilityLiveRegion="polite">
            <Text style={type.body}>{error}</Text>
          </View>
        )}

        {mode === 'backup' && !made && (
          <>
            <Text style={type.body}>One file with everything Body Anvil keeps on this phone, to restore after reinstalling or on a new phone.</Text>
            <Text style={type.detail}>
              Included: your plan and every earlier version, workouts and Muscle Growth, completions and skips, measurements, meals and their original photos, imported values and screenshots, achievements and settings.
            </Text>
            <View style={styles.panel}>
              <Text style={type.section}>Not included</Text>
              {EXCLUDED_FROM_BACKUP.map((x) => (
                <Text key={x} style={type.detail}>
                  • {x}
                </Text>
              ))}
            </View>
            <Text style={type.detail}>The file isn't encrypted and contains your health data and photos. Keep it somewhere private.</Text>
            <Button title="Create backup" disabled={!!busy} onPress={backUp} testID="backup-create" />
          </>
        )}
        {mode === 'backup' && made && (
          <View style={styles.step} testID="backup-done">
            <Text style={type.body}>Backup ready: {made.fileName}</Text>
            <Contents m={made.manifest} />
            {made.manifest.missingAttachments.length > 0 && (
              <Text style={type.detail}>{n(made.manifest.missingAttachments.length, 'photo')} could not be found on this phone and isn't in the backup.</Text>
            )}
            <Text style={type.detail}>Keep it somewhere safe, such as Drive or Files. To restore it: menu → Restore data.</Text>
            {preview ? (
              <Button title="Continue to restore" onPress={() => { setMade(null); setMode('restore'); }} testID="backup-continue-restore" />
            ) : (
              <Button title="Done" onPress={onClose} />
            )}
          </View>
        )}

        {mode === 'restore' && !preview && (
          <>
            <Text style={type.body}>Restore replaces everything Body Anvil keeps on this phone with a backup file.</Text>
            <Text style={type.detail}>The file is checked completely first. Nothing changes until you confirm.</Text>
            <Button title="Choose backup file" disabled={!!busy} onPress={choose} testID="restore-choose" />
          </>
        )}
        {mode === 'restore' && preview && (
          <View style={styles.step} testID="restore-preview">
            <Text style={type.section}>Backup</Text>
            <Text style={type.body}>
              From {when(preview.manifest.createdAt)}, {preview.manifest.app.name} {preview.manifest.app.version}
            </Text>
            <Contents m={preview.manifest} />
            {preview.manifest.missingAttachments.length > 0 && (
              <Text style={type.detail}>{n(preview.manifest.missingAttachments.length, 'photo')} were already missing when this backup was made.</Text>
            )}
            <View style={[styles.panel, styles.warnPanel]} testID="restore-warning">
              <Text style={type.body}>This replaces all data on this phone{current ? ` (${n(current, 'record')} now)` : ''}.</Text>
              <Text style={type.detail}>Nothing is merged. If you might want what's on this phone now, back it up first.</Text>
            </View>
            <Button title="Back up this phone first" variant="secondary" disabled={!!busy} onPress={() => setMode('backup')} />
            <Button title="Replace my data" disabled={!!busy} onPress={replace} testID="restore-confirm" />
            <Button title="Choose another file" variant="quiet" disabled={!!busy} onPress={choose} />
          </View>
        )}
      </ScrollView>
    </Sheet>
  );
}

const useStyles = createThemedStyles(({ colors }) => ({
  flex: { flex: 1 },
  content: { gap: space.md, paddingBottom: space.xl },
  step: { gap: space.sm },
  progress: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  panel: { gap: space.xs, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  errorPanel: { borderColor: colors.accent },
  warnPanel: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
}));
