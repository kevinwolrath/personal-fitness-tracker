import Ajv2020 from 'ajv/dist/2020';
import contract from '../../../docs/design-contracts/plan.schema.json';
import { readFileSync } from 'node:fs';
import { equipmentCatalogue, equipmentConfigErrors, migrateEquipmentV9, selectedEquipment, setEquipmentSelection, supportsEquipment } from '../catalogue';
import artwork from '../artwork.generated.json';
import seed from '../../../plans/seed.plan.json';
import { applyConfigUpdate, parseConfigUpdate } from '../../config/update';
import { previewUpdate } from '../../config/diff';
import { commitConfigUpdate, undoConfigChange } from '../../config/service';
import { KeyValueTrackingStore, MemoryKeyValue } from '../../storage/keyValueStore';
import { validatePlan } from '../../plan/validate';
import { inventoryFor, muscleGrowthOptions } from '../../exercises/catalogue';
import { eligibleExercises } from '../../exercises/inventory';
import { incompatibleScheduled, movementSupported } from '../../exercises/availability';

const jsonPlanValid = new Ajv2020({ allErrors: true, strict: true, strictRequired: false }).compile(contract);
const config = (ids: string[]) => ({ equipment: setEquipmentSelection([], ids, true) });

it('every equipment and station has a self-contained relevant offline thumbnail/detail diagram', () => {
  expect(equipmentCatalogue.items.length).toBeGreaterThanOrEqual(70);
  expect(artwork).toEqual(require('../../../scripts/build-gym-art.cjs').render());
  const full = { ...seed, formatVersion: 9, exercise: config(equipmentCatalogue.items.map(item => item.id)) };
  expect(validatePlan(full).ok).toBe(true);
  expect(jsonPlanValid(full)).toBe(true);
  expect(new Set(equipmentCatalogue.items.map(item => item.id)).size).toBe(equipmentCatalogue.items.length);
  expect(new Set(equipmentCatalogue.items.map(item => item.group))).toEqual(new Set(equipmentCatalogue.groups.map(group => group.id)));
  expect(Object.keys(artwork).sort()).toEqual(equipmentCatalogue.items.map(item => item.image).sort());
  for (const item of equipmentCatalogue.items) {
    const svg = (artwork as Record<string, string>)[item.image];
    expect(svg).toBe(readFileSync(`assets/equipment/${item.image}.svg`, 'utf8').trim());
    expect(svg).toContain(`<title>${item.name.replaceAll('&', '&amp;')}</title>`);
    expect(svg).not.toMatch(/<image|href=|url\(/);
  }
});

it('migration 9 preserves labels, brand, real kg values and notes, without granting unknown stations', () => {
  const old = [{ type: 'home_gym' as const, brand: 'Fortis', label: 'My machine', notes: '4 slabs, kg unknown' }, { type: 'kettlebell' as const, weightsKg: [16, 24] }];
  const migrated = migrateEquipmentV9(old);
  expect(old[0]).not.toHaveProperty('catalogueId');
  expect(migrated[0]).toEqual({ ...old[0], catalogueId: 'multi_gym_frame' });
  expect(migrated[1]).toEqual({ ...old[1], catalogueId: 'kettlebells_cast' });
  expect(supportsEquipment({ equipment: ['home_gym'], requirements: [['chest_press']] }, { equipment: migrated })).toBe(false);
  expect(equipmentConfigErrors({ equipment: migrated })).toEqual([]);
});

it('complete alternatives, bodyweight, deselection and independent stations share one support rule', () => {
  const press = { equipment: ['dumbbells', 'barbell'], requirements: [['dumbbells'], ['barbell', 'weight_plates', 'bench']] };
  expect(supportsEquipment(press, config(['olympic_bar', 'plates']))).toBe(false);
  expect(supportsEquipment(press, config(['olympic_bar', 'plates', 'flat_bench']))).toBe(true);
  expect(supportsEquipment(press, config(['dumbbells_fixed']))).toBe(true);
  expect(supportsEquipment({ equipment: [] }, config([]))).toBe(true);
  expect(movementSupported('chest_press', config(['multi_gym_chest_press']))).toBe(true);
  expect(movementSupported('lat_pulldown', config(['multi_gym_chest_press']))).toBe(false);
  const removed = setEquipmentSelection(config(['multi_gym_chest_press']).equipment, ['multi_gym_chest_press'], false);
  expect(movementSupported('chest_press', { equipment: removed })).toBe(false);
  expect(selectedEquipment({ equipment: removed }).size).toBe(0);
});

it('rejects unknown and wrongly typed catalogue IDs during plan/config validation', () => {
  for (const equipment of [[{ type: 'other', catalogueId: 'not_a_machine' }], [{ type: 'kettlebell', catalogueId: 'dumbbells_fixed' }]]) {
    expect(jsonPlanValid({ ...seed, formatVersion: 9, exercise: { equipment } })).toBe(false);
    const parsed = parseConfigUpdate(JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, exercise: { equipment } } }));
    if (parsed.ok) expect(applyConfigUpdate(seed, parsed.update).ok).toBe(false);
    else expect(parsed.errors.join(' ')).toMatch(/equipment/);
  }
  expect(validatePlan({ ...seed, formatVersion: 8, exercise: { equipment: config(['long_band']).equipment } }).ok).toBe(false);
});

it('the same equipment controls free choices and Muscle Growth, while injury/avoid rules survive', () => {
  const exercise = { ...config(['multi_gym_lat_pulldown']), limitations: [{ movement: 'lat_pulldown', status: 'caution' as const }] };
  const plan = { exercise };
  const eligible = eligibleExercises(exercise, inventoryFor(plan));
  expect(eligible.find(entry => entry.exercise.movement === 'lat_pulldown')?.caution).toBe(true);
  expect(eligible.some(entry => entry.exercise.movement === 'chest_press')).toBe(false);
  expect(muscleGrowthOptions(plan, ['lats']).map(entry => entry.exercise.movement)).toContain('lat_pulldown');
  expect(muscleGrowthOptions({ exercise: { ...exercise, limitations: [{ movement: 'lat_pulldown', status: 'avoid' }] } }, ['lats'])).toHaveLength(0);
});

it('equipment edits persist, preview, export/import and undo through existing config history without changing prescriptions or logs', async () => {
  const store = new KeyValueTrackingStore(new MemoryKeyValue());
  const original = { planId: seed.id, revision: seed.revision, formatVersion: seed.formatVersion, json: JSON.stringify(seed), importedAt: '2026-11-12T00:00:00Z', origin: 'config' as const };
  await store.setActivePlan(original);
  await store.addExerciseLog({ id: 'past', movement: 'chest_press', date: '2026-11-01', at: '2026-11-01T08:00:00Z', sets: 3, reps: 10, seconds: null, intensity: null });
  const update = { schemaVersion: 1, sections: { exercise: config(['kettlebells_cast']) } };
  const result = applyConfigUpdate(seed, update);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.plan.formatVersion).toBe(9);
  expect(result.nextRaw.activities).toEqual(seed.activities);
  expect(incompatibleScheduled(result.plan).some(entry => entry.movements.includes('chest_press'))).toBe(true);
  expect(previewUpdate(seed, result.nextRaw, update, 'kJ').find(section => section.section === 'exercise')!.warnings?.some(warning => warning.includes('Equipment review needed'))).toBe(true);
  const repeated = previewUpdate(result.nextRaw, result.nextRaw, update, 'kJ').find(section => section.section === 'exercise')!;
  expect(repeated.lines).toHaveLength(0);
  expect(repeated.warnings).toBeUndefined();
  await commitConfigUpdate(store, original, result.nextRaw, result.touched, update);
  const saved = (await store.getActivePlan())!;
  expect(validatePlan(JSON.parse(saved.json)).ok).toBe(true);
  expect(selectedEquipment(JSON.parse(saved.json).exercise)).toEqual(new Set(['kettlebells_cast']));
  const [history] = await store.configHistory();
  await undoConfigChange(store, saved, history);
  expect(JSON.parse((await store.getActivePlan())!.json).exercise.equipment).toEqual(seed.exercise.equipment);
  expect(await store.exerciseLogs({ from: '2026-11-01', to: '2026-11-01' })).toHaveLength(1);
});

it('temporary deselection retains all equipment metadata and restores the same item when selected again', () => {
  const original = [{ type: 'free_weights' as const, label: 'Small free weights', brand: 'Saved brand', weightsKg: [3, 5], notes: 'Keep these details' }];
  const off = setEquipmentSelection(original, ['dumbbells_fixed'], false);
  expect(off).toEqual([{ ...original[0], catalogueId: 'dumbbells_fixed', available: false }]);
  expect(selectedEquipment({ equipment: off }).size).toBe(0);
  const on = setEquipmentSelection(off, ['dumbbells_fixed'], true);
  expect(on).toEqual([{ ...original[0], catalogueId: 'dumbbells_fixed', available: true }]);
  expect(movementSupported('hammer_curl', { equipment: on })).toBe(true);
});
