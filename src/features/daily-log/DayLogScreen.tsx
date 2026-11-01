import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../../providers/AppProvider';
import { buildExport } from '../../export/exportFormat';
import { formatAmount, formatTimestamp, localIsoTimestamp } from '../../format';
import { shareJson } from '../../platform/files';
import { measurementMetric } from '../../observations/planMetrics';
import { addDays, type LocalDate } from '../../plan/dates';
import type { Observation } from '../../observations/types';
import type { Activity, Measurement } from '../../plan/schema';
import { tap } from '../../ui/haptics';
import { colors, radius, space, touch, type } from '../../ui/theme';
import { ActivityRow } from './ActivityRow';
import { DayHeader } from './DayHeader';
import { loggedOutsidePlan, recordedObservations } from './dayContent';
import { JumpToDateSheet } from './JumpToDateSheet';
import { ObservationSheet, RecordedSection } from './RecordedSection';
import { MeasurementPanel } from './MeasurementPanel';
import { ActivitySheet, DayTypeSheet, MeasureSheet } from './Sheets';
import { TargetsLine } from './TargetsLine';
import { Toast, type ToastState } from './Toast';
import { useDay, useToday } from './useDay';

const isLocalDate = (d: unknown): d is LocalDate =>
  typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(`${d}T12:00:00`).getTime());

/**
 * The Daily Log day view (contract 02): one screen for every date. "Today" is just the current date.
 * The selected date lives in the URL (`/?date=YYYY-MM-DD`; none = today), so reload and links keep it.
 * Contains layout and generic copy only — every plan word comes from data.
 */
export function DayLogScreen() {
  const { store, plan } = useApp();
  const today = useToday();
  const params = useLocalSearchParams<{ date?: string }>();
  const date: LocalDate = isLocalDate(params.date) ? params.date : today;
  const setDate = useCallback(
    (d: LocalDate) => router.setParams({ date: d === today ? undefined : d }),
    [today],
  );
  const { day, progress, records, latestMeasurement, actions, reload } = useDay(store, plan, date);

  const [firstRecord, setFirstRecord] = useState<LocalDate | null>(null);
  const [jumpOpen, setJumpOpen] = useState(false);
  useEffect(() => {
    if (jumpOpen) store.firstRecordDate().then(setFirstRecord, () => setFirstRecord(null));
  }, [jumpOpen, store]);
  const [sheetObservation, setSheetObservation] = useState<Observation | null>(null);
  const recorded = useMemo(() => recordedObservations(day, records), [day, records]);
  const outsidePlan = useMemo(() => loggedOutsidePlan(day, records), [day, records]);

  // Coming back from Import: show what was just saved.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) firstFocus.current = false;
      else reload();
    }, [reload]),
  );

  // Past days can be corrected; future days are view-only (contract 04).
  const editable = date <= today;

  const [sheetActivity, setSheetActivity] = useState<Activity | null>(null);
  const [sheetMeasurement, setSheetMeasurement] = useState<Measurement | null>(null);
  const [dayTypeOpen, setDayTypeOpen] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const clearToast = useCallback(() => setToast(null), []);

  const budgetNote = useMemo(() => {
    if (!day.flexibleBudget) return {} as Record<string, string>;
    const text = day.flexibleBudget.lines
      .map((l) => `≈ ${formatAmount(plan, l.quantity, l.remaining)} ${l.quantity === 'energy' ? 'left' : `${l.label.toLowerCase()} to go`}`)
      .join(' · ');
    return { [day.flexibleBudget.activityId]: text };
  }, [day.flexibleBudget, plan]);

  const press = (a: Activity) => {
    tap();
    actions.advance(a);
  };
  const toggleSkip = (a: Activity) => {
    const skipped = records.activities[a.id]?.status === 'skipped';
    actions.setSkipped(a, !skipped);
    if (!skipped) setToast({ key: Date.now(), message: `Skipped ${a.label}`, onUndo: () => actions.setSkipped(a, false) });
  };
  const quickLog = (id: string, label: string) => {
    tap();
    const entryId = actions.addQuickLog(id);
    setToast({ key: Date.now(), message: `${label} · logged ${formatTimestamp(new Date().toISOString())}`, onUndo: () => actions.removeQuickLog(entryId) });
  };

  const renderRows = (list: Activity[], showTime: boolean) =>
    list.map((a) => (
      <ActivityRow
        key={a.id}
        activity={a}
        log={records.activities[a.id]}
        showTime={showTime}
        note={budgetNote[a.id]}
        editable={editable}
        onPress={() => press(a)}
        onMore={() => setSheetActivity(a)}
        onSkipToggle={() => toggleSkip(a)}
      />
    ));

  const nothingPlanned = !day.timed.length && !day.anytime.length;

  const exportAll = async () => {
    try {
      const doc = buildExport(await store.snapshot(), { exportedAt: localIsoTimestamp(), today, appVersion: '0.1.0' });
      await shareJson(`fitness-export-${today}.json`, JSON.stringify(doc, null, 2));
      setToast({ key: Date.now(), message: `Exported ${doc.counts.observations + doc.counts.activityLogs + doc.counts.quickLogs} records` });
    } catch {
      setToast({ key: Date.now(), message: "Export didn't complete" });
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} testID="day-scroll">
        <DayHeader
          date={date}
          today={today}
          dayTypeLabel={day.dayTypeLabel}
          overridden={day.overridden}
          progress={progress}
          onPrev={() => setDate(addDays(date, -1))}
          onNext={() => setDate(addDays(date, 1))}
          onToday={() => setDate(today)}
          onPickDate={() => setJumpOpen(true)}
          onDayType={() => setDayTypeOpen(true)}
        />

        {!editable && <Text style={[type.detail, styles.notice]}>Upcoming. You can tick these off on the day.</Text>}

        <View style={styles.block}>
          <MeasurementPanel
            plan={plan}
            date={date}
            due={day.measurementsDue}
            latest={latestMeasurement}
            editable={editable}
            onLog={setSheetMeasurement}
          />
          <TargetsLine plan={plan} targets={day.targets} />
          {editable && (
            <Pressable
              onPress={() => router.push({ pathname: '/import', params: { date } })}
              style={styles.textAction}
              accessibilityRole="button"
              accessibilityLabel="Import from screenshots"
            >
              <Text style={styles.textActionText}>Import from screenshots ›</Text>
            </Pressable>
          )}
        </View>

        {nothingPlanned && <Text style={[type.body, styles.empty]}>Nothing planned for this day</Text>}

        {day.timed.length > 0 && (
          <View style={styles.block}>
            <Text style={type.section} accessibilityRole="header">
              Schedule
            </Text>
            <View style={styles.list}>{renderRows(day.timed, true)}</View>
          </View>
        )}
        {day.anytime.length > 0 && (
          <View style={styles.block}>
            <Text style={type.section} accessibilityRole="header">
              Anytime
            </Text>
            <View style={styles.list}>{renderRows(day.anytime, false)}</View>
          </View>
        )}

        <View style={styles.block}>
          <RecordedSection plan={plan} observations={recorded} outsidePlan={outsidePlan} onOpen={setSheetObservation} />
        </View>

        <View style={styles.footerLinks}>
          <Pressable onPress={() => router.push('/configure')} style={styles.textAction} accessibilityRole="button" accessibilityLabel="Configure with AI">
            <Text style={[type.detail, styles.exportText]}>Configure with AI</Text>
          </Pressable>
          <Pressable onPress={exportAll} style={styles.textAction} accessibilityRole="button" accessibilityLabel="Export all data">
            <Text style={[type.detail, styles.exportText]}>Export all data (JSON)</Text>
          </Pressable>
        </View>
      </ScrollView>

      {plan.quickLogs.length > 0 && (
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <Toast toast={toast} onDone={clearToast} />
          <View style={styles.quickRow}>
            {plan.quickLogs.map((q) => (
              <Pressable
                key={q.id}
                onPress={() => quickLog(q.id, q.label)}
                disabled={!editable}
                style={({ pressed }) => [styles.quick, pressed && styles.pressed, !editable && styles.disabled]}
                accessibilityRole="button"
                accessibilityLabel={q.label}
                accessibilityHint={q.detail}
              >
                <Text style={styles.quickText}>{q.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[type.detail, styles.quickNote]} testID="quick-log-summary" numberOfLines={1}>
            {plan.quickLogs
              .map((q) => {
                const times = records.quickLogs.filter((e) => e.quickLogId === q.id).map((e) => formatTimestamp(e.at));
                return times.length ? `${q.label}: ${times.join(', ')}` : null;
              })
              .filter(Boolean)
              .join('  ·  ') || 'Nothing logged yet'}
          </Text>
        </SafeAreaView>
      )}
      {!plan.quickLogs.length && <Toast toast={toast} onDone={clearToast} />}

      <ActivitySheet
        activity={sheetActivity}
        log={sheetActivity ? records.activities[sheetActivity.id] : undefined}
        editable={editable}
        onClose={() => setSheetActivity(null)}
        onSetDone={(done) => sheetActivity && actions.setDone(sheetActivity, done)}
        onSetSkipped={(skipped) => sheetActivity && (skipped ? toggleSkip(sheetActivity) : actions.setSkipped(sheetActivity, false))}
      />
      <MeasureSheet
        plan={plan}
        measurement={sheetMeasurement}
        entries={sheetMeasurement ? records.observations.filter((o) => o.metric === sheetMeasurement.id && o.kind === 'observed') : []}
        prefill={
          sheetMeasurement && latestMeasurement[sheetMeasurement.id]
            ? measurementMetric(plan, sheetMeasurement).toPlan(latestMeasurement[sheetMeasurement.id]!.value)
            : null
        }
        onClose={() => setSheetMeasurement(null)}
        onSave={(v) => sheetMeasurement && actions.addMeasurement(sheetMeasurement, v)}
        onRemove={actions.removeObservation}
      />
      <JumpToDateSheet
        visible={jumpOpen}
        date={date}
        today={today}
        firstRecord={firstRecord}
        onClose={() => setJumpOpen(false)}
        onJump={setDate}
      />
      <ObservationSheet
        plan={plan}
        observation={sheetObservation}
        editable={editable}
        onClose={() => setSheetObservation(null)}
        onCorrect={actions.correctObservation}
        onRemove={(o) => actions.removeObservation(o.id)}
      />
      <DayTypeSheet
        plan={plan}
        visible={dayTypeOpen}
        currentId={day.dayTypeId}
        defaultId={plan.schedule[day.weekday]}
        editable={editable}
        onClose={() => setDayTypeOpen(false)}
        onChoose={actions.setDayType}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.xxl },
  block: { marginTop: space.xl },
  notice: { marginTop: space.md },
  empty: { marginTop: space.xl, color: colors.muted },
  list: { marginTop: space.xs },
  textAction: { minHeight: touch, justifyContent: 'center', alignSelf: 'flex-start' },
  textActionText: { fontSize: 16, fontWeight: '700', color: colors.accent },
  footerLinks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: space.xl, marginTop: space.xl },
  exportText: { textDecorationLine: 'underline' },
  footer: {
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
  },
  quickRow: { flexDirection: 'row', gap: space.sm },
  quick: { flex: 1, minHeight: touch + 8, borderRadius: radius.md, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  quickText: { color: colors.onAccent, fontSize: 17, fontWeight: '800' },
  quickNote: { textAlign: 'center', marginTop: space.sm, marginBottom: space.sm, ...type.number },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.4 },
});
