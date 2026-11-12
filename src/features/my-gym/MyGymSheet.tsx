import { useMemo, useRef, useState } from 'react';
import { Image, Pressable, Text, TextInput, View } from 'react-native';
import { equipmentCatalogue, selectedEquipment, setEquipmentSelection, needsStationReview, supportsEquipment, catalogueIdFor, type GymItem } from '../../equipment/catalogue';
import { EquipmentImage } from '../../equipment/EquipmentImage';
import { inventoryFor } from '../../exercises/catalogue';
import { eligibleExercises } from '../../exercises/inventory';
import { incompatibleScheduled } from '../../exercises/availability';
import { buildGuide, type ExerciseGuide } from '../../exercises/guide';
import { exerciseArtwork } from '../../exercises/heroIllustrations';
import { CONFIG_SCHEMA_VERSION } from '../../config/sections';
import { describeItem } from '../../config/diff';
import { applyConfigUpdate } from '../../config/update';
import { commitConfigUpdate, undoConfigChange } from '../../config/service';
import type { ConfigChange } from '../../storage/types';
import { useApp } from '../../providers/AppProvider';
import { ScrollView } from '../../ui/ScrollView';
import { Sheet } from '../../ui/Sheet';
import { ModalHeader } from '../../ui/ModalHeader';
import { Button } from '../../ui/Button';
import { createThemedStyles, space, radius, touch, useTheme } from '../../ui/theme';
import { ExerciseGuideSheet } from '../exercise-guide/ExerciseGuideSheet';

/** Equipment access only: all mutations use the existing atomic configuration revision/history service. */
export function MyGymSheet({ onClose }: { onClose: () => void }) {
  const { plan, store, reloadPlan, notifyDataChanged } = useApp();
  const { colors, type } = useTheme();
  const styles = useStyles();
  const selected = useMemo(() => selectedEquipment(plan.exercise), [plan.exercise]);
  const [query, setQuery] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(equipmentCatalogue.groups.filter(group => equipmentCatalogue.items.some(item => item.group === group.id && selected.has(item.id))).map(group => group.id)));
  const [detail, setDetail] = useState<GymItem | null>(null);
  const [guide, setGuide] = useState<ExerciseGuide | null>(null);
  const [busy, setBusy] = useState(false);
  const changing = useRef(false);
  const [error, setError] = useState('');
  const [undo, setUndo] = useState<ConfigChange | null>(null);
  const [saved, setSaved] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const review = useMemo(() => incompatibleScheduled(plan), [plan]);
  const inventory = useMemo(() => inventoryFor(plan), [plan]);
  const available = useMemo(() => eligibleExercises(plan.exercise, inventory), [plan.exercise, inventory]);
  const filtered = equipmentCatalogue.items.filter(item => (!selectedOnly || selected.has(item.id)) && `${item.name} ${equipmentCatalogue.groups.find(group => group.id === item.group)?.name} ${item.detail}`.toLowerCase().includes(query.trim().toLowerCase()));

  const change = async (ids: string[], on: boolean) => {
    if (changing.current) return;
    changing.current = true;
    setBusy(true); setError('');
    try {
      const current = await store.getActivePlan();
      if (!current) throw new Error('No active plan.');
      const raw = JSON.parse(current.json);
      const equipment = setEquipmentSelection(raw.exercise?.equipment ?? [], ids, on);
      const exercise = { equipment };
      const result = applyConfigUpdate(raw, { schemaVersion: CONFIG_SCHEMA_VERSION, sections: { exercise } });
      if (!result.ok) throw new Error(result.errors.join('\n'));
      await commitConfigUpdate(store, current, result.nextRaw, result.touched, { fitnessConfigUpdate: { schemaVersion: CONFIG_SCHEMA_VERSION, exercise } });
      const history = await store.configHistory();
      setUndo(history.find(entry => entry.toRevision === result.plan.revision) ?? null);
      await reloadPlan(); notifyDataChanged(); setSaved(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Equipment was not saved. Try again.'); }
    finally { changing.current = false; setBusy(false); }
  };
  const undoLast = async () => {
    if (!undo || changing.current) return;
    changing.current = true;
    setBusy(true); setError('');
    try {
      const current = await store.getActivePlan();
      if (!current) throw new Error('No active plan.');
      await undoConfigChange(store, current, undo);
      await reloadPlan(); notifyDataChanged(); setUndo(null); setSaved(false);
    } catch (e) { setError(e instanceof Error ? e.message : 'Undo did not complete.'); }
    finally { changing.current = false; setBusy(false); }
  };
  const toggleGroup = (id: string) => setExpanded(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const renderItem = (item: GymItem) => (
    <View key={item.id} style={styles.row} testID={`gym-row-${item.id}`}>
      <Pressable onPress={() => setDetail(item)} accessibilityRole="button" accessibilityLabel={`Details for ${item.name}`} style={styles.thumbnail}><EquipmentImage item={item} /></Pressable>
      <Pressable onPress={() => setDetail(item)} accessibilityRole="button" accessibilityLabel={`About ${item.name}`} style={styles.name}>
        <Text style={styles.itemName}>{item.name}</Text>
        {item.id === 'multi_gym_frame' && <Text style={type.detail}>Stations selected separately</Text>}
      </Pressable>
      <Pressable role="checkbox" aria-checked={selected.has(item.id)} aria-label={item.name} aria-disabled={busy} accessibilityRole="checkbox" accessibilityLabel={item.name} accessibilityState={{ checked: selected.has(item.id), disabled: busy }} disabled={busy} onPress={() => change([item.id], !selected.has(item.id))} style={styles.checkTarget} testID={`gym-check-${item.id}`}>
        <View style={[styles.check, selected.has(item.id) && styles.checked]}>{selected.has(item.id) && <Text style={styles.tick}>{'\u2713'}</Text>}</View>
      </Pressable>
    </View>
  );
  const related = detail ? available.filter(({ exercise }) => {
    const alternatives = exercise.requirements ?? exercise.equipment.map(capability => [capability]);
    return alternatives.some(requirement => requirement.some(capability => [detail.id, ...detail.capabilities].includes(capability))) && supportsEquipment(exercise, plan.exercise);
  }) : [];

  return (
    <Sheet visible onClose={onClose} label="My Gym" fill>
      <ModalHeader title="My Gym" dismiss={{ label: 'Close', onPress: onClose }} />
      <ScrollView contentContainerStyle={styles.content} testID="my-gym">
        <Text style={type.detail}>Select equipment you can use. Bodyweight exercises stay available.</Text>
        <Text style={styles.summary} testID="gym-summary">{selected.size} selected · {available.length} exercises available</Text>
        <TextInput value={query} onChangeText={setQuery} placeholder="Search equipment" placeholderTextColor={colors.muted} accessibilityLabel="Search equipment" style={styles.search} testID="gym-search" autoCorrect={false} />
        <View style={styles.filters}>
          <Button title="All equipment" variant={selectedOnly ? 'quiet' : 'secondary'} accessibilityState={{ selected: !selectedOnly }} onPress={() => setSelectedOnly(false)} />
          <Button title="Selected only" variant={selectedOnly ? 'secondary' : 'quiet'} accessibilityState={{ selected: selectedOnly }} onPress={() => setSelectedOnly(true)} />
        </View>
        {needsStationReview(plan.exercise) && <Text style={styles.notice} testID="gym-station-review">Your saved multi-gym needs station review. Select the stations you have; its frame alone does not enable machine exercises.</Text>}
        {review.length > 0 && <View style={styles.notice} testID="gym-plan-review"><Pressable accessibilityRole="button" accessibilityLabel="Review affected scheduled workouts" accessibilityState={{ expanded: reviewOpen }} onPress={() => setReviewOpen(!reviewOpen)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={styles.itemName}>Review {review.length} planned workout{review.length === 1 ? '' : 's'}</Text><Text style={type.detail}>Prescriptions and history are kept. {reviewOpen ? 'Hide details' : 'Show details'}</Text></Pressable>{reviewOpen && review.map(item => <Text key={item.activityId} style={type.detail}>{item.label}: {item.movements.map(movement => movement.replace(/_/g, ' ')).join(', ')}</Text>)}</View>}
        {error ? <Text style={styles.notice} accessibilityRole="alert">{error}</Text> : null}
        {!filtered.length && <Text style={type.body}>No equipment matches. Try another search or show all equipment.</Text>}
        {equipmentCatalogue.groups.map(group => {
          const all = equipmentCatalogue.items.filter(item => item.group === group.id);
          const matches = filtered.filter(item => item.group === group.id);
          if (!matches.length) return null;
          const open = !!query.trim() || selectedOnly || expanded.has(group.id);
          return <View key={group.id} style={styles.group} testID={`gym-group-${group.id}`}>
            <Pressable style={styles.groupHeader} onPress={() => toggleGroup(group.id)} accessibilityRole="button" accessibilityLabel={`${group.name}, ${all.filter(item => selected.has(item.id)).length} of ${all.length} selected`} accessibilityState={{ expanded: open }} testID={`gym-expand-${group.id}`}>
              <View style={styles.name}><Text style={styles.groupName}>{group.name}</Text><Text style={type.detail}>{all.filter(item => selected.has(item.id)).length} of {all.length} selected</Text></View><Text style={type.body}>{open ? '\u2303' : '\u2304'}</Text>
            </Pressable>
            {open && <View style={styles.groupBody}>
              <View style={styles.bulk}>
                <Button title="Select all" accessibilityLabel={`Select all ${group.name}`} variant="quiet" disabled={busy || all.every(item => selected.has(item.id))} onPress={() => change(all.map(item => item.id), true)} />
                <Button title="Deselect all" accessibilityLabel={`Deselect all ${group.name}`} variant="quiet" disabled={busy || all.every(item => !selected.has(item.id))} onPress={() => change(all.map(item => item.id), false)} />
              </View>
              {matches.map(renderItem)}
            </View>}
          </View>;
        })}
      </ScrollView>
      <View style={styles.savedDock}><Text style={type.detail} accessibilityLiveRegion="polite">{busy ? 'Saving equipment...' : saved ? 'Equipment access saved' : 'Changes save automatically'}</Text>{undo && <Pressable accessibilityRole="button" accessibilityLabel="Undo equipment change" disabled={busy} onPress={undoLast} style={styles.undo}><Text style={styles.action}>Undo</Text></Pressable>}</View>
      {detail && <Sheet visible onClose={() => { setDetail(null); setGuide(null); }} label={detail.name} fill>
        <ModalHeader title={detail.name} dismiss={{ label: 'Close', a11yLabel: 'Back to My Gym', onPress: () => setDetail(null) }} />
        <ScrollView contentContainerStyle={styles.content} testID="gym-detail">
          <EquipmentImage item={detail} large />
          <Text style={type.body}>{detail.detail}</Text>
          {(plan.exercise?.equipment ?? []).filter(item => catalogueIdFor(item) === detail.id).map((item, i) => <View key={i}><Text style={type.detail}>{describeItem('exercise.equipment', item)}</Text>{item.notes && <Text style={type.detail}>{item.notes}</Text>}</View>)}
          {renderItem(detail)}
          <Text style={styles.groupName}>Available exercises</Text>
          {!related.length && <Text style={type.detail}>{selected.has(detail.id) ? 'Your equipment is saved. No compatible exercises are available for this item yet.' : 'Select this equipment to see compatible exercises. Other equipment in a complete setup may also be needed.'}</Text>}
          {related.map(({ exercise }) => {
            const nextGuide = buildGuide({ movement: exercise.movement, label: exercise.name }, plan.exercise);
            const pose = nextGuide.steps[0] && exerciseArtwork(nextGuide.steps[0].image, plan.profile?.gender);
            return <Pressable key={exercise.movement} style={styles.row} onPress={() => setGuide(nextGuide)} accessibilityRole="button" accessibilityLabel={`Show ${exercise.name} guide`}>
              {pose?.isPose ? <Image source={pose.source} resizeMode="contain" style={styles.heroThumb} accessible={false} /> : <Text style={type.detail}>Illustration unavailable</Text>}
              <Text style={[styles.itemName, styles.name]}>{exercise.name}</Text>
            </Pressable>;
          })}
        </ScrollView>
        <ExerciseGuideSheet guide={guide} gender={plan.profile?.gender} onClose={() => setGuide(null)} />
      </Sheet>}
    </Sheet>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => ({
  content: { gap: space.sm, paddingBottom: space.xl },
  summary: { ...type.body, fontSize: 16, fontWeight: '700' },
  search: { ...type.body, minHeight: touch, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: space.md, color: colors.ink, backgroundColor: colors.bg },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  group: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, overflow: 'hidden' },
  groupHeader: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, backgroundColor: colors.bg },
  groupName: { ...type.body, fontSize: 17, fontWeight: '700' },
  groupBody: { paddingHorizontal: space.sm },
  bulk: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', borderBottomWidth: 1, borderBottomColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 80, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.line },
  thumbnail: { width: 58, height: 58, borderRadius: radius.sm, overflow: 'hidden' },
  name: { flex: 1 }, itemName: { ...type.body, fontSize: 16, fontWeight: '600' },
  checkTarget: { width: touch, minHeight: touch, alignItems: 'center', justifyContent: 'center' },
  check: { width: 25, height: 25, borderRadius: 6, borderWidth: 2, borderColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: colors.primary, borderColor: colors.primary },
  tick: { fontSize: 19, fontWeight: '800', color: colors.onAccent },
  notice: { ...type.detail, color: colors.ink, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: space.sm },
  savedDock: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: touch + space.xs, borderTopWidth: 1, borderTopColor: colors.line },
  undo: { minWidth: 64, minHeight: touch, justifyContent: 'center', alignItems: 'center' },
  action: { ...type.body, fontSize: 14, color: colors.primary, fontWeight: '700' },
  heroThumb: { width: 64, height: 64, backgroundColor: '#101519', borderRadius: radius.sm },
}));
