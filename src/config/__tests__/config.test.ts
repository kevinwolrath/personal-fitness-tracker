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
    expect(nextRaw).toMatchObject({ formatVersion: 4, revision: seed.revision + 1 });
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
    ['prose only', 'Sure! I updated your exercise settings.', /No update found/],
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
  it('meal ingredients and preparation read as a shopping line, not JSON (#26)', () => {
    // A configured plan from before #26: formatVersion 2, lunch without ingredients.
    const before = baseRaw();
    before.formatVersion = 2;
    const lunch0 = before.activities.find((a: any) => a.id === 'lunch');
    delete lunch0.ingredients;
    delete lunch0.preparation;
    delete lunch0.nutrition;
    const { nextRaw, update, raw } = apply(fixture('lunch'), before);
    expect(nextRaw.formatVersion).toBe(4); // the update upgrades the plan format
    // Lunch-only: every other meal is byte-identical (merge by id).
    const others = (r: any) => JSON.stringify(r.activities.filter((a: any) => a.id !== 'lunch'));
    expect(others(nextRaw)).toBe(others(raw));
    expect(previewUpdate(raw, nextRaw, update, 'kJ').find((s) => s.section === 'nutrition')!.lines).toHaveLength(1);
    const lines = previewUpdate(raw, nextRaw, update, 'kJ').flatMap((s) => s.lines.map((l) => l.text));
    const lunch = lines.find((t) => t.startsWith('Fixed lunch'))!;
    expect(lunch).toContain('ingredients High-protein yoghurt 200 g (~¾ cup), Rolled oats 40 g (~½ cup)');
    expect(lunch).toContain('Water (as needed)');
    expect(lunch).toContain('preparation Mix yoghurt and protein powder first');
  });

  it('reads in plain language: units, thousands separators, labels, and no "—" (#21)', () => {
    const { nextRaw, update, raw } = apply(fixture('combined'));
    const all = previewUpdate(raw, nextRaw, update, 'kJ').flatMap((s) => s.lines.map((l) => l.text));
    expect(all).toContain('Energy: ≤ 7,530 kJ → ≤ 7,300 kJ');
    // The seed lunch now carries ingredients (#26); this older update replaces the meal without them.
    expect(all.find((t) => t.startsWith('Fixed lunch at 12:00:'))).toMatch(/energy 1,780 kJ, protein 42 g → energy 2,100 kJ, protein 55 g; cleared: purpose, ingredients, preparation and reminders$/);
    expect(all.find((t) => t.startsWith('Conditioning:'))).toContain('activities VR boxing, Heavy bag rounds, Battle ropes');
    expect(all.join('\n')).not.toMatch(/—|sessionsPerWeek|max 7530|\b\d{4,}\b/);
  });

  it('lists supplied sections with readable changes and marks the rest untouched', () => {
    const { nextRaw, update, raw } = apply(fixture('real-world-exercise'));
    const preview = previewUpdate(raw, nextRaw, update, 'kJ');
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
    const lines = previewUpdate(base, nextRaw, update, 'kJ').find((s) => s.section === 'exercise')!.lines.map((l) => `${l.kind} ${l.text}`);
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
    // Examples are complete replies: the bare object on one line, exactly as the AI should send it (#47).
    const blocks = [...text.matchAll(/^\{"fitnessConfigUpdate".*\}$/gm)].map((m) => m[0]).filter((b) => !b.includes('<section>'));
    expect(blocks).toHaveLength(4);
    for (const b of blocks) expect(() => apply(b)).not.toThrow();
  });
  it('asks for the bare JSON object only, names every section, and still shows the current config (#47)', () => {
    expect(text).toMatch(/your whole reply is ONE JSON object and nothing else/);
    expect(text).toMatch(/No code block, no Markdown/);
    expect(text).toMatch(/Sections you can change: profile, goals, nutrition, exercise, schedule, tracking/);
    expect(text).toMatch(/same letter case/);
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
    expect(after).toMatchObject({ revision: before.revision + 1, origin: 'config', formatVersion: 4 });
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

describe('merge by id (#26): change one list item without resending the list', () => {
  const snack = { id: 'snack', kind: 'meal', label: 'Fixed snack', detail: 'Apple and cheese', when: 'afternoon', after: ['lunch'], purpose: 'nutrition' };
  it('replaces the item with the same id in place and leaves the rest untouched', () => {
    const { nextRaw, raw } = apply(JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, nutrition: { meals: { merge: [snack] } } } }));
    const ids = (r: any) => r.activities.map((a: any) => a.id);
    expect(ids(nextRaw)).toEqual(ids(raw)); // same order
    expect(nextRaw.activities.find((a: any) => a.id === 'snack').detail).toBe('Apple and cheese');
    expect(JSON.stringify(nextRaw.activities.filter((a: any) => a.id !== 'snack'))).toBe(JSON.stringify(raw.activities.filter((a: any) => a.id !== 'snack')));
  });
  it('adds an item with a new id', () => {
    const breakfast = { id: 'breakfast', kind: 'meal', label: 'Breakfast', time: '07:30', ingredients: [{ name: 'Eggs', measure: '2' }] };
    const { nextRaw } = apply(JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, nutrition: { meals: { merge: [breakfast] } } } }));
    expect(nextRaw.activities.filter((a: any) => a.kind === 'meal').map((a: any) => a.id)).toEqual(['lunch', 'snack', 'dinner', 'breakfast']);
  });
  it('validates merged items like any other (and the merged plan as a whole)', () => {
    const bad = parseConfigUpdate(JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, nutrition: { meals: { merge: [{ ...snack, kind: 'exercise' }] } } } }));
    expect(bad.ok).toBe(false);
    const p = parseConfigUpdate(JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, nutrition: { meals: { merge: [{ ...snack, ingredients: [{ name: 'Apple' }] }] } } } }));
    if (!p.ok) throw new Error(p.errors.join());
    const a = applyConfigUpdate(baseRaw(), p.update);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.errors.join()).toMatch(/needs grams, ml or a measure/);
  });
  it('a meal cannot replace an exercise with the same id: that is a duplicate, and nothing is applied', () => {
    const p = parseConfigUpdate(JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, nutrition: { meals: { merge: [{ ...snack, id: 'dog-walk' }] } } } }));
    if (!p.ok) throw new Error(p.errors.join());
    const a = applyConfigUpdate(baseRaw(), p.update);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.errors.join()).toMatch(/duplicate activity id "dog-walk"/);
  });
  it('only id-keyed lists accept merge', () => {
    const p = parseConfigUpdate(JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, exercise: { equipment: { merge: [{ type: 'kettlebell' }] } } } }));
    expect(p.ok).toBe(false);
  });
  it('the AI instructions explain merge and mark the lists that take it', () => {
    const text = buildAiInstructions(baseRaw(), '2026-11-02');
    expect(text).toContain('{ "merge": [items] }');
    expect(text).toMatch(/- meals \(merge by id\):/);
  });
});

describe('reminders in configuration (#30)', () => {
  const update = (body: object) => {
    const p = parseConfigUpdate(JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, ...body } }));
    if (!p.ok) throw new Error(p.errors.join());
    return applyConfigUpdate(baseRaw(), p.update);
  };
  const reminders = (raw: any, id: string) => raw.activities.find((a: any) => a.id === id).notifications;
  it('changing one activity’s reminder (merge by id) leaves every other activity’s reminders untouched', () => {
    const snack = { ...baseRaw().activities.find((a: any) => a.id === 'snack'), notifications: [{ at: '15:30', title: 'Snack', body: 'Snack time' }] };
    const a = update({ nutrition: { meals: { merge: [snack] } } });
    if (!a.ok) throw new Error(a.errors.join());
    expect(reminders(a.nextRaw, 'snack')).toEqual([{ at: '15:30', title: 'Snack', body: 'Snack time' }]);
    expect(reminders(a.nextRaw, 'lunch')).toEqual(reminders(baseRaw(), 'lunch'));
    expect(reminders(a.nextRaw, 'dinner')).toEqual(reminders(baseRaw(), 'dinner'));
  });
  it('a reminder can be added to a non-meal and removed again', () => {
    const resistance = { ...baseRaw().activities.find((a: any) => a.id === 'resistance'), notifications: [{ at: '21:25', title: 'Strength', body: 'Strength workout soon' }] };
    const added = update({ schedule: { activities: { merge: [resistance] } } });
    if (!added.ok) throw new Error(added.errors.join());
    expect(reminders(added.nextRaw, 'resistance')).toHaveLength(1);
    const { notifications: _n, ...without } = resistance;
    const removed = applyConfigUpdate(added.nextRaw, (parseConfigUpdate(JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, schedule: { activities: { merge: [without] } } } })) as any).update);
    if (!removed.ok) throw new Error(removed.errors.join());
    expect(reminders(removed.nextRaw, 'resistance')).toBeUndefined();
  });
  it('turning reminders on or off is not configuration: the plan has no such field', () => {
    const p = parseConfigUpdate(JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, tracking: { remindersEnabled: true } } }));
    expect(p.ok).toBe(false);
    expect(buildAiInstructions(baseRaw(), '2026-11-02')).toMatch(/never try to turn them on or off/);
  });
});
