import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { exerciseState, loadExerciseHistory, logExercise, reportMuscle, type ExerciseState } from '../../exercises/state';
import { eligibleExercises, exerciseInventory, type InventoryExercise } from '../../exercises/inventory';
import { buildGuide } from '../../exercises/guide';
import { doseFor } from '../../exercises/todayWorkout';
import { newId, type ExerciseLog } from '../../storage/types';
import type { LocalDate } from '../../plan/dates';
import type { PrescribedSession } from '../../prescription/session';
import { useApp } from '../../providers/AppProvider';
import { Button } from '../../ui/Button';
import { ModalHeader } from '../../ui/ModalHeader';
import { Sheet } from '../../ui/Sheet';
import { createThemedStyles, radius, space, touch, useTheme } from '../../ui/theme';
import { useClock } from '../daily-log/useDay';
import { ExerciseGuideSheet } from '../exercise-guide/ExerciseGuideSheet';
import { coverageLabel, MuscleMap, type MapMode } from './MuscleMap';

/** Real #56 history and store actions; this component contains presentation, not a second recovery engine. */
export function CoverageSheet({ date, editable, session, onClose }: { date: LocalDate; editable: boolean; session?: PrescribedSession; onClose: () => void }) {
  const { store, plan, dataVersion, notifyDataChanged } = useApp();
  const { today } = useClock();
  const { colors, type } = useTheme();
  const styles = useStyles();
  const [state, setState] = useState<ExerciseState | null>(null);
  const [logs, setLogs] = useState<ExerciseLog[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [page, setPage] = useState<'map' | 'inventory' | 'exercise'>('map');
  const [mode, setMode] = useState<MapMode>('priority');
  const [selected, setSelected] = useState('chest');
  const [exercise, setExercise] = useState<InventoryExercise | null>(null);
  const [guide, setGuide] = useState(false);
  const [sets, setSets] = useState('1');
  const [dose, setDose] = useState('1');
  const [unit, setUnit] = useState<'reps' | 'seconds'>('reps');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const scroll = useRef<ScrollView>(null);
  const entryId = useRef(newId());
  const alive = useRef(true);
  const request = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = useCallback(async () => {
    const sequence = ++request.current;
    const [history, recorded] = await Promise.all([loadExerciseHistory(store, plan, today), store.exerciseLogs({ from: date, to: date })]);
    if (alive.current && sequence === request.current) {
      setState(exerciseState(plan, history, { now: new Date().toISOString(), today }));
      setLogs(recorded);
    }
  }, [store, plan, today, date]);
  useEffect(() => { load().catch(() => setError('Could not load coverage. Try again.')); }, [load, dataVersion]);
  const act = async (fn: () => Promise<unknown>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await fn(); notifyDataChanged();
      if (alive.current) setNotice('Saved');
      await load().catch(() => { if (alive.current) setError('Saved, but coverage could not refresh. Close and reopen to reload.'); });
    }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Could not save. Try again.'); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const choose = (next: InventoryExercise) => {
    // Same starting dose as Today's one-tap (#56): today's session, else the plan, else the inventory default.
    const today = [...(session?.exercises ?? []), ...(session?.short?.exercises ?? [])].find(e => e.movement === next.movement);
    const d = doseFor(next.movement, plan, today);
    setExercise(next); setSets(String(d.sets));
    // An editable draft of what was done, never recorded until saved.
    const seconds = next.kind === 'conditioning' || d.seconds !== undefined;
    setUnit(seconds ? 'seconds' : 'reps');
    setDose(String(seconds ? d.seconds ?? 60 : d.reps ?? 1));
    entryId.current = newId(); setPage('exercise'); setError(''); setNotice(''); scroll.current?.scrollTo({ y: 0 });
  };
  const timed = exercise?.kind === 'conditioning' || unit === 'seconds';
  const detail = state?.coverage.find(m => m.muscle === selected);
  const suggestions = state?.suggestions ?? [];
  const eligible = eligibleExercises(plan.exercise).map(e => e.exercise);
  // Engine-ranked strength options, followed by eligible time-based conditioning options.
  const inventory = [...suggestions.map(s => s.exercise), ...eligible.filter(e => e.kind === 'conditioning')];
  const doseNumber = Number(dose), setsNumber = Number(sets);
  const valid = Number.isInteger(setsNumber) && setsNumber > 0 && Number.isInteger(doseNumber) && doseNumber > 0;
  return <Sheet visible onClose={onClose} label="Muscle coverage" fill>
    <ModalHeader title={page === 'map' ? 'Muscle coverage' : page === 'inventory' ? 'Log exercise' : 'Exercise details'} dismiss={{ label: 'Close', a11yLabel: 'Close coverage', onPress: onClose }} />
    <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="coverage-sheet">
      {!!notice && <Text style={type.detail} accessibilityLiveRegion="polite">{notice}</Text>}
      {page !== 'map' && <Button title={page === 'exercise' ? 'Back to exercise inventory' : 'Back to muscle coverage'} variant="quiet" onPress={() => { setPage(page === 'exercise' ? 'inventory' : 'map'); setError(''); }} />}
      {!!error && <View><Text style={[type.body, { color: colors.injured }]} accessibilityRole="alert">{error}</Text>{!state && <Button title="Retry coverage" onPress={() => load().then(() => setError('')).catch(() => setError('Could not load coverage. Try again.'))} />}</View>}
      {!state && !error && <ActivityIndicator color={colors.accent} accessibilityLabel="Loading coverage" />}
      {page === 'map' && state && <>
        <Text style={type.detail}>Coverage now · {today}. {state.restDay ? 'Rest day; voluntary exercise is still available.' : ''} Suggestions are advisory. Recovery windows are planning estimates.</Text>
        <View style={styles.tabs} role="radiogroup" aria-label="Muscle display">
          {(['priority', 'reports'] as const).map(value => <Pressable key={value} role="radio" aria-label={value === 'priority' ? 'Muscle priority' : 'Soreness and injury'} aria-checked={mode === value} onPress={() => setMode(value)} style={[styles.tab, mode === value && styles.selected]}><Text style={type.body}>{value === 'priority' ? 'Priority' : 'Reports'}</Text></Pressable>)}
        </View>
        <MuscleMap gender={plan.profile?.gender} coverage={state.coverage} mode={mode} selected={selected} onSelect={setSelected} />
        {detail && <View style={styles.card} testID="muscle-detail" accessibilityLiveRegion="polite">
          <Text style={type.body}>{detail.label}</Text>
          <Text style={type.detail}>{coverageLabel(detail)} · {detail.volume} / {detail.target} effective sets</Text>
          <Text style={type.detail}>{detail.lastTrainedAt ? `Last trained: ${detail.lastTrainedAt.slice(0, 10)}` : 'No training recorded'}</Text>
          {detail.recoveredAt && <Text style={type.detail}>Estimated recovery until {new Date(detail.recoveredAt).toLocaleString()}</Text>}
          <View style={styles.tabs}>
            <Button title="Report sore" variant="secondary" disabled={!editable || busy} onPress={() => act(async () => {
              const active = (await store.muscleReports()).filter(r => r.muscle === selected && !r.clearedAt);
              if (active.some(r => r.kind === 'sore')) return;
              await reportMuscle(store, selected, 'sore', new Date().toISOString());
              for (const report of active) await store.clearMuscleReport(report.id, new Date().toISOString());
            })} />
            <Button title="Report injured" variant="secondary" disabled={!editable || busy} onPress={() => act(async () => {
              const active = (await store.muscleReports()).filter(r => r.muscle === selected && !r.clearedAt);
              if (active.some(r => r.kind === 'injured')) return;
              await reportMuscle(store, selected, 'injured', new Date().toISOString());
              for (const report of active) await store.clearMuscleReport(report.id, new Date().toISOString());
            })} />
          </View>
          {detail.report && <Button title="Clear report" variant="secondary" disabled={!editable || busy} onPress={() => act(async () => {
            for (const report of (await store.muscleReports()).filter(r => r.muscle === selected && !r.clearedAt)) await store.clearMuscleReport(report.id, new Date().toISOString());
          })} />}
        </View>}
        <Button title="Log exercise" onPress={() => setPage('inventory')} disabled={!editable || busy} />
        <Text style={type.section}>All 14 muscle groups</Text>
        {state.coverage.map(m => <Pressable key={m.muscle} style={[styles.row, m.muscle === selected && styles.selected]} accessibilityRole="button" accessibilityLabel={`${m.label}: ${coverageLabel(m)}. Select muscle`} onPress={() => { setSelected(m.muscle); scroll.current?.scrollTo({ y: 0 }); }} testID={`select-muscle-${m.muscle}`}>
          <Text style={type.body}>{m.label}</Text><Text style={type.detail}>{coverageLabel(m)} · {m.volume} / {m.target} effective sets</Text>
        </Pressable>)}
      </>}
      {page === 'inventory' && <>
        <Text style={type.body}>Eligible exercises</Text>
        <Text style={type.detail}>Based on your equipment and avoid/caution settings. Recovering or reported muscles lower suggestions; they do not silently remove eligible choices. Logging date: {date}.</Text>
        {logs.length > 0 && <View style={styles.card}><Text style={type.section}>Extra exercises recorded · {date}</Text>{logs.map(log => <View key={log.id}>
          <Text style={type.body}>{exerciseInventory.exercises.find(e => e.movement === log.movement)?.name ?? log.movement}</Text>
          <Text style={type.detail}>{log.sets} × {log.seconds ? `${log.seconds} s` : `${log.reps} reps`}</Text>
          <Button title="Remove extra exercise" variant="quiet" disabled={!editable || busy} onPress={() => act(() => store.removeExerciseLog(log.id))} />
        </View>)}</View>}
        {inventory.map(e => {
          const suggestion = suggestions.find(s => s.exercise.movement === e.movement);
          return <Pressable key={e.movement} style={styles.row} accessibilityRole="button" accessibilityLabel={`Choose ${e.name}`} onPress={() => choose(e)}>
            <Text style={type.body}>{e.name}</Text>
            <Text style={type.detail}>{e.kind === 'conditioning' ? 'Conditioning · duration based' : 'Strength'}{suggestion?.caution ? ' · Caution' : ''}{suggestion?.doneToday ? ' · Already trained today' : ''}</Text>
            {!!suggestion?.held.length && <Text style={type.detail}>Lower priority: {suggestion.held.map(h => `${exerciseInventory.muscleGroups.find(m => m.id === h.muscle)?.label}: ${state?.coverage.find(m => m.muscle === h.muscle)?.report ?? h.status}`).join(', ')}</Text>}
          </Pressable>;
        })}
      </>}
      {page === 'exercise' && exercise && <>
        <Text style={type.title}>{exercise.name}</Text>
        <Text style={type.detail}>Primary: {exercise.primary.map(id => exerciseInventory.muscleGroups.find(m => m.id === id)?.label).join(', ')}</Text>
        <Text style={type.detail}>Secondary: {exercise.secondary.map(id => exerciseInventory.muscleGroups.find(m => m.id === id)?.label).join(', ') || 'None'}</Text>
        <MuscleMap gender={plan.profile?.gender} mode="activated" activated={exercise.primary} secondary={exercise.secondary} />
        <Button title="Show exercise guide" variant="secondary" onPress={() => setGuide(true)} />
        {suggestions.find(s => s.exercise.movement === exercise.movement)?.caution && <Text style={type.body}>Caution: review your configured limitations before exercising.</Text>}
        {!!suggestions.find(s => s.exercise.movement === exercise.movement)?.held.length && <Text style={type.body}>Lower priority: {suggestions.find(s => s.exercise.movement === exercise.movement)!.held.map(h => `${exerciseInventory.muscleGroups.find(m => m.id === h.muscle)?.label}: ${state?.coverage.find(m => m.muscle === h.muscle)?.report ?? h.status}`).join(', ')}. You can return to the inventory to choose other muscles.</Text>}
        <Text style={type.detail}>Record an extra exercise outside the scheduled checklist. Tick scheduled exercises in the workout instead to avoid logging them twice.</Text>
        <Text style={type.body}>{exercise.kind === 'conditioning' ? 'Rounds' : 'Sets'}</Text>
        <TextInput accessibilityLabel="Sets or rounds" style={styles.input} value={sets} onChangeText={setSets} keyboardType="number-pad" editable={!busy && editable} />
        <Text style={type.body}>{timed ? 'Seconds per round / set' : 'Reps per set'}</Text>
        {exercise.kind === 'strength' && <View style={styles.tabs} role="radiogroup" aria-label="Exercise dose unit">
          {(['reps', 'seconds'] as const).map(value => <Pressable key={value} style={[styles.tab, unit === value && styles.selected]} role="radio" aria-label={value === 'reps' ? 'Repetitions' : 'Seconds'} aria-checked={unit === value} onPress={() => setUnit(value)}><Text style={type.body}>{value === 'reps' ? 'Repetitions' : 'Seconds'}</Text></Pressable>)}
        </View>}
        <TextInput accessibilityLabel={timed ? 'Seconds per round or set' : 'Reps per set'} style={styles.input} value={dose} onChangeText={setDose} keyboardType="number-pad" editable={!busy && editable} />
        <Text style={type.detail}>Confirm what you actually completed on {date}. Dose fields are editable drafts, not recorded work.</Text>
        <Button title={busy ? 'Saving…' : 'Save exercise log'} disabled={!editable || busy || !valid} onPress={() => act(async () => {
          if (!eligibleExercises(plan.exercise).some(e => e.exercise.movement === exercise.movement)) throw new Error('This exercise is no longer eligible with your equipment or avoid settings. Choose another exercise.');
          await logExercise(store, { id: entryId.current, movement: exercise.movement, date, at: new Date().toISOString(), sets: setsNumber, ...(timed ? { seconds: doseNumber } : { reps: doseNumber }) });
          setPage('inventory');
        })} />
      </>}
    </ScrollView>
    {guide && exercise && <ExerciseGuideSheet gender={plan.profile?.gender} guide={buildGuide({ movement: exercise.movement, label: exercise.name }, plan.exercise)} onClose={() => setGuide(false)} />}
  </Sheet>;
}
const useStyles = createThemedStyles(({ colors }) => ({
  content: { gap: space.md, paddingBottom: space.xl },
  card: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: space.md, gap: space.sm },
  row: { minHeight: touch, paddingVertical: space.md, paddingHorizontal: space.sm, borderBottomWidth: 1, borderColor: colors.line, gap: space.xs },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tab: { minHeight: touch, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  selected: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  input: { minHeight: touch, padding: space.md, color: colors.ink, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, fontSize: 17 },
}));
