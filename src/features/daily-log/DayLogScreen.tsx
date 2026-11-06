import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../../providers/AppProvider';
import { formatAmount } from '../../format';
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
import { buildGuide } from '../../exercises/guide';
import { ExerciseGuideSheet } from '../exercise-guide/ExerciseGuideSheet';
import type { PrescribedExercise } from '../../prescription/session';
import { NextActionCard } from './NextActionCard';
import { NoPlanCard } from './NoPlanCard';
import { isDue } from '../../prescription/nextAction';
import { useReminders } from '../reminders/RemindersProvider';
import { WorkoutCard } from './WorkoutCard';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { sessionProgress, switchNeedsConfirm, type ChecklistRow, type Variant } from '../../prescription/exercises';
import { RequirementRow } from './RequirementRow';
import { partLabels, partOrder } from '../../prescription/windows';
import type { PrescriptionItem } from '../../prescription/prescribe';
import { TargetsLine } from './TargetsLine';
import { Toast, type ToastState } from '../../ui/Toast';
import { useClock, useDay } from './useDay';

const isLocalDate = (d: unknown): d is LocalDate =>
  typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(`${d}T12:00:00`).getTime());

/**
 * The Daily Log day view (contract 02): one screen for every date. "Today" is just the current date.
 * The selected date lives in the URL (`/?date=YYYY-MM-DD`; none = today), so reload and links keep it.
 * Contains layout and generic copy only — every plan word comes from data.
 */
export function DayLogScreen() {
  const { store, plan, energy, dataVersion } = useApp();
  const { today, nowMinutes } = useClock();
  const params = useLocalSearchParams<{ date?: string; focus?: string }>();
  const date: LocalDate = isLocalDate(params.date) ? params.date : today;
  const setDate = useCallback(
    (d: LocalDate) => router.setParams({ date: d === today ? undefined : d }),
    [today],
  );
  const { day, prescription, progress, nextAt, records, latestMeasurement, actions, reload } = useDay(store, plan, date, dataVersion);
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

  // Reminders follow the day: a completion, skip or day-type change re-reconciles them (contract 10).
  const reminders = useReminders();
  const recordsSeen = useRef<unknown>(null);
  useEffect(() => {
    if (recordsSeen.current && recordsSeen.current !== records) reminders.sync();
    recordsSeen.current = records;
  }, [records, reminders]);

  // Opened from a reminder: show that activity's details on its day, once.
  useEffect(() => {
    if (!params.focus) return;
    const item = prescription.items.find((i) => i.key === params.focus || i.options.some((o) => o.id === params.focus));
    if (!item) return;
    setSheetItem(item);
    router.setParams({ focus: undefined });
  }, [params.focus, prescription]);
  // Workout card (#28): collapsed by default; remembered per day and item for this app session.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const expandKey = (item: PrescriptionItem) => `${date}|${item.key}`;
  // A workout just finished from the card: hold "complete · 5/5" briefly before "Do this next" moves on.
  const [held, setHeld] = useState<string | null>(null);
  useEffect(() => {
    if (!held) return;
    const t = setTimeout(() => setHeld(null), 4000);
    return () => clearTimeout(t);
  }, [held]);
  const [pendingSwitch, setPendingSwitch] = useState<{ item: PrescriptionItem; variant: Variant } | null>(null);
  const [guideFor, setGuideFor] = useState<PrescribedExercise | null>(null);
  const [sheetMeasurement, setSheetMeasurement] = useState<Measurement | null>(null);
  const [dayTypeOpen, setDayTypeOpen] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const clearToast = useCallback(() => setToast(null), []);

  const budgetNote = useMemo(() => {
    if (!day.flexibleBudget) return {} as Record<string, string>;
    const text = day.flexibleBudget.lines
      .map((l) => `≈ ${formatAmount(plan, l.quantity, l.remaining, energy)} ${l.quantity === 'energy' ? 'left' : `${l.label.toLowerCase()} to go`}`)
      .join(' · ');
    return { [day.flexibleBudget.activityId]: text };
  }, [day.flexibleBudget, plan, energy]);

  const press = (item: PrescriptionItem, a: Activity) => {
    tap();
    actions.advance(item, a);
  };
  const tickExercise = (item: PrescriptionItem, row: ChecklistRow) => {
    if (!editable || !item.activity) return;
    tap();
    const c = actions.tickExercise(item, item.activity, row.key, !row.done);
    if (c.event.action === 'complete' && date === today) setHeld(item.key);
  };
  const chooseVariant = (item: PrescriptionItem, variant: Variant) => {
    if (!editable || !item.activity || !item.session) return;
    if (switchNeedsConfirm(item.session, records.activities[item.key])) setPendingSwitch({ item, variant });
    else actions.chooseVariant(item, item.activity, variant);
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
        exerciseProgress={item.session ? sessionProgress(item.session, records.activities[item.key]) : null}
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
  // A new user who skipped the AI step (#49): no plan yet, so Today offers to set one up instead of "Do this next".
  const noPlan = plan.activities.length === 0;
  // The top slot (contract 08): a workout just finished, the due workout, or the next-action card. Absent when there's
  // nothing reasonable to do now (#41): no placeholder, and the day's checklist below is unchanged.
  const topCard = (() => {
    if (date !== today || noPlan) return null;
    const heldItem = held ? prescription.items.find((i) => i.key === held && i.state === 'done') : undefined;
    // A workout's checklist only appears once it's due; before that it's an "Up next" preview like any item (#51).
    const workout = heldItem ?? (isDue(next) && next?.item.session && next.item.activity ? next.item : undefined);
    return workout || next ? { heldItem, workout } : null;
  })();
  const noCardToday = date === today && !noPlan && topCard === null;

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
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

        {date === today && noPlan && (
          <View style={styles.firstBlock}>
            <NoPlanCard minor={plan.profile?.ageBand === 'under_18'} onSetUp={() => router.push('/configure')} />
          </View>
        )}

        {topCard && (() => {
          const { heldItem, workout } = topCard;
          return (
            <View style={styles.firstBlock}>
              {!workout ? (
                <NextActionCard plan={plan} energy={energy} next={next!} nowMinutes={nowMinutes} logs={records.activities} onAdvance={press} onDetails={setSheetItem} />
              ) : (
                <WorkoutCard
                  item={workout}
                  progress={sessionProgress(workout.session!, records.activities[workout.key])}
                  expanded={!!expanded[expandKey(workout)]}
                  onToggleExpanded={() => setExpanded((e) => ({ ...e, [expandKey(workout)]: !e[expandKey(workout)] }))}
                  onTick={(row) => tickExercise(workout, row)}
                  onChooseVariant={(v) => chooseVariant(workout, v)}
                  onOpenExercise={setGuideFor}
                  onDetails={() => setSheetItem(workout)}
                  completed={!!heldItem}
                  onDismissCompleted={() => setHeld(null)}
                />
              )}
            </View>
          );
        })()}

        {/* With no card above, the measurements take its place right under the header (vertical budget, contract 02). */}
        <View style={noCardToday ? styles.firstBlock : styles.block}>
          <MeasurementPanel
            plan={plan}
            date={date}
            due={day.measurementsDue}
            latest={latestMeasurement}
            editable={editable}
            onLog={setSheetMeasurement}
          />
          <TargetsLine plan={plan} targets={day.targets} energy={energy} />
        </View>

        {nothingPlanned && !(noPlan && date === today) && <Text style={[type.body, styles.empty]}>Nothing planned for this day</Text>}

        {groups.map((g) => (
          <View key={g.part} style={styles.block} testID={`part-${g.part}`}>
            <Text style={type.section} accessibilityRole="header">
              {partLabels[g.part]}
            </Text>
            <View style={styles.list}>{g.items.map(renderItem)}</View>
          </View>
        ))}

        <View style={styles.block}>
          <RecordedSection plan={plan} energy={energy} observations={recorded} outsidePlan={outsidePlan} onOpen={setSheetObservation} />
        </View>

      </ScrollView>

      {/* Toasts float above this zero-content dock at the bottom safe-area edge. */}
      <SafeAreaView edges={['bottom']} style={styles.toastDock} pointerEvents="box-none">
        <Toast toast={toast} onDone={clearToast} />
      </SafeAreaView>

      <ItemSheet
        energy={energy}
        item={sheetItem && (prescription.items.find((i) => i.key === sheetItem.key) ?? null)}
        logs={records.activities}
        editable={editable}
        onClose={() => setSheetItem(null)}
        onSetDone={(item, a, done, variant) => actions.setDone(item, a, done, variant)}
        onSetSkipped={(item, skipped) => (skipped ? toggleSkip(item) : actions.setSkipped(item, false))}
        plan={plan}
        onTickExercise={tickExercise}
        onChooseVariant={chooseVariant}
      />
      <ConfirmDialog
        visible={!!pendingSwitch}
        title={pendingSwitch?.variant === 'short' ? 'Switch to the short version?' : 'Switch to the full version?'}
        message="The exercises you've ticked stay saved with this version. The other version has its own checklist, because its sets and reps differ."
        confirmLabel="Switch"
        onCancel={() => setPendingSwitch(null)}
        onConfirm={() => {
          if (pendingSwitch?.item.activity) actions.chooseVariant(pendingSwitch.item, pendingSwitch.item.activity, pendingSwitch.variant);
          setPendingSwitch(null);
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
        energy={energy}
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
  content: { paddingHorizontal: space.xl, paddingBottom: space.xxl },
  block: { marginTop: space.xl },
  /** The card follows the day header closely: it's the point of the screen (vertical budget, contract 02). */
  firstBlock: { marginTop: space.lg },
  notice: { marginTop: space.md },
  empty: { marginTop: space.xl, color: colors.muted },
  list: { marginTop: space.xs },
  toastDock: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: space.lg },
});
