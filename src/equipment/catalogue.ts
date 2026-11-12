import data from './catalogue.json';
import type { ExerciseSection } from '../plan/schema';

export const equipmentCatalogue = data;
export type GymItem = (typeof data.items)[number];
export type ConfiguredEquipment = NonNullable<ExerciseSection['equipment']>[number];
const byId = new Map(data.items.map(item => [item.id, item]));
export const equipmentItemFor = (id: string) => byId.get(id);

/** Old entries retain all metadata. An unknown multi-gym grants no unconfirmed stations. */
const legacyIds: Record<string, string> = {
  kettlebell: 'kettlebells_cast', dumbbells: 'dumbbells_fixed', free_weights: 'dumbbells_fixed',
  barbell: 'olympic_bar', weight_plates: 'plates', home_gym: 'multi_gym_frame',
  cable_machine: 'single_cable', bench: 'flat_bench', pull_up_bar: 'pull_up_bar',
  resistance_bands: 'long_band', heavy_bag: 'heavy_bag', boxing_gloves: 'boxing_gloves',
  battle_ropes: 'battle_ropes', jump_rope: 'jump_rope', exercise_bike: 'exercise_bike',
  treadmill: 'treadmill', rower: 'rowing_machine', bicycle: 'bicycle', vr_headset: 'vr_headset', yoga_mat: 'yoga_mat',
};
export const catalogueIdFor = (item: ConfiguredEquipment) => item.catalogueId ?? legacyIds[item.type];
export function selectedEquipment(config?: ExerciseSection): Set<string> {
  return new Set((config?.equipment ?? []).filter(item => item.available !== false).map(catalogueIdFor).filter((id): id is string => !!id && byId.has(id)));
}
export function equipmentCapabilities(config?: ExerciseSection): Set<string> {
  return new Set([...selectedEquipment(config)].flatMap(id => [id, ...byId.get(id)!.capabilities]));
}
export const needsStationReview = (config?: ExerciseSection) =>
  (config?.equipment ?? []).some(item => item.available !== false && item.type === 'home_gym' && (!item.catalogueId || item.catalogueId === 'multi_gym_frame')) &&
  ![...selectedEquipment(config)].some(id => id.startsWith('multi_gym_') && id !== 'multi_gym_frame');

/** Numbered plan migration 9: identify known legacy items without inferring machine functions or loads. */
export function migrateEquipmentV9(items: readonly ConfiguredEquipment[]): ConfiguredEquipment[] {
  return items.map(item => {
    const catalogueId = catalogueIdFor(item);
    return catalogueId ? { ...item, catalogueId } : { ...item };
  });
}

/** The canonical equipment array is the checklist. No separate selection store or exercise prescription. */
export function setEquipmentSelection(items: readonly ConfiguredEquipment[], ids: readonly string[], selected: boolean): ConfiguredEquipment[] {
  const wanted = new Set(ids);
  const next = migrateEquipmentV9(items).map(item => wanted.has(catalogueIdFor(item) ?? '') ? { ...item, available: selected } : item);
  if (selected) {
    const existing = new Set(next.map(catalogueIdFor));
    for (const id of wanted) {
      const item = byId.get(id);
      if (item && !existing.has(id)) {
        next.push({ type: item.type as ConfiguredEquipment['type'], catalogueId: id, label: item.name });
        existing.add(id);
      }
    }
  }
  return next;
}

export type EquipmentRequirement = { equipment: readonly string[]; requirements?: readonly (readonly string[])[] };
/** OR between complete alternatives, AND inside an alternative. Bodyweight always remains available. */
export function supportsEquipment(exercise: EquipmentRequirement, config?: ExerciseSection): boolean {
  const owned = equipmentCapabilities(config);
  const alternatives = exercise.requirements ?? exercise.equipment.map(type => [type]);
  return !alternatives.length || alternatives.some(all => all.every(capability => owned.has(capability)));
}

export function equipmentConfigErrors(config?: ExerciseSection): string[] {
  const errors: string[] = [];
  for (const [i, item] of (config?.equipment ?? []).entries()) {
    if (!item.catalogueId) continue;
    const definition = byId.get(item.catalogueId);
    if (!definition) errors.push(`exercise.equipment[${i}].catalogueId: unknown equipment "${item.catalogueId}"`);
    else if (definition.type !== item.type && !definition.capabilities.includes(item.type)) errors.push(`exercise.equipment[${i}].type: ${item.catalogueId} requires ${definition.type}`);
  }
  return errors;
}
