import { movementSupported } from '../../exercises/availability';
import type { EnergyDisplay } from '../../energy';
import { useEffect, useState } from 'react';
import { CoverageSheet } from '../muscles/CoverageSheet';
import { MuscleMap } from '../muscles/MuscleMap';
import type { LocalDate } from '../../plan/dates';
import { toLocalDate } from '../../plan/dates';
import { StyleSheet, Text, View } from 'react-native';
import { ScrollView } from '../../ui/ScrollView';
import { buildGuide } from '../../exercises/guide';
import { ExerciseGuideSheet } from '../exercise-guide/ExerciseGuideSheet';
import { formatClock, formatDuration } from '../../format';
import { mealView } from '../../plan/meals';
import type { Activity, Plan } from '../../plan/schema';
import type { PrescribedExercise } from '../../prescription/session';
import type { PrescriptionItem } from '../../prescription/prescribe';
import { partLabels } from '../../prescription/windows';
import type { ActivityLog } from '../../storage/types';
import { Button } from '../../ui/Button';
import { Sheet } from '../../ui/Sheet';
import { space, useTheme } from '../../ui/theme';
import { MealDetails } from './MealDetails';
import { ExerciseChecklist, VersionSwitch } from './ExerciseChecklist';
import { sessionProgress, type ChecklistRow, type SessionOrder, type Variant } from '../../prescription/exercises';
import { ModalHeader } from '../../ui/ModalHeader';
import type { MealLog } from '../../nutrition/contract';
import { ReplacedMeal } from '../meal-photo/ReplacedMeal';

type Props = {
  date?: LocalDate;
  /** Today's display order for the session's exercises (#56 option C); absent = plan order. */
  sessionOrder?: SessionOrder;
  item: PrescriptionItem | null;
  logs: Record<string, ActivityLog | undefined>;
  editable: boolean;
  onClose: () => void;
  onSetDone: (item: PrescriptionItem, a: Activity, done: boolean, variant?: 'full' | 'short') => void;
  onSetSkipped: (item: PrescriptionItem, skipped: boolean) => void;
  /** Tick/untick one exercise of a session (#28); works on any editable day, so past days can be corrected. */
  onTickExercise: (item: PrescriptionItem, row: ChecklistRow) => void;
  onChooseVariant: (item: PrescriptionItem, v: Variant) => void;
  /** The active plan: meal details and exercise guides are rendered from it. */
  plan: Plan;
  /** How energy is shown (#39). */
  energy: EnergyDisplay;
  /** What was actually eaten instead of this scheduled meal (#97), if anything. */
  mealLog?: MealLog | null;
  /** Open the "Log different meal" wizard for this meal (#97). */
  onLogDifferent?: (item: PrescriptionItem) => void;
  onEditMeal?: (log: MealLog) => void;
  onRemoveMeal?: (log: MealLog) => void;
};

/** Secondary actions for a prescribed item: session details, short version, alternatives, skip/restore. */
export function ItemSheet({ date = toLocalDate(new Date()), item, logs, editable, onClose, onSetDone, onSetSkipped, plan, energy, onTickExercise, onChooseVariant, sessionOrder, mealLog, onLogDifferent, onEditMeal, onRemoveMeal }: Props) {
  const { colors, type } = useTheme();

  const exerciseConfig = plan.exercise;
  const [guideFor, setGuideFor] = useState<PrescribedExercise | null>(null);
  const [coverageOpen, setCoverageOpen] = useState(false);
  useEffect(() => { setCoverageOpen(false); setGuideFor(null); }, [item?.key]);
  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };
  const a = item?.activity;
  const meal = a ? mealView(plan, a, energy) : null;
  const session = item?.session;
  const progress = item && session ? sessionProgress(session, logs[item.key], sessionOrder) : null;
  const equipmentUnavailable = item?.equipmentUnavailable || (!!a?.movement && !movementSupported(a.movement, exerciseConfig));
  const when = item ? (item.window.time ? formatClock(item.window.time) : partLabels[item.window.part]) : '';
  return (
    <Sheet visible={!!item} onClose={() => {
      setGuideFor(null);
      onClose();
    }} label={item ? `${item.label} details` : 'Details'}>
      {item && (
        <View style={styles.body}>
          {equipmentUnavailable && <Text style={type.detail}>Equipment unavailable. Review My Gym; this scheduled activity is kept for review and historical corrections.</Text>}
          <ModalHeader title={item.label} dismiss={{ label: 'Close', onPress: onClose }} />
          <Text style={[type.detail, styles.center]}>
            {[when, a ? formatDuration(a.duration) : null, item.required ? null : 'Optional', item.detail].filter(Boolean).join(' · ')}
          </Text>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} testID="item-sheet-scroll">
            {mealLog && (
              <ReplacedMeal
                log={mealLog}
                energy={energy}
                editable={editable}
                onEdit={() => {
                  onClose();
                  onEditMeal?.(mealLog);
                }}
                onRemove={() => onRemoveMeal?.(mealLog)}
              />
            )}

            {meal && !mealLog && (
              <View style={styles.block}>
                {meal.ingredients.length > 0 && <Text style={type.section}>What to prepare</Text>}
                <MealDetails meal={meal} variant="sheet" testID="meal-details" />
              </View>
            )}

            {session && progress && (
              <View style={styles.block}>
                <MuscleMap compact gender={plan.profile?.gender} />
                <Button title="Muscle coverage & log exercise" variant="secondary" onPress={() => setCoverageOpen(true)} />
                <Text style={type.section}>
                  {progress.done} of {progress.total} exercises
                </Text>
                {progress.hasShort && (
                  <VersionSwitch
                    progress={progress}
                    fullMinutes={session.minutes}
                    shortMinutes={session.short?.minutes}
                    editable={editable}
                    onChoose={(v) => onChooseVariant(item, v)}
                  />
                )}
                <ExerciseChecklist
                  equipmentConfig={plan.exercise}
                  rows={progress.rows}
                  nextKey={progress.next?.key}
                  editable={editable && item.state !== 'skipped'}
                  onToggle={(row) => onTickExercise(item, row)}
                  onOpen={setGuideFor}
                  testID="sheet-session"
                />
              </View>
            )}

            <View style={styles.actions}>
              {mealLog ? null : item.state === 'skipped' ? (
                <>
                  <Button title="Restore" disabled={!editable} onPress={act(() => onSetSkipped(item, false))} />
                  {a?.kind === 'meal' && editable && onLogDifferent && (
                    <Button title="📷 Log different meal" variant="secondary" onPress={act(() => onLogDifferent(item))} testID="sheet-log-different" />
                  )}
                </>
              ) : item.kind === 'activity' && a ? (
                <>
                  {session && progress ? (
                    // A retrospective override: the card and checklist are the way to train (#28).
                    <Button
                      title={item.state === 'done' ? 'Mark not done' : `Mark whole workout done (${progress.variant === 'short' ? 'short' : 'full'})`}
                      variant="secondary"
                      disabled={!editable}
                      onPress={act(() => onSetDone(item, a, item.state !== 'done', progress.variant))}
                    />
                  ) : (
                    <Button
                      title={item.state === 'done' ? 'Mark not done' : 'Mark done'}
                      disabled={!editable}
                      onPress={act(() => onSetDone(item, a, item.state !== 'done'))}
                    />
                  )}
                  {a.kind === 'meal' && editable && onLogDifferent && (
                    // Record what was actually eaten (#97): the plan recipe is never counted as eaten.
                    <Button title="📷 Log different meal" variant="secondary" onPress={act(() => onLogDifferent(item))} testID="sheet-log-different" />
                  )}
                  <Button title="Skip" variant="secondary" disabled={!editable} onPress={act(() => onSetSkipped(item, true))} />
                </>
              ) : (
                <>
                  {item.options.filter(o => !o.movement || movementSupported(o.movement, plan.exercise) || !!logs[o.id]?.status).map((o) => {
                    const isDone = logs[o.id]?.status === 'done';
                    return (
                      <Button
                        key={o.id}
                        title={isDone ? `Undo ${o.label}` : `Done with ${o.label}`}
                        variant={isDone ? 'secondary' : 'primary'}
                        disabled={!editable || (item.state === 'done' && !isDone)}
                        onPress={act(() => onSetDone(item, o, !isDone))}
                      />
                    );
                  })}
                  <Button title="Skip" variant="secondary" disabled={!editable} onPress={act(() => onSetSkipped(item, true))} />
                </>
              )}
            </View>
          </ScrollView>
        </View>
      )}
      {/* Nested so closing the guide returns to this sheet (contract 09). */}
      <ExerciseGuideSheet gender={plan.profile?.gender} guide={item && guideFor ? buildGuide(guideFor, exerciseConfig) : null} onClose={() => setGuideFor(null)} />
      {item && coverageOpen && <CoverageSheet date={date} editable={editable} session={session} onClose={() => setCoverageOpen(false)} />}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingBottom: space.md, gap: space.md, flexShrink: 1 },
  scroll: { flexShrink: 1 },
  scrollContent: { gap: space.md },
  center: { textAlign: 'center' },
  block: { gap: space.sm },
  gap: { marginTop: space.md },
  actions: { gap: space.sm, marginTop: space.sm },
});
