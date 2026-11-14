import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ScrollView } from '../../ui/ScrollView';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../../providers/AppProvider';
import { formatAmount } from '../../format';
import { measurementMetric } from '../../observations/planMetrics';
import { addDays, weekdayOf, type LocalDate } from '../../plan/dates';
import type { Observation } from '../../observations/types';
import type { Activity, Measurement } from '../../plan/schema';
import { tap } from '../../ui/haptics';
import { space, useTheme, createThemedStyles } from '../../ui/theme';
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
import { useTakeMealPhoto } from '../meal-photo/takeMealPhoto';
import { NoPlanCard } from './NoPlanCard';
import { isDue } from '../../prescription/nextAction';
import { useReminders } from '../reminders/RemindersProvider';
import { TodayWorkoutCard, TodayWorkoutSheet } from './TodayWorkout';
import { ShareDaySheet } from './ShareDaySheet';
import { dailySummary } from '../../share/dailySummary';
import { todayWorkout, workoutToggle, type WorkoutRow } from '../../exercises/todayWorkout';
import { HISTORY_DAYS, logExercise } from '../../exercises/state';
import type { ExerciseLog } from '../../storage/types';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { switchNeedsConfirm, type ChecklistRow, type Variant } from '../../prescription/exercises';
import { RequirementRow } from './RequirementRow';
import { partLabels, partOrder } from '../../prescription/windows';
import type { PrescriptionItem } from '../../prescription/prescribe';
import { TargetsLine } from './TargetsLine';
import { Toast, type ToastState } from '../../ui/Toast';
import { useClock, useDay } from './useDay';
import { useExerciseState } from './useExerciseState';
import { CoverageSheet } from '../muscles/CoverageSheet';
import { GamificationCard, GamificationCelebration } from '../../gamification/Gamification';
import { useGamification } from '../../gamification/GamificationProvider';
import type { MealLog } from '../../nutrition/contract';
import { confirmedMeals, dayLogs as dayActivityLogs } from '../../nutrition/plannedMeals';
import { dayIntake } from '../../nutrition/intake';
import { restOfDay } from '../../nutrition/restOfDay';
import { RestOfDayCard } from './RestOfDayCard';
import { intakeLines, mealSummary, sourceTag } from '../../nutrition/format';
import { replacementCompletion } from '../../nutrition/replace';
import { deletePhoto } from '../../platform/mealPhotos';
import { localIsoTimestamp } from '../../format';
import { MUSCLE_GROWTH, inventoryFor, muscleGrowthDay, muscleGrowthLog, muscleGrowthLogId, progressionHint, type MuscleGrowthRow } from '../../exercises/catalogue';
import { MuscleGrowthEditor } from '../muscle-growth/MuscleGrowthEditor';
import { MuscleGrowthLogSheet } from './MuscleGrowthLogSheet';
import { MuscleGrowthSection } from './MuscleGrowthSection';
import { RecommendedResistance } from './RecommendedResistance';
import { recommendedResistance } from '../../exercises/recommendedResistance';
import { oneTapLogId } from '../../exercises/todayWorkout';

const isLocalDate = (d: unknown): d is LocalDate =>
  typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(`${d}T12:00:00`).getTime());

/**
 * The Daily Log day view (contract 02): one screen for every date. "Today" is just the current date.
 * The selected date lives in the URL (`/?date=YYYY-MM-DD`; none = today), so reload and links keep it.
 * Contains layout and generic copy only — every plan word comes from data.
 */
export function DayLogScreen() {
  const gamification = useGamification();
  const [coverage, setCoverage] = useState<null | 'map' | 'inventory'>(null);
  const [workoutOpen, setWorkoutOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const { colors, type } = useTheme();
  const styles = useStyles();

  const { store, plan, energy, dataVersion, notifyDataChanged } = useApp();
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
  // #56 option C: today's scheduled sessions keep their exercises, shown in muscle-priority order (plan order until
  // there's enough history). Display order only: exercise keys and ticks never change.
  const { state: exerciseState, loading: exerciseLoading } = useExerciseState(store, plan, today, prescription, date === today, dataVersion, nowMinutes, JSON.stringify(records.activities));
  const orderOf = (key: string) => (date === today ? exerciseState?.sessionOrders[key] : undefined);

  // Today's workout (#56, layout A): every eligible strength exercise plus the day's plan, on every date.
  const [dayLogs, setDayLogs] = useState<ExerciseLog[]>([]);
  useEffect(() => {
    let live = true;
    store.exerciseLogs({ from: date, to: date }).then((l) => live && setDayLogs(l), () => live && setDayLogs([]));
    return () => {
      live = false;
    };
  }, [store, date, dataVersion]);
  // Muscle Growth items (#122) have their own checklist: Today's workout counts only free logs as extras.
  const freeLogs = useMemo(() => dayLogs.filter((l) => l.routine !== MUSCLE_GROWTH), [dayLogs]);
  const catalogue = useMemo(() => inventoryFor(plan), [plan]);
  const workout = useMemo(
    () =>
      todayWorkout({
        plan,
        date,
        items: prescription.items,
        logs: records.activities,
        freeLogs,
        state: date === today && exerciseState ? exerciseState : null,
        restDay: (plan.exercise?.restDays ?? []).includes(weekdayOf(date)),
        inventory: catalogue,
      }),
    [plan, date, today, prescription, records, freeLogs, exerciseState, catalogue],
  );

  // Muscle Growth (#122): the day's checklist, and progression hints from earlier completed sessions (advice only).
  const growth = useMemo(() => muscleGrowthDay(plan, date, dayLogs, catalogue), [plan, date, dayLogs, catalogue]);
  const recommendation = useMemo(() => recommendedResistance({ plan, date, state: exerciseState, workout, growth, inventory: catalogue, logs: records.activities }), [plan, date, exerciseState, workout, growth, catalogue, records.activities]);
  const [growthHistory, setGrowthHistory] = useState<ExerciseLog[]>([]);
  const growthOn = !!plan.exercise?.muscleGrowth;
  useEffect(() => {
    if (!growthOn) return setGrowthHistory([]);
    let live = true;
    store.exerciseLogs({ from: addDays(date, -HISTORY_DAYS), to: addDays(date, -1) }).then((l) => live && setGrowthHistory(l), () => live && setGrowthHistory([]));
    return () => {
      live = false;
    };
  }, [store, date, dataVersion, growthOn]);
  const growthHints = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of growth?.rows ?? []) {
      const h = r.status === 'pending' ? progressionHint(r.movement, r.planned, growthHistory, date) : null;
      if (h) out[r.movement] = h;
    }
    return out;
  }, [growth, growthHistory, date]);
  const [growthEditor, setGrowthEditor] = useState(false);
  const [growthDetails, setGrowthDetails] = useState<MuscleGrowthRow | null>(null);
  const writeGrowth = (write: Promise<unknown>) => write.then(notifyDataChanged, () => setToast({ key: Date.now(), message: "Couldn't save. Try again." }));
  // The circle completes (or, when done, clears); Skip skips (or, when skipped, clears). One record per date and
  // movement, so switching between them never duplicates a log.
  const completeGrowth = (r: MuscleGrowthRow) => {
    if (!editable) return;
    tap();
    writeGrowth(r.status === 'done' ? store.removeExerciseLog(muscleGrowthLogId(date, r.movement)) : store.addExerciseLog(muscleGrowthLog(r, date, localIsoTimestamp(), 'done')));
  };
  const skipGrowth = (r: MuscleGrowthRow) => {
    if (!editable) return;
    tap();
    writeGrowth(r.status === 'skipped' ? store.removeExerciseLog(muscleGrowthLogId(date, r.movement)) : store.addExerciseLog(muscleGrowthLog(r, date, localIsoTimestamp(), 'skipped')));
  };

  // Meals actually eaten (#97): replaced scheduled meals and the day's "Eaten" totals.
  const [mealLogs, setMealLogs] = useState<MealLog[]>([]);
  const loadMeals = useCallback(() => {
    let live = true;
    store.mealLogs({ from: date, to: date }).then((l) => live && setMealLogs(l), () => live && setMealLogs([]));
    return () => {
      live = false;
    };
  }, [store, date]);
  useEffect(loadMeals, [loadMeals, dataVersion]);
  const mealFor = useMemo(() => Object.fromEntries(mealLogs.filter((m) => m.activityId && m.planId === plan.id).map((m) => [m.activityId!, m])) as Record<string, MealLog | undefined>, [mealLogs, plan.id]);
  // #154: ticked plan meals count as eaten, at their planned estimates (a replaced meal counts as its logged meal).
  const confirmed = useMemo(() => confirmedMeals(dayActivityLogs(records.activities, plan.id, date), mealLogs, (_d, planId) => (planId === plan.id ? plan : null)), [records, plan, date, mealLogs]);
  const eaten = useMemo(() => intakeLines(dayIntake(date, mealLogs, records.observations, confirmed), energy), [date, mealLogs, records, energy, confirmed]);
  const rest = useMemo(
    () =>
      restOfDay({
        plan, date, today, nowMinutes, items: prescription.items, mealLogs, confirmed, observations: records.observations, energy,
        weightKg: latestMeasurement.weight?.value ?? null,
        restDay: (plan.exercise?.restDays ?? []).includes(weekdayOf(date)),
        injured: !!exerciseState?.coverage.some((c) => c.report === 'injured'),
      }),
    [plan, date, today, nowMinutes, prescription, mealLogs, confirmed, records, energy, latestMeasurement, exerciseState],
  );
  const [removingMeal, setRemovingMeal] = useState<MealLog | null>(null);
  const logDifferent = (item: PrescriptionItem) => router.push({ pathname: '/meal-photo', params: { date, activity: item.key } });
  // #183: one flow: camera → the AI share sheet (photo + prompt) → the AI's block comes back to /meal-return.
  const photo = useTakeMealPhoto({ store, plan });
  const takePhoto = (item: PrescriptionItem) => photo.take({ date, activityId: item.key });
  useEffect(() => {
    if (photo.notice) {
      setToast({ key: Date.now(), message: photo.notice });
      photo.clearNotice();
    }
  }, [photo.notice]); // eslint-disable-line react-hooks/exhaustive-deps
  const editMeal = (log: MealLog) => router.push({ pathname: '/meal-photo', params: { date: log.date, edit: log.id } });
  const removeMeal = async (log: MealLog) => {
    setRemovingMeal(null);
    setSheetItem(null);
    try {
      const undo = log.activityId && log.planId === plan.id ? replacementCompletion(plan, log.date, records, log.activityId, false, localIsoTimestamp()) : null;
      await store.removeMealLog(log.id, undo);
      await Promise.all(log.photos.map((p) => deletePhoto(p.uri)));
      setToast({ key: Date.now(), message: `Removed ${log.name}` });
    } catch {
      setToast({ key: Date.now(), message: "Couldn't remove the meal. Try again." });
    }
    reload();
    notifyDataChanged();
  };

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
      else {
        reload();
        loadMeals();
      }
    }, [reload, loadMeals]),
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
    // A replaced meal (#97) is undone by removing what was eaten, in its sheet: a tap opens the sheet instead.
    if (mealFor[item.key]) return setSheetItem(item);
    tap();
    actions.advance(item, a);
  };
  const tickExercise = (item: PrescriptionItem, row: ChecklistRow) => {
    if (!editable || !item.activity) return;
    tap();
    const c = actions.tickExercise(item, item.activity, row.key, !row.done);
    if (c.event.action === 'complete') setToast({ key: Date.now(), message: `${item.label} complete` });
  };
  // One tap on Today's workout: the session tick for a planned exercise, else one free log (fixed id per day and
  // movement, so a repeated tap can't add a second record). Unticking undoes whichever record made it done.
  const toggleWorkout = (row: WorkoutRow) => {
    if (!editable) return;
    const t = workoutToggle(row, date);
    if (t.kind === 'session') {
      const item = prescription.items.find((i) => i.key === t.activityId);
      if (item) tickExercise(item, { key: t.key, done: !t.ticked, exercise: { movement: row.movement, label: row.name }, optional: false });
      return;
    }
    tap();
    const write =
      t.kind === 'log'
        ? logExercise(store, { id: t.id, movement: row.movement, date, at: new Date().toISOString(), sets: t.dose.sets, reps: t.dose.reps, seconds: t.dose.seconds }, catalogue)
        : Promise.all(t.ids.map((id) => store.removeExerciseLog(id)));
    write.then(notifyDataChanged, () => setToast({ key: Date.now(), message: "Couldn't save. Try again." }));
  };
  // A planned exercise opens its guide as prescribed (substitution, caution, today's dose); others with their dose.
  const workoutGuide = (row: WorkoutRow) => setGuideFor(row.prescribed ?? { movement: row.movement, label: row.name, sets: row.dose.sets, reps: row.dose.reps, seconds: row.dose.seconds });
  const optionalWrite = useRef(false);
  const logRecommended = async (row: WorkoutRow) => {
    if (date !== today || optionalWrite.current || row.done || row.plan) return;
    optionalWrite.current = true;
    const id = oneTapLogId(date, row.movement);
    try {
      await logExercise(store, { id, movement: row.movement, date, at: new Date().toISOString(), ...row.dose }, catalogue);
      notifyDataChanged();
      setToast({ key: Date.now(), message: `${row.name} logged`, onUndo: () => { store.removeExerciseLog(id).then(notifyDataChanged, () => setToast({ key: Date.now(), message: "Couldn't undo. Try again." })); } });
    } catch { setToast({ key: Date.now(), message: "Couldn't save. Try again." }); }
    finally { optionalWrite.current = false; }
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
        exerciseProgress={null}
        editable={editable}
        isNext={next?.item.key === item.key}
        onPress={() => press(item, item.activity!)}
        onMore={() => setSheetItem(item)}
        onSkipToggle={() => toggleSkip(item)}
        replacedBy={mealFor[item.key] ? { name: mealFor[item.key]!.name, summary: mealSummary(mealFor[item.key]!, energy), tag: sourceTag(mealFor[item.key]!) } : null}
      />
    );
  // Grouped by part of the day; anytime last (contract 08).
  const groups = partOrder
    // Strength sessions live on Today's workout card, not in the time-of-day list (#56).
    .map((part) => ({ part, items: prescription.items.filter((i) => i.window.part === part && !(i.kind === 'activity' && i.session)) }))
    .filter((g) => g.items.length);
  const nothingPlanned = !prescription.items.length;
  // A new user who skipped the AI step (#49): no plan yet, so Today offers to set one up instead of "Do this next".
  const noPlan = plan.activities.length === 0;
  // The top slot (contract 08): a workout just finished, the due workout, or the next-action card. Absent when there's
  // nothing reasonable to do now (#41): no placeholder, and the day's checklist below is unchanged.
  const topCard = (() => {
    if (date !== today || noPlan) return null;
    // The strength session is due (#41): Today's workout card takes the top slot. Before that it's "Up next" (#51).
    const promoted = isDue(next) && !!next?.item.session && !!next.item.activity;
    return promoted || next ? { promoted } : null;
  })();
  const showWorkout = !noPlan || workout.total > 0;
  // Today's order comes from history (#56): until it has loaded, don't show rows that would then reorder.
  const workoutLoading = date === today && exerciseLoading && !exerciseState;
  const workoutCard = (promoted: boolean) => (
    <TodayWorkoutCard workout={workout} promoted={promoted} editable={editable} loading={workoutLoading} onToggle={toggleWorkout} onGuide={workoutGuide} onOpen={() => setWorkoutOpen(true)} />
  );
  const noCardToday = date === today && !noPlan && topCard === null && !showWorkout;

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
          // Share this day (#76): the selected date, today or past; future days have nothing recorded yet.
          onShare={editable ? () => setShareOpen(true) : undefined}
        />

        {!editable && <Text style={[type.detail, styles.notice]}>Upcoming. You can tick these off on the day.</Text>}

        {date === today && noPlan && (
          <View style={styles.firstBlock}>
            <NoPlanCard minor={plan.profile?.ageBand === 'under_18'} onSetUp={() => router.push('/configure')} />
          </View>
        )}

        {topCard && (
          <View style={styles.firstBlock}>
            {topCard.promoted ? workoutCard(true) : <NextActionCard plan={plan} energy={energy} next={next!} nowMinutes={nowMinutes} logs={records.activities} onAdvance={press} onDetails={setSheetItem} onTakePhoto={takePhoto} />}
          </View>
        )}

        {/* Today's workout (#56): every day, in the content layer, right after the top card (unless it is the top card). */}
        {showWorkout && !topCard?.promoted && <View style={topCard ? styles.block : styles.firstBlock}>{workoutCard(false)}</View>}

        {/* Muscle Growth (#122): its own section after Today's workout, only when the user has set it up. */}
        {growth && (growth.offered || growth.rows.length > 0) && (
          <View style={styles.block}>
            <MuscleGrowthSection
              day={growth}
              when={plan.exercise?.muscleGrowth?.when}
              inventory={catalogue}
              coverage={date === today ? exerciseState?.coverage ?? null : null}
              hints={growthHints}
              editable={editable}
              onComplete={completeGrowth}
              onSkip={skipGrowth}
              onGuide={setGuideFor}
              onDetails={setGrowthDetails}
              onEdit={() => setGrowthEditor(true)}
            />
          </View>
        )}

        {date === today && <View style={styles.block}><RecommendedResistance recommendation={recommendation} loading={exerciseLoading} gender={plan.profile?.gender} onLog={logRecommended} onGuide={workoutGuide} /></View>}

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
          <TargetsLine plan={plan} targets={day.targets} energy={energy} eaten={eaten} />
        </View>
        {/* #99: optional rest-of-day suggestions once a meal is logged today. */}
        {rest.show && <View style={styles.block}><RestOfDayCard model={rest} /></View>}

        {date === today && gamification?.enabled && <View style={styles.block}><GamificationCelebration /><GamificationCard /></View>}

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

      {shareOpen && (
        <ShareDaySheet
          text={dailySummary({ plan, date, dayTypeLabel: day.dayTypeLabel, items: prescription.items, records, exerciseLogs: freeLogs })}
          onClose={() => setShareOpen(false)}
          onResult={(r) => {
            if (r === 'dismissed') return; // back on the preview, nothing sent
            if (r === 'unavailable') return setToast({ key: Date.now(), message: "Sharing isn't available here." });
            setShareOpen(false);
            if (r === 'copied') setToast({ key: Date.now(), message: 'Copied. Paste it into ChatGPT, Claude or another app.' });
          }}
        />
      )}
      {/* Under the sheets it opens (guide, item options, coverage): those render after it, on top. */}
      {workoutOpen && (
        <TodayWorkoutSheet
          workout={workout}
          loading={workoutLoading}
          coverage={date === today ? exerciseState?.coverage ?? null : null}
          gender={plan.profile?.gender}
          editable={editable}
          onToggle={toggleWorkout}
          onGuide={workoutGuide}
          onCoverage={() => setCoverage('map')}
          onLogDifferent={() => setCoverage('inventory')}
          onSessionOptions={(s) => setSheetItem(s)}
          onClose={() => setWorkoutOpen(false)}
        />
      )}
      <ItemSheet
        date={date}
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
        sessionOrder={sheetItem ? orderOf(sheetItem.key) : undefined}
        mealLog={sheetItem ? mealFor[sheetItem.key] ?? null : null}
        onLogDifferent={logDifferent}
        onTakePhoto={takePhoto}
        onEditMeal={editMeal}
        onRemoveMeal={setRemovingMeal}
      />
      <ConfirmDialog
        visible={!!removingMeal}
        title={`Remove ${removingMeal?.name ?? 'this meal'}?`}
        message={`${removingMeal?.replacedLabel ? `${removingMeal.replacedLabel} goes back to not done. ` : ''}${removingMeal?.photos.length ? `Its ${removingMeal.photos.length} photo${removingMeal.photos.length === 1 ? '' : 's'} will be deleted from this phone.` : ''}`.trim() || 'It will no longer count as eaten.'}
        confirmLabel="Remove"
        onCancel={() => setRemovingMeal(null)}
        onConfirm={() => removingMeal && removeMeal(removingMeal)}
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
      <ExerciseGuideSheet gender={plan.profile?.gender} guide={guideFor ? buildGuide(guideFor, plan.exercise) : null} onClose={() => setGuideFor(null)} />
      {growthEditor && <MuscleGrowthEditor onClose={() => setGrowthEditor(false)} />}
      {growthDetails && (
        <MuscleGrowthLogSheet
          row={growthDetails}
          onClose={() => setGrowthDetails(null)}
          onSave={(d) => {
            const r = growthDetails;
            setGrowthDetails(null);
            writeGrowth(store.addExerciseLog(muscleGrowthLog(r, date, r.log?.at ?? localIsoTimestamp(), 'done', d)));
          }}
        />
      )}
      {coverage && <CoverageSheet date={date} editable={editable} initialPage={coverage} session={workout.sessions.find((s) => s.state !== 'skipped')?.session} onClose={() => setCoverage(null)} />}
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

const useStyles = createThemedStyles(({ colors, type }) => ({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.xl, paddingBottom: space.xxl },
  block: { marginTop: space.xl },
  /** The card follows the day header closely: it's the point of the screen (vertical budget, contract 02). */
  firstBlock: { marginTop: space.lg },
  notice: { marginTop: space.md },
  empty: { marginTop: space.xl, color: colors.muted },
  list: { marginTop: space.xs },
  toastDock: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: space.lg },
}));
