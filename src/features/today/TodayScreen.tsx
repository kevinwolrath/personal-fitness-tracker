import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../../providers/AppProvider';
import { formatAmount, formatTimestamp } from '../../format';
import { addDays } from '../../plan/dates';
import type { Activity, Measurement } from '../../plan/schema';
import { tap } from '../../ui/haptics';
import { colors, radius, space, touch, type } from '../../ui/theme';
import { ActivityRow } from './ActivityRow';
import { DayHeader } from './DayHeader';
import { MeasurementPanel } from './MeasurementPanel';
import { ActivitySheet, DayTypeSheet, MeasureSheet } from './Sheets';
import { TargetsLine } from './TargetsLine';
import { Toast, type ToastState } from './Toast';
import { useDay, useToday } from './useDay';

/**
 * Today: renders whatever plan is loaded for the selected date (contract 02).
 * Contains layout and generic copy only — every plan word comes from data.
 */
export function TodayScreen() {
  const { store, plan } = useApp();
  const today = useToday();
  const [date, setDate] = useState(today);
  const { day, progress, records, latestMeasurement, actions } = useDay(store, plan, date);

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

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} testID="today-scroll">
        <DayHeader
          date={date}
          today={today}
          yesterday={addDays(today, -1)}
          dayTypeLabel={day.dayTypeLabel}
          overridden={day.overridden}
          progress={progress}
          onPrev={() => setDate((d) => addDays(d, -1))}
          onNext={() => setDate((d) => addDays(d, 1))}
          onToday={() => setDate(today)}
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
        </View>

        {nothingPlanned && <Text style={[type.body, styles.empty]}>Nothing planned today</Text>}

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
        entries={sheetMeasurement ? records.measurements.filter((m) => m.measurementId === sheetMeasurement.id) : []}
        prefill={sheetMeasurement ? latestMeasurement[sheetMeasurement.id]?.value ?? null : null}
        onClose={() => setSheetMeasurement(null)}
        onSave={(v) => sheetMeasurement && actions.addMeasurement(sheetMeasurement.id, v)}
        onRemove={actions.removeMeasurement}
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
