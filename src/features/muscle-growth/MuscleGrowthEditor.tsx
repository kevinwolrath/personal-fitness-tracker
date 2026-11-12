import { selectedEquipment, equipmentItemFor } from '../../equipment/catalogue';
import { EquipmentImage } from '../../equipment/EquipmentImage';
import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { inventoryFor, muscleGrowthOptions } from '../../exercises/catalogue';
import { bundledInventory } from '../../exercises/inventory';
import { CONFIG_SCHEMA_VERSION } from '../../config/sections';
import { commitConfigUpdate } from '../../config/service';
import { applyConfigUpdate } from '../../config/update';
import { dayParts, weekdays, type CustomExercise, type MuscleGrowth, type MuscleGrowthExercise } from '../../plan/schema';
import { useApp } from '../../providers/AppProvider';
import { Button } from '../../ui/Button';
import { ModalHeader } from '../../ui/ModalHeader';
import { ScrollView } from '../../ui/ScrollView';
import { Sheet } from '../../ui/Sheet';
import { createThemedStyles, radius, space, touch, useTheme } from '../../ui/theme';

const dayLabel: Record<string, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
const partLabel: Record<string, string> = { morning: 'Morning', lunch: 'Lunch break', afternoon: 'Afternoon', evening: 'Evening', anytime: 'Any time' };
const snake = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

/**
 * Muscle Growth set-up (#122): turn it on, choose target muscles, pick exercises for them from the shared catalogue
 * (only those that work a target and suit the user's equipment and limits), and add custom exercises to the catalogue.
 * Saved as an `exercise` configuration change: the same validation, history and Undo as Configure with AI (contract 07).
 * Never touches the schedule, rest days or the resistance session.
 */
export function MuscleGrowthEditor({ onClose }: { onClose: () => void }) {
  const { store, plan, reloadPlan, notifyDataChanged } = useApp();
  const { type } = useTheme();
  const styles = useStyles();
  const current = plan.exercise?.muscleGrowth;
  const [enabled, setEnabled] = useState(current?.enabled ?? true);
  const [targets, setTargets] = useState<string[]>(current?.targets ?? []);
  const [when, setWhen] = useState<MuscleGrowth['when']>(current?.when);
  // Absent days means every day; existing days are kept exactly unless the user changes them.
  const [days, setDays] = useState<string[]>(current?.days ?? [...weekdays]);
  const toggleDay = (d: string) => setDays((xs) => (xs.includes(d) ? xs.filter((x) => x !== d) : weekdays.filter((w) => w === d || xs.includes(w))));
  const [chosen, setChosen] = useState<Record<string, MuscleGrowthExercise>>(Object.fromEntries((current?.exercises ?? []).map((e) => [e.movement, e])));
  const [custom, setCustom] = useState<CustomExercise[]>(plan.exercise?.customExercises ?? []);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const draftPlan = useMemo(() => ({ exercise: { ...(plan.exercise ?? {}), customExercises: custom } }), [plan.exercise, custom]);
  const catalogue = useMemo(() => inventoryFor(draftPlan), [draftPlan]);
  const options = useMemo(() => muscleGrowthOptions(draftPlan, targets, catalogue), [draftPlan, targets, catalogue]);
  const label = new Map(bundledInventory.muscleGroups.map((m) => [m.id, m.label]));

  const toggleTarget = (id: string) => setTargets((t) => (t.includes(id) ? t.filter((x) => x !== id) : t.length < 6 ? [...t, id] : t));
  const toggleExercise = (movement: string) =>
    setChosen((c) => {
      if (c[movement]) {
        const { [movement]: _gone, ...rest } = c;
        return rest;
      }
      const d = catalogue.exercises.find((e) => e.movement === movement)?.defaultDose;
      return { ...c, [movement]: { movement, sets: d?.sets ?? 2, ...(d?.seconds !== undefined ? { seconds: d.seconds } : { reps: d?.reps ?? 10 }) } };
    });
  const setSets = (movement: string, delta: number) =>
    setChosen((c) => (c[movement] ? { ...c, [movement]: { ...c[movement], sets: Math.min(10, Math.max(1, (c[movement].sets ?? 2) + delta)) } } : c));

  const save = async () => {
    setError('');
    if (!targets.length) return setError('Choose at least one target muscle.');
    if (!days.length) return setError('Choose at least one day.');
    setBusy(true);
    try {
      const stored = await store.getActivePlan();
      if (!stored) throw new Error('No plan to change.');
      // Only exercises that still work a target stay in the routine; logs from earlier days are never touched.
      const visible = new Set(options.map((o) => o.exercise.movement));
      const routine = options.map((o) => chosen[o.exercise.movement]).filter((e): e is MuscleGrowthExercise => !!e && visible.has(e.movement));
      const everyDay = days.length === weekdays.length;
      const muscleGrowth: MuscleGrowth = { enabled, targets, exercises: routine, ...(everyDay ? {} : { days: days as MuscleGrowth['days'] }), ...(when ? { when } : {}) };
      const exercise: Record<string, unknown> = { muscleGrowth };
      if (JSON.stringify(custom) !== JSON.stringify(plan.exercise?.customExercises ?? [])) exercise.customExercises = custom.length ? custom : null;
      const update = { schemaVersion: CONFIG_SCHEMA_VERSION, sections: { exercise } };
      const applied = applyConfigUpdate(JSON.parse(stored.json), update);
      if (!applied.ok) throw new Error(applied.errors.join('\n'));
      await commitConfigUpdate(store, stored, applied.nextRaw, applied.touched, { fitnessConfigUpdate: { schemaVersion: CONFIG_SCHEMA_VERSION, exercise } });
      await reloadPlan();
      notifyDataChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible onClose={onClose} label="Muscle Growth" fill>
      <ModalHeader title="Muscle Growth" dismiss={{ label: 'Cancel', a11yLabel: 'Cancel Muscle Growth changes', onPress: onClose }} />
      <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="muscle-growth-editor">
        <Text style={type.detail}>A short routine for the muscles you choose, at a time that suits you. It sits beside your main workout and never changes your schedule or rest days.</Text>
        <Pressable
          onPress={() => setEnabled(!enabled)}
          style={styles.switchRow}
          role="switch"
          aria-checked={enabled}
          accessibilityLabel="Show Muscle Growth on Today"
          testID="muscle-growth-enabled"
        >
          <Text style={[type.body, styles.flex]}>Show on Today</Text>
          <Text style={styles.switchText}>{enabled ? 'On' : 'Off'}</Text>
        </Pressable>

        <Text style={type.section}>Target muscles</Text>
        <View style={styles.chips} role="group" aria-label="Target muscles">
          {bundledInventory.muscleGroups.map((m) => (
            <Chip key={m.id} label={m.label} on={targets.includes(m.id)} onPress={() => toggleTarget(m.id)} testID={`mg-target-${m.id}`} />
          ))}
        </View>

        <Text style={type.detail}>Upper traps count as Upper back.</Text>

        <Text style={type.section}>Days</Text>
        <View style={styles.chips} role="group" aria-label="Days">
          {weekdays.map((d) => (
            <Chip key={d} label={dayLabel[d]} on={days.includes(d)} onPress={() => toggleDay(d)} testID={`mg-day-${d}`} />
          ))}
        </View>
        <Text style={type.detail} testID="mg-days-summary">
          {days.length === weekdays.length ? 'Every day' : days.length ? `Only ${days.map((d) => dayLabel[d]).join(', ')}` : 'Choose at least one day'}
        </Text>

        <Text style={type.section}>Time of day</Text>
        <View style={styles.chips} role="radiogroup" aria-label="When">
          {dayParts.map((p) => (
            <Chip key={p} label={partLabel[p]} on={when === p} radio onPress={() => setWhen(when === p ? undefined : p)} testID={`mg-when-${p}`} />
          ))}
        </View>

        <Text style={type.section}>Exercises for your targets</Text>
        {!targets.length ? (
          <Text style={type.detail}>Choose a target muscle to see exercises for it.</Text>
        ) : !options.length ? (
          <Text style={type.detail} testID="mg-no-options">No exercise in the catalogue works these muscles with your equipment. Add one below.</Text>
        ) : (
          <Text style={type.detail}>Only exercises that work your targets, with your equipment. Movements you marked "avoid" never appear.</Text>
        )}
        <View style={styles.list}>
          {options.map(({ exercise: e, caution, match }) => {
            const on = !!chosen[e.movement];
            return (
              <View key={e.movement} style={styles.option} testID={`mg-option-${e.movement}`}>
                <Pressable onPress={() => toggleExercise(e.movement)} style={styles.optionMain} role="checkbox" aria-checked={on} accessibilityLabel={`${e.name}${caution ? ', caution' : ''}`}>
                  <View style={[styles.box, on && styles.boxOn]}>{on ? <Text style={styles.tick}>✓</Text> : null}</View>
                  <View style={styles.flex}>
                    <Text style={type.body}>{e.name}</Text>
                    <Text style={type.detail}>
                      {[...e.primary, ...(match === 'secondary' ? e.secondary.filter((m) => targets.includes(m)) : [])].map((m) => label.get(m) ?? m).join(', ')}
                      {match === 'secondary' ? ' (secondary)' : ''}
                      {caution ? ' · caution' : ''}
                      {custom.some((c) => c.movement === e.movement) ? ' · custom' : ''}
                    </Text>
                  </View>
                </Pressable>
                {on && (
                  <View style={styles.stepper}>
                    <Pressable onPress={() => setSets(e.movement, -1)} style={styles.step} accessibilityRole="button" accessibilityLabel={`Fewer sets of ${e.name}`}>
                      <Text style={styles.stepText}>−</Text>
                    </Pressable>
                    <Text style={type.body} testID={`mg-sets-${e.movement}`}>{`${chosen[e.movement].sets} sets`}</Text>
                    <Pressable onPress={() => setSets(e.movement, 1)} style={styles.step} accessibilityRole="button" accessibilityLabel={`More sets of ${e.name}`}>
                      <Text style={styles.stepText}>+</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}
        </View>

        {adding ? (
          <CustomExerciseForm
            targets={targets}
            existing={catalogue.exercises.map((e) => ({ movement: e.movement, name: e.name }))}
            ownedEquipment={[...selectedEquipment(plan.exercise)].filter(id => equipmentItemFor(id)?.capabilities.length)}
            onCancel={() => setAdding(false)}
            onAdd={(c) => {
              setCustom((xs) => [...xs, c]);
              setChosen((ch) => ({ ...ch, [c.movement]: { movement: c.movement, sets: c.defaultDose?.sets ?? 2, reps: c.defaultDose?.reps ?? 10 } }));
              setAdding(false);
            }}
          />
        ) : (
          <Button title="Add a custom exercise" variant="secondary" onPress={() => setAdding(true)} testID="mg-add-custom" />
        )}

        {error ? (
          <Text style={styles.error} testID="mg-error" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <Button title={busy ? 'Saving…' : 'Save routine'} disabled={busy} onPress={save} testID="mg-save" />
        <Text style={type.detail}>Saved as a configuration change: you can undo it in Configure with AI. Loads are never raised for you.</Text>
      </ScrollView>
    </Sheet>
  );
}

/** Add an exercise to the shared catalogue: name, equipment, primary and secondary muscles, optional cue. */
function CustomExerciseForm({ targets, existing, ownedEquipment, onCancel, onAdd }: {
  targets: string[];
  existing: { movement: string; name: string }[];
  ownedEquipment: string[];
  onCancel: () => void;
  onAdd: (c: CustomExercise) => void;
}) {
  const { colors, type } = useTheme();
  const styles = useStyles();
  const [name, setName] = useState('');
  const [primary, setPrimary] = useState<string[]>(targets.slice(0, 1));
  const [secondary, setSecondary] = useState<string[]>([]);
  const [equipment, setEquipment] = useState<string[]>([]);
  const [cue, setCue] = useState('');
  const [error, setError] = useState('');
  const toggle = (xs: string[], x: string) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);
  const add = () => {
    const movement = snake(name);
    if (!name.trim() || !movement) return setError('Give the exercise a name.');
    if (existing.some((e) => e.movement === movement || e.name.toLowerCase() === name.trim().toLowerCase())) return setError('That exercise is already in the catalogue. Choose it above instead.');
    if (!primary.length) return setError('Choose at least one primary muscle.');
    onAdd({
      movement,
      name: name.trim().slice(0, 40),
      kind: 'strength',
      equipment: [...new Set(equipment.map(id => equipmentItemFor(id)!.type))] as CustomExercise['equipment'],
      ...(equipment.length ? { requirements: [equipment] } : {}),
      primary,
      secondary: secondary.filter((m) => !primary.includes(m)),
      defaultDose: { sets: 2, reps: 10 },
      ...(cue.trim() ? { guidance: [cue.trim().slice(0, 200)] } : {}),
    });
  };
  return (
    <View style={styles.form} testID="mg-custom-form">
      <Text style={type.section}>New catalogue exercise</Text>
      <TextInput value={name} onChangeText={setName} placeholder="Name, e.g. Dumbbell shrug" placeholderTextColor={colors.faint} style={styles.input} accessibilityLabel="Exercise name" testID="mg-custom-name" />
      <Text style={type.detail}>Primary muscles</Text>
      <View style={styles.chips}>
        {bundledInventory.muscleGroups.map((m) => (
          <Chip key={m.id} label={m.label} on={primary.includes(m.id)} onPress={() => setPrimary(toggle(primary, m.id))} testID={`mg-custom-primary-${m.id}`} />
        ))}
      </View>
      <Text style={type.detail}>Secondary muscles (optional)</Text>
      <View style={styles.chips}>
        {bundledInventory.muscleGroups
          .filter((m) => !primary.includes(m.id))
          .map((m) => (
            <Chip key={m.id} label={m.label} on={secondary.includes(m.id)} onPress={() => setSecondary(toggle(secondary, m.id))} testID={`mg-custom-secondary-${m.id}`} />
          ))}
      </View>
      <Text style={type.detail}>Select every item this exercise needs (none = bodyweight). Only equipment selected in My Gym is offered.</Text>
      <View style={styles.chips}>
        {ownedEquipment.length ? (
          ownedEquipment.map((q) => <View key={q} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><EquipmentImage item={equipmentItemFor(q)!} size={32} /><Chip label={equipmentItemFor(q)!.name} on={equipment.includes(q)} onPress={() => setEquipment(toggle(equipment, q))} testID={`mg-custom-equipment-${q}`} /></View>)
        ) : (
          <Text style={type.detail}>No equipment configured: bodyweight only.</Text>
        )}
      </View>
      <TextInput value={cue} onChangeText={setCue} placeholder="How to do it (optional)" placeholderTextColor={colors.faint} style={styles.input} accessibilityLabel="Guidance" testID="mg-custom-cue" />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.row}>
        <View style={styles.flex}>
          <Button title="Cancel" variant="secondary" onPress={onCancel} />
        </View>
        <View style={styles.flex}>
          <Button title="Add exercise" onPress={add} testID="mg-custom-add" />
        </View>
      </View>
    </View>
  );
}

function Chip({ label, on, onPress, radio, testID }: { label: string; on: boolean; onPress: () => void; radio?: boolean; testID?: string }) {
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]} role={radio ? 'radio' : 'checkbox'} aria-checked={on} accessibilityLabel={label} testID={testID}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const useStyles = createThemedStyles(({ colors }) => ({
  flex: { flex: 1 },
  content: { gap: space.md, paddingBottom: space.xl },
  row: { flexDirection: 'row', gap: space.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', minHeight: touch, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  switchText: { color: colors.accent, fontWeight: '800', fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  chip: { minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  chipTextOn: { color: colors.onAccent },
  list: { gap: space.xs },
  option: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: space.sm },
  optionMain: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: touch, paddingVertical: space.xs },
  box: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: colors.faint, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  tick: { color: colors.onAccent, fontWeight: '900' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingBottom: space.xs, paddingLeft: 34 },
  step: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 22, color: colors.accent, fontWeight: '800' },
  form: { gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  input: { minHeight: touch, padding: space.md, color: colors.ink, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, fontSize: 16 },
  error: { color: colors.ink, fontSize: 14, lineHeight: 20 },
}));
