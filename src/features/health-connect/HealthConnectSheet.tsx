import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatTimestamp, formatShortDate } from '../../format';
import { HC_IMPORT_ID, hcMetric, hcTypeLabel, hcTypes, type HcType } from '../../observations/healthConnect';
import { appName, formatObservationValue, observationLabel } from '../../observations/format';
import { formatMinutes } from '../../observations/units';
import type { Observation } from '../../observations/types';
import { toLocalDate } from '../../plan/dates';
import { useApp } from '../../providers/AppProvider';
import { Button } from '../../ui/Button';
import { ModalHeader } from '../../ui/ModalHeader';
import { Sheet } from '../../ui/Sheet';
import { colors, space, touch, type } from '../../ui/theme';
import { useHealthConnect, type HealthConnectState } from './HealthConnectProvider';

const whatIsRead: Record<HcType, string> = {
  steps: 'daily total',
  active_energy: 'daily total',
  exercise: 'type and minutes',
  weight: 'one per day',
  sleep: 'time asleep, by the day you wake',
};

/** When the last sync ran: "7:42 am" today, else "Mon, 2 Nov". */
function when(iso: string): string {
  return toLocalDate(new Date(iso)) === toLocalDate(new Date()) ? formatTimestamp(iso) : formatShortDate(toLocalDate(new Date(iso)));
}

/** The menu row's detail line. */
export function healthConnectStatus(s: Pick<HealthConnectState, 'availability' | 'granted' | 'sync' | 'syncing'>): string {
  if (s.availability === null) return 'Checking…';
  if (s.availability === 'unsupported') return 'Not available on this device';
  if (s.availability === 'not_installed') return 'Not installed';
  if (s.availability === 'update_required') return 'Needs an update';
  if (!s.granted.length) return 'Off · steps, energy, workouts, weight and sleep';
  if (s.syncing) return 'Syncing…';
  if (s.sync && !s.sync.ok) return "Last sync didn't finish";
  return s.sync ? `Connected · synced ${when(s.sync.at)}` : 'Connected';
}

/**
 * Health Connect (#36, contract 12, option A): a persistent, read-only integration with its own sheet. Shows what
 * is read and, once connected, today's imported values with their source. The Daily Log itself gains no controls:
 * imported values appear in its existing Weight tile and Recorded rows.
 */
export function HealthConnectSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const hc = useHealthConnect();
  const { store, plan, energy, dataVersion } = useApp();
  const [today, setToday] = useState<Observation[]>([]);
  const connected = hc.availability === 'available' && hc.granted.length > 0;

  useEffect(() => {
    if (!visible || !connected) return;
    let live = true;
    store.getDay(plan.id, toLocalDate(new Date())).then((d) => live && setToday(d.observations.filter((o) => o.source.importId === HC_IMPORT_ID)));
    return () => {
      live = false;
    };
  }, [visible, connected, store, plan.id, dataVersion]);

  const value = (t: HcType): { text: string; source: string | null } => {
    if (!hc.granted.includes(t)) return { text: 'Not allowed', source: null };
    const os = today.filter((o) => o.metric === hcMetric[t]);
    if (!os.length) return { text: 'Nothing today', source: null };
    const src = [...new Set(os.map((o) => (o.source.app ? appName(o.source.app) : null)).filter(Boolean))].join(', ') || null;
    if (t === 'exercise') {
      const text = os.length === 1 ? `${observationLabel(os[0])} ${formatMinutes(os[0].value)}` : `${os.length} workouts · ${formatMinutes(os.reduce((n, o) => n + o.value, 0))}`;
      return { text, source: src };
    }
    return { text: formatObservationValue(os[0], plan, energy), source: src };
  };

  return (
    <Sheet visible={visible} onClose={onClose} label="Health Connect">
      <ModalHeader title="Health Connect" dismiss={{ label: 'Close', onPress: onClose }} />
      <View style={styles.body} testID="health-connect-sheet">
        {hc.availability === null && <Text style={type.detail}>Checking…</Text>}

        {hc.availability === 'unsupported' && (
          <Text style={type.body} testID="hc-unsupported">
            Health Connect is available on Android phones. Everything else in the app works as usual.
          </Text>
        )}

        {(hc.availability === 'not_installed' || hc.availability === 'update_required') && (
          <View style={styles.group} testID="hc-install">
            <Text style={type.body}>
              {hc.availability === 'not_installed'
                ? 'Health Connect isn’t installed on this phone. Install it from Google Play to bring in what your phone already records.'
                : 'Health Connect needs an update before it can share data.'}
            </Text>
            <Button title={hc.availability === 'not_installed' ? 'Get Health Connect' : 'Update Health Connect'} onPress={hc.openInstall} />
          </View>
        )}

        {hc.availability === 'available' && !connected && (
          <View style={styles.group}>
            <Text style={type.body}>
              Bring in what your phone already records, automatically, every time you open the app. Read only: nothing is written back
              or sent anywhere.
            </Text>
            <View>
              <Text style={type.section}>What is read</Text>
              {hcTypes.map((t) => (
                <View key={t} style={styles.row}>
                  <Text style={styles.rowLabel}>{hcTypeLabel[t]}</Text>
                  <Text style={type.detail}>{whatIsRead[t]}</Text>
                </View>
              ))}
            </View>
            {hc.refused && (
              <View style={styles.note} testID="hc-refused">
                <Text style={styles.noteText}>Nothing was allowed. You can allow access in Health Connect at any time.</Text>
                <Pressable onPress={hc.openSettings} style={styles.link} accessibilityRole="button">
                  <Text style={styles.linkText}>Open Health Connect</Text>
                </Pressable>
              </View>
            )}
            <View style={styles.group}>
              <Button title="Connect Health Connect" onPress={hc.connect} />
              <Text style={[type.detail, styles.center]}>Android asks which of these to allow. The last 30 days come in first.</Text>
            </View>
          </View>
        )}

        {connected && (
          <View style={styles.group}>
            <View style={styles.status}>
              <Text style={styles.statusTitle}>Connected</Text>
              <Text style={type.detail} testID="hc-sync-status">
                {hc.syncing
                  ? 'Syncing…'
                  : hc.sync
                    ? hc.sync.ok
                      ? `Last synced ${toLocalDate(new Date(hc.sync.at)) === toLocalDate(new Date()) ? 'today at ' : ''}${when(hc.sync.at)} · ${hc.sync.days} days checked`
                      : `Last sync didn't finish (${when(hc.sync.at)}). It tries again when you open the app.`
                    : 'Not synced yet'}
              </Text>
            </View>
            <View>
              <Text style={type.section}>Today</Text>
              {hcTypes.map((t) => {
                const v = value(t);
                return (
                  <View key={t} style={styles.row} testID={`hc-today-${t}`}>
                    <Text style={styles.rowLabel}>{hcTypeLabel[t]}</Text>
                    <View style={styles.rowRight}>
                      <Text style={[type.detail, styles.rowValue, v.source && styles.value]} numberOfLines={1}>
                        {v.text}
                      </Text>
                      {v.source && (
                        <Text style={[type.detail, styles.rowValue]} numberOfLines={1}>
                          {v.source}
                        </Text>
                      )}
                    </View>
                  </View>
                );
              })}
              <Text style={[type.detail, styles.hint]}>A value you enter yourself is kept and shown first.</Text>
            </View>
            <Button title="Sync now" variant="secondary" onPress={hc.syncNow} disabled={hc.syncing} />
            <Pressable onPress={hc.openSettings} style={styles.link} accessibilityRole="button" testID="hc-manage">
              <Text style={[styles.linkText, styles.center]}>Manage in Health Connect</Text>
            </Pressable>
            <Text style={[type.detail, styles.center]}>
              To disconnect, remove access in Health Connect. Values already imported stay in your history, labelled with their source.
            </Text>
          </View>
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.md, paddingBottom: space.md },
  group: { gap: space.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  rowLabel: { ...type.body, flexShrink: 0 },
  rowRight: { flex: 1, minWidth: 0, alignItems: 'flex-end', paddingVertical: space.xs },
  rowValue: { maxWidth: '100%', textAlign: 'right' },
  value: { color: colors.ink, fontWeight: '600' },
  status: { minHeight: 56, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  statusTitle: { fontSize: 17, fontWeight: '700', color: colors.ink },
  hint: { marginTop: space.sm },
  note: { backgroundColor: colors.bg, borderRadius: 14, padding: space.md, gap: space.xs },
  noteText: { ...type.body, fontSize: 15, fontWeight: '500' },
  link: { minHeight: touch, justifyContent: 'center' },
  linkText: { fontSize: 16, fontWeight: '700', color: colors.accent },
  center: { textAlign: 'center' },
});
