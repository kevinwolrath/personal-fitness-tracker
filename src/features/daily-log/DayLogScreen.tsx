import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../../providers/AppProvider';
import { buildExport } from '../../export/exportFormat';
import { formatAmount, localIsoTimestamp } from '../../format';
import { shareJson } from '../../platform/files';
import { measurementMetric } from '../../observations/planMetrics';
import { addDays, type LocalDate } from '../../plan/dates';
import type { Observation } from '../../observations/types';
import type { Activity, Measurement } from '../../plan/schema';
import { tap } from '../../ui/haptics';
import { colors, space, type } from '../../ui/theme';
import { ActivityRow } from './ActivityRow';
import { DayHeader } from './DayHeader';
import { loggedOutsidePlan, recordedObservations } from './dayContent';
import { JumpToDateSheet } from './JumpToDateSheet';
import { ObservationSheet, RecordedSection } from './RecordedSection';
import { MeasurementPanel } from './MeasurementPanel';
import { DayTypeSheet, MeasureSheet } from './Sheets';
import { ItemSheet } from './ItemSheet';
import { AppMenu, type AppMenuItem } from './AppMenu';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { handOffScreenshots, pickScreenshots } from '../import/useImportSession';
import { buildGuide } from '../../exercises/guide';
import { ExerciseGuideSheet } from '../exercise-guide/ExerciseGuideSheet';
import type { PrescribedExercise } from '../../prescription/session';
import { NextActionCard } from './NextActionCard';
import { RequirementRow } from './RequirementRow';
import { partLabels, partOrder } from '../../prescription/windows';
import type { PrescriptionItem } from '../../prescription/prescribe';
import { TargetsLine } from './TargetsLine';
import { Toast, type ToastState } from './Toast';
import { useDay, useNowMinutes, useToday } from './useDay';

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
  const { day, prescription, progress, nextAt, records, latestMeasurement, actions, reload } = useDay(store, plan, date);
  const nowMinutes = useNowMinutes();
  // "Do this next" is about the present, so it only shows on today (contract 08).
  const next = date === today ? nextAt(nowMinutes) : null;

  const [firstRecord, setFirstRecord] = useState<LocalDate | null>(null);
  const [jumpOpen, setJumpOpen] = useState(false);
  useEffect(() => {
    if (jumpOpen) store.firstRecordDate().then(setFirstRecord, () => setFirstRecord(null));
  }, [jumpOpen, store]);
  const [sheetObservation, setSheetObservation] = useState<Observation | null>(null);
  const recorded = useMemo(() => recordedObservations(day, records), [day, records]);
  const outsidePlan = useMemo(() => loggedOutsidePlan(day, records, prescription.items.map((i) => i.key)), [day, records, prescription]);

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

  const [sheetItem, setSheetItem] = useState<PrescriptionItem | null>(null);
  const [guideFor, setGuideFor] = useState<PrescribedExercise | null>(null);
  const [sheetMeasurement, setSheetMeasurement] = useState<Measurement | null>(null);
  const [dayTypeOpen, setDayTypeOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmExport, setConfirmExport] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const clearToast = useCallback(() => setToast(null), []);

  const budgetNote = useMemo(() => {
    if (!day.flexibleBudget) return {} as Record<string, string>;
    const text = day.flexibleBudget.lines
      .map((l) => `≈ ${formatAmount(plan, l.quantity, l.remaining)} ${l.quantity === 'energy' ? 'left' : `${l.label.toLowerCase()} to go`}`)
      .join(' · ');
    return { [day.flexibleBudget.activityId]: text };
  }, [day.flexibleBudget, plan]);

  const press = (item: PrescriptionItem, a: Activity) => {
    tap();
    actions.advance(item, a);
  };
  const toggleSkip = (item: PrescriptionItem) => {
    const skipped = item.state === 'skipped';
    actions.setSkipped(item, !skipped);
    if (!skipped) setToast({ key: Date.now(), message: `Skipped ${item.label}`, onUndo: () => actions.setSkipped(item, false) });
  };

  const renderItem = (item: PrescriptionItem) =>
    item.kind === 'requirement' ? (
      <RequirementRow
        key={item.key}
        item={item}
        logs={records.activities}
        editable={editable}
        isNext={next?.item.key === item.key}
        onOption={(a) => press(item, a)}
        onMore={() => setSheetItem(item)}
      />
    ) : (
      <ActivityRow
        key={item.key}
        activity={item.activity!}
        log={records.activities[item.key]}
        showTime={item.window.part !== 'anytime'}
        note={budgetNote[item.key]}
        editable={editable}
        isNext={next?.item.key === item.key}
        onPress={() => press(item, item.activity!)}
        onMore={() => setSheetItem(item)}
        onSkipToggle={() => toggleSkip(item)}
      />
    );
  // Grouped by part of the day; anytime last (contract 08).
  const groups = partOrder
    .map((part) => ({ part, items: prescription.items.filter((i) => i.window.part === part) }))
    .filter((g) => g.items.length);
  const nothingPlanned = !prescription.items.length;

  // App-level operations live in the menu, not on the day (#15).
  const importScreenshots = async () => {
    const shots = await pickScreenshots();
    if (!shots) return; // cancelled: nothing happens
    handOffScreenshots(shots);
    router.push({ pathname: '/import', params: { date } });
  };
  const menuItems: AppMenuItem[] = [
    { key: 'import', label: 'Import from screenshots', detail: 'Read values from fitness-app screenshots', onSelect: importScreenshots },
    { key: 'configure', label: 'Configure with AI', detail: 'Change your plan, equipment and goals', onSelect: () => router.push('/configure') },
    { key: 'export', label: 'Export all data', detail: 'Your complete history as a JSON file', onSelect: () => setConfirmExport(true) },
  ];

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
          onMenu={() => setMenuOpen(true)}
        />

        {!editable && <Text style={[type.detail, styles.notice]}>Upcoming. You can tick these off on the day.</Text>}

        {date === today && (
          <View style={styles.block}>
            <NextActionCard next={next} progress={progress} logs={records.activities} onAdvance={press} onDetails={setSheetItem} onOpenExercise={setGuideFor} />
          </View>
        )}

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

        {nothingPlanned && <Text style={[type.body, styles.empty]}>Nothing planned for this day</Text>}

        {groups.map((g) => (
          <View key={g.part} style={styles.block} testID={`part-${g.part}`}>
            <Text style={type.section} accessibilityRole="header">
              {partLabels[g.part]}
            </Text>
            <View style={styles.list}>{g.items.map(renderItem)}</View>
          </View>
        ))}

        <View style={styles.block}>
          <RecordedSection plan={plan} observations={recorded} outsidePlan={outsidePlan} onOpen={setSheetObservation} />
        </View>

      </ScrollView>

      {/* Toasts float above this zero-content dock at the bottom safe-area edge. */}
      <SafeAreaView edges={['bottom']} style={styles.toastDock} pointerEvents="box-none">
        <Toast toast={toast} onDone={clearToast} />
      </SafeAreaView>

      <ItemSheet
        item={sheetItem && (prescription.items.find((i) => i.key === sheetItem.key) ?? null)}
        logs={records.activities}
        editable={editable}
        onClose={() => setSheetItem(null)}
        onSetDone={(item, a, done, variant) => actions.setDone(item, a, done, variant)}
        onSetSkipped={(item, skipped) => (skipped ? toggleSkip(item) : actions.setSkipped(item, false))}
        exerciseConfig={plan.exercise}
      />
      <AppMenu visible={menuOpen} onClose={() => setMenuOpen(false)} items={menuItems} />
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
      <ExerciseGuideSheet guide={guideFor ? buildGuide(guideFor, plan.exercise) : null} onClose={() => setGuideFor(null)} />
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
  toastDock: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: space.lg },
});
