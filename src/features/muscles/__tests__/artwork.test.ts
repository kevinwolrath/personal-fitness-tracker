import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { exerciseInventory } from '../../../exercises/inventory';
import { characterFor, regions } from '../artwork';
import bindings from '../../../../docs/design/hero-forge-preview/overlays/artwork-bindings.json';
it('uses saved explicit gender only, with neutral for absent/other/non-binary/future values', () => {
  expect(characterFor('male')).toBe('male'); expect(characterFor('female')).toBe('female');
  for (const input of [undefined, null, 'other', 'non-binary', '', 'unknown']) expect(characterFor(input)).toBe('neutral');
});
it('binds every contour set to its exact approved PNG and all 14 actual inventory IDs', () => {
  const expected = exerciseInventory.muscleGroups.map(m => m.id).sort();
  for (const character of ['male', 'female', 'neutral'] as const) {
    expect([...new Set(Object.values(regions[character]).flatMap(v => Object.keys(v)))].sort()).toEqual(expected);
    for (const view of ['front', 'back'] as const) {
      const png = readFileSync(join(__dirname, '../../../../assets/hero-forge/app', `${character}-${view}.png`));
      expect(png.readUInt32BE(16)).toBe(1024); expect(png.readUInt32BE(20)).toBe(1536);
      expect(createHash('sha256').update(png).digest('hex')).toBe(bindings.files[`${character}-${view}`].sha256);
      for (const paths of Object.values(regions[character][view])) expect(paths.every(p => p.startsWith('M') && p.includes('C') && p.endsWith('Z'))).toBe(true);
    }
    for (const id of ['upper_back', 'lats', 'lower_back', 'glutes', 'hamstrings', 'calves', 'triceps']) expect(regions[character].front[id]).toBeUndefined();
    for (const id of ['chest', 'core', 'quadriceps', 'hip_flexors', 'biceps']) expect(regions[character].back[id]).toBeUndefined();
  }
});
