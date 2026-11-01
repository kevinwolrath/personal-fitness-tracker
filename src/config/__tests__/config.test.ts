import { readFileSync } from 'node:fs';
import seed from '../../../plans/seed.plan.json';
import { KeyValueTrackingStore, MemoryKeyValue } from '../../storage/keyValueStore';
import { loadActivePlan } from '../../plan/bootstrap';
import { previewUpdate } from '../diff';
import { buildAiInstructions } from '../instructions';
import { readConfig, sectionNames, type RawPlan } from '../sections';
import { commitConfigUpdate, undoConfigChange } from '../service';
import { applyConfigUpdate, parseConfigUpdate } from '../update';

const fixture = (name: string) => readFileSync(`fixtures/config/${name}.update.json`, 'utf8');
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
/** The seed before any exercise configuration (it now ships with one), so updates show as changes. */
const baseRaw = (): RawPlan => {
  const s: RawPlan = clone(seed);
  delete s.exercise;
  return s;
};
const deepFreeze = <T>(o: T): T => {
  Object.values(o as object).forEach((v) => v && typeof v === 'object' && deepFreeze(v));
  return Object.freeze(o);
};

function apply(text: string, raw: RawPlan = baseRaw()) {
  const p = parseConfigUpdate(text);
  if (!p.ok) throw new Error(p.errors.join('\n'));
  const a = applyConfigUpdate(raw, p.update);
  if (!a.ok) throw new Error(a.errors.join('\n'));
  return { ...a, update: p.update, raw };
}

/** Every section except those listed must read back byte-identical. */
function expectUntouched(before: RawPlan, after: RawPlan, except: string[]) {
  const b = readConfig(before);
  const a = readConfig(after);
  for (const s of sectionNames.filter((n) => !except.includes(n))) {
    expect({ section: s, json: JSON.stringify(a[s]) }).toEqual({ section: s, json: JSON.stringify(b[s]) });
  }
}

describe('applying updates', () => {
  it('exercise-only payload changes exercise and nothing else (byte-identical elsewhere)', () => {
    const { nextRaw, touched, raw } = apply(fixture('real-world-exercise'));
    expect(touched).toEqual(['exercise']);
    expectUntouched(raw, nextRaw, ['exercise']);
    // Whole document: only exercise + bookkeeping (formatVersion, revision) differ.
    const strip = ({ exercise: _e, formatVersion: _f, revision: _r, ...rest }: RawPlan) => JSON.stringify(rest);
    expect(strip(nextRaw)).toBe(strip(raw));
    expect(nextRaw.exercise.limitations).toContainEqual({ movement: 'biceps_curl', status: 'avoid', reason: 'aggravates elbow' });
    expect(nextRaw).toMatchObject({ formatVersion: 2, revision: seed.revision + 1 });
  });

  it('nutrition-only payload leaves exercise (and the rest) untouched', () => {
    const withExercise = apply(fixture('real-world-exercise')).nextRaw;
    const { nextRaw, touched } = apply(fixture('nutrition'), withExercise);
    expect(touched).toEqual(['nutrition']);
    expectUntouched(withExercise, nextRaw, ['nutrition']);
    expect(nextRaw.exercise).toEqual(withExercise.exercise);
    expect(nextRaw.nutrition.targets[0].max).toBe(7300);
  });

  it('combined payload updates both', () => {
    const { nextRaw, touched, raw } = apply(fixture('combined'));
    expect(touched.sort()).toEqual(['exercise', 'nutrition']);
    expectUntouched(raw, nextRaw, ['exercise', 'nutrition']);
    expect(nextRaw.exercise.equipment).toHaveLength(7);
    expect(nextRaw.nutrition.targets[0].max).toBe(7300);
  });

  it('meals replace only meal activities, keeping exercise/habit activities and their order', () => {
    const { nextRaw, raw } = apply(fixture('nutrition'));
    const nonMeals = (r: RawPlan) => r.activities.filter((a: any) => a.kind !== 'meal');
    expect(JSON.stringify(nonMeals(nextRaw))).toBe(JSON.stringify(nonMeals(raw)));
    expect(nextRaw.activities.filter((a: any) => a.kind === 'meal').map((a: any) => a.id)).toEqual(['lunch', 'snack', 'dinner']);
    expect(nextRaw.activities.findIndex((a: any) => a.id === 'lunch')).toBe(raw.activities.findIndex((a: any) => a.id === 'lunch'));
  });

  it('fields omitted inside a supplied section are kept; null clears an optional field', () => {
    const base = apply(fixture('real-world-exercise')).nextRaw;
    const { nextRaw } = apply(
      JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, exercise: { substitutions: null, constraints: { location: 'mixed' } } } }),
      base,
    );
    expect(nextRaw.exercise.substitutions).toBeUndefined();
    expect(nextRaw.exercise.constraints).toEqual({ location: 'mixed' });
    expect(nextRaw.exercise.equipment).toEqual(base.exercise.equipment); // not mentioned: kept
    expect(nextRaw.exercise.limitations).toEqual(base.exercise.limitations);
  });

  it('accepts the update inside one fenced ```json block with prose around it', () => {
    const text = `Here is your update:\n\n\`\`\`json\n${fixture('nutrition')}\`\`\`\n\nLet me know if you want changes!`;
    expect(apply(text).touched).toEqual(['nutrition']);
  });

  it('never mutates the current configuration, even on success', () => {
    const raw = deepFreeze(clone(seed)) as RawPlan;
    const p = parseConfigUpdate(fixture('combined'));
    if (!p.ok) throw new Error('parse');
    expect(() => applyConfigUpdate(raw, p.update)).not.toThrow();
  });
});

describe('rejecting bad payloads with actionable errors', () => {
  const env = (body: unknown) => JSON.stringify({ fitnessConfigUpdate: body });
  it.each([
    ['empty', '', /Paste the update/],
    ['prose only', 'Sure! I updated your exercise settings.', /isn't valid JSON/],
    ['two code blocks', '```json\n{}\n```\n```json\n{}\n```', /more than one code block/],
    ['missing envelope', JSON.stringify({ exercise: {} }), /"fitnessConfigUpdate" key/],
    ['extra top-level key', JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, exercise: { goals: ['fitness'] } }, note: 'hi' }), /Unexpected top-level key: note/],
    ['missing schemaVersion', env({ exercise: { goals: ['fitness'] } }), /schemaVersion is missing/],
    ['newer schemaVersion', env({ schemaVersion: 2, exercise: { goals: ['fitness'] } }), /supports 1\. Copy fresh AI instructions/],
    ['unknown section', env({ schemaVersion: 1, diet: {} }), /fitnessConfigUpdate\.diet: unknown section\. Valid sections: profile, goals, nutrition, exercise, schedule, tracking/],
    ['no sections', env({ schemaVersion: 1 }), /no sections/],
    ['empty section', env({ schemaVersion: 1, exercise: {} }), /"exercise" is empty/],
    ['unknown field', env({ schemaVersion: 1, exercise: { gear: [] } }), /fitnessConfigUpdate\.exercise: .*gear/],
    ['bad enum, with path', env({ schemaVersion: 1, exercise: { equipment: [{ type: 'trampoline' }] } }), /fitnessConfigUpdate\.exercise\.equipment\[0\]\.type: .*kettlebell/],
    ['number as string', env({ schemaVersion: 1, nutrition: { targets: [{ id: 'energy', label: 'Energy', quantity: 'energy', max: '7300' }] } }), /nutrition\.targets\[0\]\.max/],
    ['meal outside nutrition', env({ schemaVersion: 1, schedule: { activities: [{ id: 'x', kind: 'meal', label: 'X' }] } }), /meals belong in nutrition\.meals/],
    ['null on a required field', env({ schemaVersion: 1, tracking: { measurements: null } }), /tracking\.measurements/],
  ])('%s', (_name, text, message) => {
    const r = parseConfigUpdate(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toMatch(message);
  });

  it('reports every bad section at once', () => {
    const r = parseConfigUpdate(env({ schemaVersion: 1, exercise: { equipment: [{ type: 'x' }] }, nutrition: { eatingWindow: { start: '7pm', end: '20:00' } } }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes('exercise.equipment[0].type'))).toBe(true);
      expect(r.errors.some((e) => e.includes('nutrition.eatingWindow.start'))).toBe(true);
    }
  });

  it('cross-section problems are caught on the merged result, with nothing applied', () => {
    const raw = deepFreeze(clone(seed)) as RawPlan;
    // Removes the "protein" target while the (unchanged) meals don't reference it: fine.
    // But a meal referencing a target that doesn't exist must fail:
    const p = parseConfigUpdate(env({
      schemaVersion: 1,
      nutrition: { meals: [{ id: 'lunch', kind: 'meal', label: 'Lunch', nutrition: { fibre: 10 } }, { id: 'dinner', kind: 'meal', label: 'Dinner', flexible: true }] },
    }));
    if (!p.ok) throw new Error(p.errors.join('\n'));
    const a = applyConfigUpdate(raw, p.update);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.errors.join('\n')).toMatch(/would be invalid: activity lunch: unknown nutrition target "fibre"/);
  });

  it('exercise semantics are checked too (modalities must exist)', () => {
    const p = parseConfigUpdate(env({ schemaVersion: 1, exercise: { conditioning: { modalities: ['swimming'] } } }));
    if (!p.ok) throw new Error(p.errors.join('\n'));
    const a = applyConfigUpdate(clone(seed), p.update);
    expect(a.ok).toBe(false);
  });
});

describe('preview', () => {
  it('lists supplied sections with readable changes and marks the rest untouched', () => {
    const { nextRaw, update, raw } = apply(fixture('real-world-exercise'));
    const preview = previewUpdate(raw, nextRaw, update);
    expect(preview.map((s) => [s.section, s.supplied])).toEqual([
      ['profile', false], ['goals', false], ['nutrition', false], ['exercise', true], ['schedule', false], ['tracking', false],
    ]);
    const lines = preview.find((s) => s.section === 'exercise')!.lines.map((l) => `${l.kind} ${l.text}`);
    expect(lines).toEqual(expect.arrayContaining([
      'add Added Fortis home multi-gym',
      'add Added 16 kg and 24 kg kettlebells',
      'add Added Heavy bag',
      'add Added Battle ropes',
      'add Avoid biceps curl (aggravates elbow)',
      'add Hammer curl permitted (tolerated by the elbow)',
      'add Instead of biceps curl, use hammer curl',
      'add Training goals: weight loss, muscle preservation, strength, fitness',
    ]));
  });

  it('shows changes, removals and "no changes" for a supplied but identical field', () => {
    const base = apply(fixture('real-world-exercise')).nextRaw;
    const text = JSON.stringify({
      fitnessConfigUpdate: {
        schemaVersion: 1,
        exercise: {
          limitations: [{ movement: 'biceps_curl', status: 'caution', reason: 'aggravates elbow' }],
          goals: base.exercise.goals,
        },
      },
    });
    const { nextRaw, update } = apply(text, base);
    const lines = previewUpdate(base, nextRaw, update).find((s) => s.section === 'exercise')!.lines.map((l) => `${l.kind} ${l.text}`);
    expect(lines).toEqual(['change Biceps curl: status avoid → caution', 'remove Removed hammer curl']);
  });
});

describe('AI session instructions', () => {
  const text = buildAiInstructions(clone(seed), '2026-11-02');
  it('contain the current config, schema version, partial-update rules and allowed values', () => {
    expect(text).toContain('Configuration schema version: 1');
    expect(text).toContain('"Fixed lunch"'); // current config
    expect(text).toMatch(/Include ONLY the sections you are changing/);
    expect(text).toMatch(/A missing section is left exactly as it is/);
    expect(text).toMatch(/kettlebell, dumbbells, free_weights/);
    expect(text).toMatch(/avoid, caution, allowed/);
  });
  it('every example update in the instructions passes the importer (protocol is self-consistent)', () => {
    const blocks = [...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1]).filter((b) => b.includes('"fitnessConfigUpdate"') && !b.includes('<section>'));
    expect(blocks).toHaveLength(3);
    for (const b of blocks) expect(() => apply(b)).not.toThrow();
  });
  it('is plain text with no provider-specific features', () => {
    expect(text).not.toMatch(/function call|tool_use|ChatGPT|Claude/i);
  });
});

describe('persistence, history, undo and the seed', () => {
  async function setup() {
    const store = new KeyValueTrackingStore(new MemoryKeyValue());
    await loadActivePlan(store);
    return store;
  }

  it('commits a new revision with origin "config" and records the change; undo restores the exact previous plan', async () => {
    const store = await setup();
    const before = (await store.getActivePlan())!;
    const { nextRaw, touched } = apply(fixture('real-world-exercise'), JSON.parse(before.json));
    const after = await commitConfigUpdate(store, before, nextRaw, touched, { any: 'payload' });
    expect(after).toMatchObject({ revision: before.revision + 1, origin: 'config', formatVersion: 2 });
    const [change] = await store.configHistory();
    expect(change).toMatchObject({ sections: ['exercise'], fromRevision: before.revision, toRevision: after.revision, previousPlanJson: before.json });

    const undone = await undoConfigChange(store, after, change);
    const restored = JSON.parse(undone.json);
    expect({ ...restored, revision: 0 }).toEqual({ ...JSON.parse(before.json), revision: 0 });
    expect(undone.revision).toBe(after.revision + 1);
    expect((await store.configHistory()).map((c) => c.sections)).toEqual([['undo'], ['exercise']]);
    await expect(undoConfigChange(store, undone, change)).rejects.toThrow(/most recent/);
  });

  it('a newer bundled seed never overwrites a configuration the user changed', async () => {
    const store = await setup();
    const before = (await store.getActivePlan())!;
    const { nextRaw, touched } = apply(fixture('real-world-exercise'), JSON.parse(before.json));
    await commitConfigUpdate(store, before, nextRaw, touched, {});
    const plan = await loadActivePlan(store, { ...seed, revision: 99, title: 'New seed' });
    expect(plan.title).toBe(seed.title);
    expect(plan.exercise?.equipment).toHaveLength(7);
  });

  it('an untouched seed still upgrades to a newer seed revision', async () => {
    const store = await setup();
    expect((await loadActivePlan(store, { ...seed, revision: 99, title: 'New seed' })).title).toBe('New seed');
  });
});
