import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import manifest from '../../../assets/exercises/heroes/manifest.json';
import { exerciseArtwork, heroIllustrations } from '../heroIllustrations';
import { exerciseLibrary } from '../library';
import { exerciseInventory } from '../inventory';
import presets from '../../../presets/exercise-routines.json';
import exceptionData from '../illustrationExceptions.json';
const exceptions: { movement: string; issue: string; reason: string }[] = exceptionData;

it.each(['male', 'female', 'other', undefined, null, 'non-binary'])('selects only the profile hero for every demonstration: %s', gender => {
  const hero = gender === 'male' || gender === 'female' ? gender : 'neutral';
  for (const definition of exerciseLibrary.exercises) {
    for (const step of definition.steps) {
      const result = exerciseArtwork(step.image, gender);
      const poses = manifest.filter(entry => entry.baseImage === step.image && entry.hero === hero);
      expect(poses).toHaveLength(1);
      expect(result).toEqual({ hero, isPose: true, source: heroIllustrations[poses[0].id] });
    }
  }
});

it('bundles distinct real image steps for every tracked movement and all three existing heroes', () => {
  expect(new Set(manifest.map(e => e.hero))).toEqual(new Set(['male', 'female', 'neutral']));
  expect(new Set(manifest.map(e => e.id)).size).toBe(manifest.length);
  expect(manifest).toHaveLength(exerciseLibrary.exercises.reduce((total, entry) => total + entry.steps.length * 3, 0));
  expect(Object.keys(heroIllustrations).sort()).toEqual(manifest.map(e => e.id).sort());
  for (const { id: movement } of exerciseLibrary.exercises) {
    const definition = exerciseLibrary.exercises.find(e => e.id === movement)!;
    expect(definition).toBeDefined();
    expect(definition.steps.length).toBeGreaterThanOrEqual(2);
    for (const hero of ['male', 'female', 'neutral']) {
      const steps = manifest.filter(e => e.movement === movement && e.hero === hero);
      expect(steps.map(e => e.step)).toEqual(definition.steps.map((_entry, index) => index + 1));
      const hashes = steps.map(entry => createHash('sha256').update(readFileSync(`assets/exercises/heroes/${entry.file}`)).digest('hex'));
      expect(new Set(hashes).size).toBe(steps.length);
    }
  }
  for (const { file } of manifest) {
    const path = `assets/exercises/heroes/${file}`;
    const bytes = readFileSync(path);
    expect(bytes.subarray(0, 2).toString('hex')).toBe('ffd8');
    expect(statSync(path).size).toBeGreaterThan(10000);
    expect(statSync(path).size).toBeLessThan(300000);
  }
});

// Anchor coverage to the catalogue, not just the library: a missing definition must fail too.
it('every registered catalogue movement has instructions and at least two illustrated phases', () => {
  for (const exercise of exerciseInventory.exercises) {
    const definition = exerciseLibrary.exercises.find(entry => entry.id === exercise.movement);
    expect({ movement: exercise.movement, definition }).toEqual({ movement: exercise.movement, definition: expect.objectContaining({ instructions: expect.any(Array), steps: expect.any(Array) }) });
    expect(definition!.instructions.length).toBeGreaterThan(0);
    expect(definition!.steps.length).toBeGreaterThanOrEqual(2);
  }
});

it('starter presets have full hero guides or an explicit tracked illustration exception', () => {
  const movements = new Set<string>();
  const collect = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if ('movement' in value && typeof value.movement === 'string') movements.add(value.movement);
    Object.values(value).forEach(collect);
  };
  collect(presets);
  expect(new Set(exceptions.map(entry => entry.movement)).size).toBe(exceptions.length);
  for (const entry of exceptions) {
    expect(movements.has(entry.movement)).toBe(true);
    expect(exerciseLibrary.exercises.find(def => def.id === entry.movement)).toBeUndefined();
    expect(entry.issue).toMatch(/^https:\/\/github.com\/kevinwolrath\/personal-fitness-tracker\/issues\/\d+$/);
    expect(entry.reason.length).toBeGreaterThan(20);
  }
  for (const movement of movements) {
    const definition = exerciseLibrary.exercises.find(entry => entry.id === movement);
    if (!definition) {
      expect(exceptions.find(entry => entry.movement === movement)).toBeDefined();
      continue;
    }
    expect(definition.steps.length).toBeGreaterThanOrEqual(2);
    for (const step of definition.steps) {
      for (const hero of ['male', 'female', 'neutral']) {
        expect(manifest.filter(entry => entry.baseImage === step.image && entry.hero === hero)).toHaveLength(1);
      }
    }
  }
});
