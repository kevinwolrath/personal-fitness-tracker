import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScrollView } from '../../ui/ScrollView';
import { formatTimestamp, formatShortDate } from '../../format';
import { HC_DISTANCE, HC_IMPORT_ID, hcMetric, hcTypeLabel, hcTypes, type HcType } from '../../observations/healthConnect';
import { likelySourceApp, setupSummary, type HcSetupRow } from '../../observations/healthConnectSetup';
import { appName, formatObservationValue, observationLabel } from '../../observations/format';
import { formatMinutes } from '../../observations/units';
import { activitySummary } from '../../observations/activity';
import type { Observation } from '../../observations/types';
import { toLocalDate } from '../../plan/dates';
import { useApp } from '../../providers/AppProvider';
import { Button } from '../../ui/Button';
import { ModalHeader } from '../../ui/ModalHeader';
import { Sheet } from '../../ui/Sheet';
import { space, touch, useTheme, createThemedStyles } from '../../ui/theme';
import { useHealthConnect, type HealthConnectState } from './HealthConnectProvider';

const whatIsRead: Record<HcType, string> = {
  steps: 'daily total',
  active_energy: 'daily total',
  exercise: 'type and minutes',
  weight: 'one per day',
  body_fat: 'one per day',
  sleep: 'time asleep, by the day you wake',
};

/** When the last sync ran: "7:42 am" today, else "Mon, 2 Nov". */
function when(iso: string): string {
  return toLocalDate(new Date(iso)) === toLocalDate(new Date()) ? formatTimestamp(iso) : formatShortDate(toLocalDate(new Date(iso)));
}

/** The menu row's detail line. */
export function healthConnectStatus(s: Pick<HealthConnectState, 'availability' | 'granted' | 'sync' | 'syncing'> & { checkFailed?: boolean; rows?: HcSetupRow[] }): string {
  if (s.availability === null) return 'Checking…';
  if (s.checkFailed && s.availability === 'available') return "Couldn't check Health Connect";
  if (s.availability === 'unsupported') return 'Not available on this device';
  if (s.availability === 'not_installed') return 'Not installed';
  if (s.availability === 'update_required') return 'Needs an update';
  if (!s.granted.length) return 'Off · steps, energy, workouts, weight and sleep';
  if (s.syncing) return 'Syncing…';
  if (s.sync && !s.sync.ok) return "Last sync didn't finish";
  const fixes = s.rows ? setupSummary(s.rows).problems.length : 0;
  if (fixes) return `Connected · ${fixes} ${fixes === 1 ? 'needs' : 'need'} a fix`;
  return s.sync ? `Connected · synced ${when(s.sync.at)}` : 'Connected';
}

const lower = (t: HcType) => hcTypeLabel[t].toLowerCase();

/**
 * Health Connect (#36, contract 12; setup checklist #116, option A): a persistent, read-only integration with its
 * own sheet. One checklist does the setup: tick what to import; each ticked type shows whether Body Anvil may read
 * it and whether data is arriving; a problem's Fix says what to do and opens the place to do it; coming back (or
 * Check again) confirms what changed. The Daily Log gains no controls: imported values appear in its existing
 * Weight tile and Recorded rows.
 */
export function HealthConnectSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { type } = useTheme();
  const styles = useStyles();

  const hc = useHealthConnect();
  const { store, plan, energy, dataVersion } = useApp();
  const [today, setToday] = useState<Observation[]>([]);
  /** The row whose fix is open; undefined = the first problem. */
  const [openFix, setOpenFix] = useState<HcType | null | undefined>(undefined);
  const connected = hc.availability === 'available' && hc.granted.length > 0;
  const summary = setupSummary(hc.rows);
  const days = hc.sync?.days ?? 7;

  useEffect(() => {
    if (!visible || !connected) return;
    let live = true;
    store.getDay(plan.id, toLocalDate(new Date())).then((d) => live && setToday(d.observations.filter((o) => o.source.importId === HC_IMPORT_ID)));
    return () => {
      live = false;
    };
  }, [visible, connected, store, plan.id, dataVersion]);

  const close = () => {
    hc.clearCheck();
    setOpenFix(undefined);
    onClose();
  };

  /** Today's imported value and its source, when there is one. */
  const todayValue = (t: HcType): { text: string; source: string | null } | null => {
    const os = today.filter((o) => o.metric === hcMetric[t]);
    if (!os.length) return null;
    const source = [...new Set(os.map((o) => (o.source.app ? appName(o.source.app) : null)).filter(Boolean))].join(', ') || null;
    if (t === 'exercise') {
      const sum = activitySummary(os);
      const text = os.length === 1 ? `${observationLabel(os[0])} ${formatMinutes(sum.minutes)}` : `${sum.unique.length} workouts · ${sum.uncertainTime ? '≥ ' : ''}${formatMinutes(sum.minutes)}`;
      return { text, source };
    }
    return { text: formatObservationValue(os[0], plan, energy), source };
  };

  /** A ticked type's two checks in a few words: allowed, and arriving (with what and from where). */
  const checks = (row: HcSetupRow): { text: string; problem: boolean } => {
    const t = row.type;
    const v = todayValue(t);
    switch (row.status) {
      case 'off':
        return { text: 'Not imported', problem: false };
      case 'needs_access':
        return { text: v ? `! Not allowed · kept ${v.text}` : '! Not allowed', problem: true };
      case 'checking':
        return { text: '✓ Allowed · Checking…', problem: false };
      case 'failed':
        return { text: v ? `✓ Allowed · ! Couldn't read · kept ${v.text}` : "✓ Allowed · ! Couldn't read", problem: true };
      case 'no_data':
        return { text: `✓ Allowed · ! None in Health Connect · last ${days} days`, problem: true };
      case 'working': {
        const from = row.app ? ` · ${appName(row.app)}` : '';
        if (v) return { text: `✓ Allowed · ✓ ${v.text} today${v.source ? ` · ${v.source}` : from}`, problem: false };
        return { text: `✓ Allowed · ✓ None today · Latest ${row.latest ? formatShortDate(row.latest) : '–'}${from}`, problem: false };
      }
    }
  };

  const fixOpen = openFix === undefined ? summary.problems[0] ?? null : openFix;

  /** What a check found, in a sentence or two (#116): what now works, what still needs a fix. */
  const report = (): { ok: boolean; lines: string[] } | null => {
    if (!hc.lastCheck) return null;
    const lines: string[] = [];
    for (const c of hc.lastCheck.changes) {
      const row = hc.rows.find((r) => r.type === c.type)!;
      if (c.outcome === 'fixed') {
        const v = todayValue(c.type);
        lines.push(`✓ ${hcTypeLabel[c.type]} is working now.${v ? ` ${v.text}${v.source ? ` from ${v.source}` : ''}.` : ''}`);
      } else if (c.outcome === 'broke') lines.push(`! ${hcTypeLabel[c.type]} stopped working.`);
      else lines.push(row.status === 'needs_access' ? `! ${hcTypeLabel[c.type]} still isn't allowed.` : row.status === 'no_data' ? `! ${hcTypeLabel[c.type]} still isn't arriving.` : `! ${hcTypeLabel[c.type]} still couldn't be read.`);
    }
    if (!lines.length && !summary.problems.length) lines.push('✓ Checked: everything ticked is working.');
    return lines.length ? { ok: lines.every((l) => l.startsWith('✓')), lines } : null;
  };
  const checked = report();

  return (
    <Sheet visible={visible} onClose={close} label="Health Connect">
      <ModalHeader title="Health Connect" dismiss={{ label: 'Close', onPress: close }} />
      {/* Tall content (six types, notes) scrolls inside the sheet so every action stays reachable (#46). */}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} testID="health-connect-sheet">
        {hc.availability === null && <Text style={type.detail}>Checking…</Text>}
        {hc.checkFailed && hc.availability === 'available' && (
          <View style={styles.note} testID="hc-check-failed">
            <Text style={styles.noteText}>Couldn’t check Health Connect’s permissions just now. Nothing was changed: your imported values stay. It tries again when you reopen the app.</Text>
          </View>
        )}

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
              <Text style={type.section}>What to bring in</Text>
              {hcTypes.map((t) => (
                <View key={t} style={styles.row}>
                  <Tick type={t} on={hc.wanted.includes(t)} onToggle={(on) => hc.setWanted(t, on)} />
                  <View style={styles.rowBody}>
                    <Text style={styles.rowLabel}>{hcTypeLabel[t]}</Text>
                    <Text style={type.detail}>{whatIsRead[t]}</Text>
                  </View>
                </View>
              ))}
              <Text style={[type.detail, styles.hint]}>Not imported: other measurements, such as heart rate.</Text>
              {HC_DISTANCE && <Text style={[type.detail, styles.hint]}>Walking distance is shown only when you allow Distance access and the source supplies matching records. No distance is estimated.</Text>}
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
              <Button title="Connect Health Connect" onPress={hc.connect} disabled={!hc.wanted.length} />
              <Text style={[type.detail, styles.center]}>Android asks which of the ticked ones to allow. The last 30 days come in first.</Text>
            </View>
          </View>
        )}

        {connected && (
          <View style={styles.group}>
            {checked && (
              <View style={[styles.note, checked.ok && styles.noteOk]} testID="hc-check-result" accessibilityLiveRegion="polite">
                {checked.lines.map((l) => (
                  <Text key={l} style={styles.noteText}>
                    {l}
                  </Text>
                ))}
              </View>
            )}
            <View style={styles.status}>
              <Text style={styles.statusTitle} testID="hc-summary">
                {summary.wanted ? `${summary.working} of ${summary.wanted} working` : 'Connected · nothing ticked'}
              </Text>
              <Text style={type.detail} testID="hc-sync-status">
                {hc.syncing
                  ? 'Syncing…'
                  : hc.sync
                    ? hc.sync.ok
                      ? `Last synced ${toLocalDate(new Date(hc.sync.at)) === toLocalDate(new Date()) ? 'today at ' : ''}${when(hc.sync.at)} · ${hc.sync.days} days checked`
                      : `Last sync didn't finish (${when(hc.sync.at)})${hc.sync.failed.length ? `: couldn't read ${hc.sync.failed.map((t) => hcTypeLabel[t as HcType].toLowerCase()).join(', ')}` : ''}. It tries again when you open the app.`
                    : 'Not synced yet'}
              </Text>
            </View>
            <View>
              <Text style={type.section}>What to bring in</Text>
              {hc.rows.map((row) => {
                const t = row.type;
                const c = checks(row);
                const open = fixOpen === t && c.problem;
                return (
                  <View key={t}>
                    <View style={styles.row}>
                      <Tick type={t} on={row.status !== 'off'} onToggle={(on) => hc.setWanted(t, on)} />
                      <View style={styles.rowBody} testID={`hc-today-${t}`}>
                        <Text style={styles.rowLabel}>{hcTypeLabel[t]}</Text>
                        <Text style={[type.detail, c.problem && styles.problem]}>{c.text}</Text>
                      </View>
                      {c.problem && (
                        <Pressable
                          onPress={() => setOpenFix(open ? null : t)}
                          style={styles.fixToggle}
                          accessibilityRole="button"
                          accessibilityLabel={`Fix ${lower(t)}`}
                          accessibilityState={{ expanded: open }}
                          testID={`hc-fix-toggle-${t}`}
                        >
                          <Text style={styles.linkText}>{open ? 'Fix ▴' : 'Fix ▾'}</Text>
                        </Pressable>
                      )}
                    </View>
                    {open && <Fix row={row} days={days} app={likelySourceApp(t, hc.sync?.types, hc.sync?.lastApps)} />}
                  </View>
                );
              })}
              <Text style={[type.detail, styles.hint]}>A value you enter yourself is kept and shown first.</Text>
              <Text style={[type.detail, styles.hint]} testID="hc-not-imported">
                Not imported: other measurements, such as heart rate.
              </Text>
            </View>
            <Button title={hc.syncing ? 'Checking…' : 'Check again'} variant="secondary" onPress={hc.checkAgain} disabled={hc.syncing} testID="hc-check-again" />
            {HC_DISTANCE && <Text style={type.detail}>Walking distance requires Distance access and matching source records. Manage permissions below to allow it. No distance is estimated.</Text>}
            <Pressable onPress={hc.openSettings} style={styles.link} accessibilityRole="button" testID="hc-manage">
              <Text style={[styles.linkText, styles.center]}>Manage in Health Connect</Text>
            </Pressable>
            <Text style={[type.detail, styles.center]}>
              Unticking a type stops importing it. To disconnect, remove access in Health Connect. Either way, values already imported stay in your history, labelled with their source.
            </Text>
          </View>
        )}
      </ScrollView>
    </Sheet>
  );
}

/** "Import <type>": a tick box with a 48dp target. */
function Tick({ type: t, on, onToggle }: { type: HcType; on: boolean; onToggle: (on: boolean) => void }) {
  const styles = useStyles();
  return (
    <Pressable onPress={() => onToggle(!on)} style={styles.tickTarget} role="checkbox" aria-checked={on} aria-label={`Import ${lower(t)}`} testID={`hc-want-${t}`}>
      <View style={[styles.tick, on && styles.tickOn]}>{on ? <Text style={styles.tickMark}>✓</Text> : null}</View>
    </Pressable>
  );
}

/** What to do about one problem, and the button that goes there (#116). */
function Fix({ row, days, app }: { row: HcSetupRow; days: number; app: string | null }) {
  const { type } = useTheme();
  const styles = useStyles();
  const hc = useHealthConnect();
  const t = row.type;
  const name = lower(t);
  const source = app ? appName(app) : null;
  return (
    <View style={styles.fix} testID={`hc-fix-${t}`}>
      {row.status === 'needs_access' && (
        <>
          <Text style={styles.fixTitle}>Body Anvil isn’t allowed to read {name}.</Text>
          <Button title={`Allow ${name}`} onPress={() => hc.allow(t)} />
          <Text style={type.detail}>
            If Android doesn’t ask (it stops after two refusals): Health Connect → App permissions → Body Anvil → turn on {hcTypeLabel[t]}.
          </Text>
          <Pressable onPress={hc.openSettings} style={styles.link} accessibilityRole="button">
            <Text style={styles.linkText}>Open Health Connect</Text>
          </Pressable>
        </>
      )}
      {row.status === 'no_data' && (
        <>
          <Text style={styles.fixTitle}>
            Body Anvil can read {name}, but none has arrived in the last {days} days.
          </Text>
          <Text style={styles.fixStep}>1. Open Health Connect → App permissions → {source ?? 'the app that records it'}.</Text>
          <Text style={styles.fixStep}>2. Under Allow to write, turn on {hcTypeLabel[t]}.</Text>
          <Text style={styles.fixStep}>3. Open {source ?? 'that app'} once so it shares, then come back here.</Text>
          <Button title="Open Health Connect" onPress={hc.openSettings} />
          <Text style={type.detail}>Nothing recorded in {days} days? Then nothing needs fixing.</Text>
        </>
      )}
      {row.status === 'failed' && (
        <>
          <Text style={styles.fixTitle}>Couldn’t read {name} last time. This is usually temporary.</Text>
          <Button title="Check again" onPress={hc.checkAgain} />
        </>
      )}
    </View>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => ({
  scroll: { flexShrink: 1 },
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
  rowBody: { flex: 1, minWidth: 0, paddingVertical: space.xs },
  problem: { color: colors.ink, fontWeight: '600' },
  tickTarget: { width: touch, minHeight: touch, alignItems: 'flex-start', justifyContent: 'center', marginRight: -space.md },
  tick: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  tickOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  tickMark: { color: colors.onAccent, fontSize: 15, fontWeight: '900', lineHeight: 18 },
  fixToggle: { minHeight: touch, minWidth: touch, justifyContent: 'center', alignItems: 'flex-end' },
  fix: { backgroundColor: colors.bg, borderRadius: 14, padding: space.md, gap: space.sm, marginVertical: space.sm },
  fixTitle: { ...type.body, fontSize: 15 },
  fixStep: { fontSize: 15, lineHeight: 21, color: colors.ink },
  noteOk: { borderWidth: 1, borderColor: colors.accent },
  status: { minHeight: 56, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  statusTitle: { fontSize: 17, fontWeight: '700', color: colors.ink },
  hint: { marginTop: space.sm },
  note: { backgroundColor: colors.bg, borderRadius: 14, padding: space.md, gap: space.xs },
  noteText: { ...type.body, fontSize: 15, fontWeight: '500' },
  link: { minHeight: touch, justifyContent: 'center' },
  linkText: { fontSize: 16, fontWeight: '700', color: colors.accent },
  center: { textAlign: 'center' },
}));
