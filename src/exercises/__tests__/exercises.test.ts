import { readdirSync, readFileSync } from 'node:fs';
import example from '../../../fixtures/plans/prescription-example.plan.json';
import seed from '../../../plans/seed.plan.json';
import { validatePlan } from '../../plan/validate';
import { prescribeExercise } from '../../prescription/session';
import { buildGuide } from '../guide';
import { illustrations } from '../illustrations.generated';
import data from '../library.json';
import { exerciseLibrary, findDefinition, validateLibrary } from '../library';

const plan = (json: unknown) => {
  const r = validatePlan(json);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.plan;
};
const seedPlan = plan(seed);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe('library and assets', () => {
  it('the bundled library is valid', () => {
    expect(validateLibrary(data)).toMatchObject({ ok: true });
  });

  it('every movement the seed workout prescribes (full and short sessions) has a definition', () => {
    const movements = new Set(
      seedPlan.activities.flatMap((a) => [...(a.session?.exercises ?? []), ...(a.session?.short?.exercises ?? [])]).map((e) => e.movement),
    );
    expect([...movements].sort()).toEqual(['cable_row', 'chest_press', 'hammer_curl', 'kettlebell_squat', 'lat_pulldown']);
    for (const m of movements) expect(findDefinition(m)).toBeDefined();
  });

  it('every definition has ordered steps with bundled images; every bundled image is used', () => {
    const used = exerciseLibrary.exercises.flatMap((e) => e.steps.map((s) => s.image));
    for (const e of exerciseLibrary.exercises) expect(e.steps.length).toBeGreaterThanOrEqual(2);
    expect(used.sort()).toEqual(Object.keys(illustrations).sort());
  });

  it('the generated module is in sync with assets/exercises/*.svg', () => {
    const { render, outPath } = require('../../../scripts/build-exercise-assets.cjs');
    expect(readFileSync(outPath, 'utf8')).toBe(render());
  });

  it('illustrations are self-contained, app-owned SVG (no external references)', () => {
    const files = readdirSync('assets/exercises').filter((f) => f.endsWith('.svg'));
    expect(files).toHaveLength(10);
    for (const svg of Object.values(illustrations)) {
      expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 320 240"/);
      expect(svg).toMatch(/<\/svg>$/);
      expect(svg).not.toMatch(/href|<image|url\(|https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
      expect(svg).toContain('currentColor'); // the figure takes the app's ink colour
    }
  });

  it('definitions never carry workout data (sets/reps/load)', () => {
    const withSets = clone(data) as any;
    withSets.exercises[0].sets = 3;
    expect(validateLibrary(withSets).ok).toBe(false);
  });

  it.each([
    ['duplicate id', (d: any) => d.exercises.push(clone(d.exercises[0])), /defined twice/],
    ['missing image', (d: any) => (d.exercises[0].steps[0].image = 'goblet-squat-1'), /not bundled/],
    ['bad movement id', (d: any) => (d.exercises[0].id = 'Goblet Squat'), /id/],
  ])('rejects %s', (_n, mutate, message) => {
    const d = clone(data) as any;
    mutate(d);
    const r = validateLibrary(d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toMatch(message);
  });

  it('a new exercise is pure data: a definition and its images, no code change', () => {
    const d = clone(data) as any;
    d.exercises.push({
      id: 'goblet_squat', name: 'Goblet squat', equipment: ['kettlebell'], instructions: ['Hold the bell at your chest.'],
      steps: [{ image: 'goblet-squat-1', caption: 'Start' }],
    });
    const r = validateLibrary(d, { ...illustrations, 'goblet-squat-1': '<svg/>' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(buildGuide(prescribeExercise({ movement: 'goblet_squat', sets: 3, reps: 8 }), undefined, r.library)).toMatchObject({ name: 'Goblet squat', prescription: '3 × 8', steps: [{ image: 'goblet-squat-1' }] });
  });
});

describe('buildGuide', () => {
  const strength = seedPlan.activities.find((a) => a.id === 'resistance')!.session!;
  const guide = (i: number) => buildGuide(prescribeExercise(strength.exercises[i], seedPlan.exercise), seedPlan.exercise);

  it('joins the reusable definition with today\'s prescription and the configured equipment', () => {
    expect(guide(0)).toMatchObject({
      name: 'Kettlebell squat', hasDefinition: true, prescription: '3 × 10', equipment: ['16 kg and 24 kg kettlebells'],
      steps: [{ image: 'kettlebell-squat-1' }, { image: 'kettlebell-squat-2' }],
    });
    expect(guide(1)).toMatchObject({ name: 'Seated chest press', workoutLabel: 'Chest press (Fortis)', equipment: ['Fortis home multi-gym'] });
    expect(guide(4)).toMatchObject({ name: 'Hammer curl', equipment: ['Small free weights'] });
  });

  it('different exercises resolve to their own image sets', () => {
    const images = [0, 1, 2, 3, 4].map((i) => guide(i).steps.map((s) => s.image));
    expect(new Set(images.flat()).size).toBe(10);
    expect(images[2]).toEqual(['lat-pulldown-1', 'lat-pulldown-2']);
  });

  it('the same definition serves any prescription (short session uses fewer sets)', () => {
    const short = buildGuide(prescribeExercise(strength.short!.exercises[0], seedPlan.exercise), seedPlan.exercise);
    expect(short).toMatchObject({ name: 'Kettlebell squat', prescription: '2 × 10' });
    expect(short.steps).toEqual(guide(0).steps);
  });

  it('a substituted movement shows the substitute\'s guide and what it replaced; cautions come from the config', () => {
    const ex = plan(example);
    const curl = buildGuide(prescribeExercise({ movement: 'biceps_curl', sets: 2, reps: 12 }, ex.exercise), ex.exercise);
    expect(curl).toMatchObject({ name: 'Hammer curl', substitutedFor: 'Biceps curl', prescription: '2 × 12' });
    const press = buildGuide(prescribeExercise({ movement: 'overhead_press', sets: 2, reps: 8 }, ex.exercise), ex.exercise);
    expect(press).toMatchObject({ hasDefinition: false, caution: 'Caution: shoulder' });
  });

  it('an exercise without a definition degrades to its workout label, with no steps or instructions', () => {
    expect(buildGuide(prescribeExercise({ movement: 'farmer_carry', seconds: 40, label: 'Farmer carry' }))).toEqual({
      movement: 'farmer_carry', name: 'Farmer carry', hasDefinition: false, prescription: '40 s', workoutLabel: null,
      substitutedFor: null, caution: null, equipment: [], instructions: [], steps: [],
    });
  });
});
