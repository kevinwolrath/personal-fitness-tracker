import Ajv2020 from 'ajv/dist/2020';
import contract from '../../../docs/design-contracts/plan.schema.json';
import example from '../../../fixtures/plans/prescription-example.plan.json';
import seed from '../../../plans/seed.plan.json';
import { undoConfigChange } from '../../config/service';
import { installSeedPlan, loadActivePlan } from '../../plan/bootstrap';
import { dietaryNeeds, weekdays } from '../../plan/schema';
import { validatePlan } from '../../plan/validate';
import { mealTemplates, type Diet } from '../../presets/meals';
import { KeyValueTrackingStore, MemoryKeyValue } from '../../storage/keyValueStore';
import { buildSetupPrompt, checkSetupReply } from '../ai';
import { chooseAgeBand, chooseWeightBand, draftFromProfile, enterAge, enterExactWeight, newDraft, readDraft, toggleGoal, toProfile, type Draft } from '../draft';
import { applyProfileToExisting, applySetupToExisting, finishSetup, weighInFor } from '../finish';
import { answerLines } from '../labels';
import { noNutritionSeed, setNutritionSeed } from '../nutritionSeed';
import { buildStarterPlan, rebuildSummary, replanExisting, STARTER_PLAN_ID } from '../starterPlan';

/** #49 + #53: first-run setup. Answers, the offline starter plan, AI refinement, finishing and editing setup. */

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
const contractValidate = ajv.compile(contract);
const TODAY = '2026-11-06';
const subsets = <T,>(xs: readonly T[]): T[][] => xs.reduce<T[][]>((acc, x) => [...acc, ...acc.map((s) => [...s, x])], [[]]);

const answered = (over: Partial<Draft> = {}): Draft => ({
  ...newDraft(),
  gender: 'female',
  ageBand: '40_59',
  weightBand: '70_99',
  fitnessGoals: ['gradual_loss', 'gain_muscle'],
  activityLevel: 'some_walking',
  daysPerWeek: 4,
  equipment: ['none'],
  dietary: ['vegetarian'],
  considerations: 'Sore left knee',
  ...over,
});
const valid = (raw: unknown) => {
  const r = validatePlan(raw);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  if (!contractValidate(raw)) throw new Error(JSON.stringify(contractValidate.errors));
  return r.plan;
};
const acts = (raw: any) => raw.activities as Record<string, any>[];

describe('answers', () => {
  it('a missing, unreadable or older draft starts fresh; a valid one resumes', () => {
    expect(readDraft(null)).toEqual(newDraft());
    expect(readDraft('{nope')).toEqual(newDraft());
    expect(readDraft(JSON.stringify({ v: 1, step: 'goals' }))).toEqual(newDraft()); // #49's drafts
    const d = answered({ step: 'goals' });
    expect(readDraft(JSON.stringify(d))).toEqual(d);
  });

  it('gradual and faster loss exclude each other; maintain excludes both; others combine', () => {
    let d = toggleGoal(newDraft(), 'gradual_loss');
    d = toggleGoal(d, 'faster_loss');
    expect(d.fitnessGoals).toEqual(['faster_loss']);
    d = toggleGoal(d, 'gain_muscle');
    d = toggleGoal(d, 'maintain');
    expect(d.fitnessGoals).toEqual(['gain_muscle', 'maintain']);
    d = toggleGoal(d, 'gradual_loss');
    expect(d.fitnessGoals).toEqual(['gain_muscle', 'gradual_loss']);
  });

  it('a specific age sets its band; under 18 is tracking only and clears goals', () => {
    expect(enterAge(newDraft(), 45)).toMatchObject({ age: 45, ageBand: '40_59' });
    expect(enterAge(newDraft(), 72)).toMatchObject({ age: 72, ageBand: '60_plus' });
    const kid = enterAge(answered(), 16);
    expect(kid).toMatchObject({ ageBand: 'under_18', age: undefined, fitnessGoals: [] });
    expect(chooseAgeBand(answered(), 'under_18').fitnessGoals).toEqual([]);
    expect(chooseAgeBand(enterAge(newDraft(), 45), '18_39')).toMatchObject({ ageBand: '18_39', age: undefined });
  });

  it('a band and a specific weight replace each other; a band clears the weigh-in', () => {
    const d = chooseWeightBand({ ...enterExactWeight(newDraft(), 82.4), logWeighIn: true }, '70_99');
    expect(d).toMatchObject({ weightBand: '70_99', exactWeight: undefined, logWeighIn: false });
  });

  it('the profile holds only what the user said; under 18 keeps no goals or training context', () => {
    expect(toProfile(newDraft())).toEqual({});
    expect(toProfile(answered())).toEqual({
      gender: 'female', ageBand: '40_59', weightBand: '70_99', fitnessGoals: ['gradual_loss', 'gain_muscle'], daysPerWeek: 4,
      activityLevel: 'some_walking', equipment: ['none'], dietary: ['vegetarian'], considerations: 'Sore left knee',
    });
    expect(toProfile(answered({ ageBand: 'under_18', fitnessGoals: [] }))).toEqual({ gender: 'female', ageBand: 'under_18', weightBand: '70_99', dietary: ['vegetarian'] });
  });

  it('editing setup starts from the plan’s saved answers', () => {
    const d = draftFromProfile({ ...toProfile(answered()), heightCm: 170, displayName: 'kept elsewhere' }, 'kg');
    expect(toProfile(d)).toEqual({ ...toProfile(answered()), heightCm: 170 });
  });

  it('lb users see lb bands and inches', () => {
    const lines = Object.fromEntries(answerLines(answered({ unit: 'lb', heightCm: 180 })).map((l) => [l.label, l.value]));
    expect(lines).toMatchObject({ Weight: '155–219 lb (a range)', Height: '71 in' });
  });
});

describe('the offline starter plan', () => {
  it('adults get an exercise week and sample meals; valid against both schemas', () => {
    const raw = buildStarterPlan(answered());
    valid(raw);
    expect(raw).toMatchObject({ id: STARTER_PLAN_ID, formatVersion: 7, goals: [], nutrition: { targets: [] } });
    expect(acts(raw).some((a) => a.id === 'strength')).toBe(true);
    expect(acts(raw).filter((a) => a.kind === 'meal').map((a) => a.id)).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);
  });

  it('meals are suggestions: optional, hand-sized, with no energy or nutrient values anywhere', () => {
    const raw = buildStarterPlan(answered({ dietary: [] }));
    for (const m of acts(raw).filter((a) => a.kind === 'meal')) {
      expect(m.required).toBe(false);
      expect(m.nutrition).toBeUndefined();
      expect(m.ingredients.every((i: any) => i.measure && i.grams === undefined)).toBe(true);
    }
    expect(JSON.stringify(raw)).not.toMatch(/"energy"\s*:\s*\d|"protein"\s*:\s*\d|"max"\s*:/);
  });

  it('every dietary combination, sample day and swap respects every restriction; unsafe swaps are refused', () => {
    const contains = new Map(mealTemplates.map((m) => [m.label, m.contains]));
    const banned: Record<Diet, string[]> = { vegetarian: ['meat', 'fish'], vegan: ['meat', 'fish', 'dairy', 'egg'], dairy_free: ['dairy'], gluten_free: ['gluten'], nut_allergy: ['nuts'] };
    for (const dietary of subsets(dietaryNeeds)) {
      for (const mealOption of [0, 1, 2]) {
        for (const swap of [undefined, ...mealTemplates.map((m) => m.id)]) {
          const d = answered({ dietary, mealOption, mealSwaps: swap ? { [mealTemplates.find((m) => m.id === swap)!.slot]: swap } : {} });
          const raw = buildStarterPlan(d);
          for (const m of acts(raw).filter((a) => a.kind === 'meal')) {
            const c = contains.get(m.label)!;
            for (const diet of dietary) expect(c.filter((x) => banned[diet].includes(x))).toEqual([]);
          }
        }
      }
    }
  });

  it('a meal with no safe template is left unplanned, never invented', () => {
    setNutritionSeed({ ...noNutritionSeed, id: 'breakfast-only', mealOptions: () => ({ breakfast: [mealTemplates[2]], lunch: [], dinner: [], snack: [] }) });
    try {
      expect(acts(buildStarterPlan(answered())).filter((a) => a.kind === 'meal').map((a) => a.id)).toEqual(['breakfast']);
    } finally {
      setNutritionSeed(null);
    }
  });

  it('three different sample days and three exercise options; swapping one meal changes only that meal', () => {
    const days = [0, 1, 2].map((mealOption) => acts(buildStarterPlan(answered({ dietary: [], mealOption }))).filter((a) => a.kind === 'meal').map((a) => a.label).join('|'));
    expect(new Set(days).size).toBe(3);
    const ex = [0, 1, 2].map((exerciseOption) => JSON.stringify(acts(buildStarterPlan(answered({ exerciseOption }))).filter((a) => a.kind !== 'meal')));
    expect(new Set(ex).size).toBe(3);
    const before = acts(buildStarterPlan(answered()));
    const after = acts(buildStarterPlan(answered({ mealSwaps: { lunch: 'chickpea-potato-bowl' } })));
    expect(after.find((a) => a.id === 'lunch')!.label).toBe('Chickpea, potato and vegetable bowl');
    expect(after.filter((a) => a.id !== 'lunch')).toEqual(before.filter((a) => a.id !== 'lunch'));
    expect(acts(buildStarterPlan(answered({ mealSwaps: { lunch: null } }))).some((a) => a.id === 'lunch')).toBe(false);
  });

  it('the three exercise options differ for every number of days the wizard offers', () => {
    for (const daysPerWeek of [undefined, 2, 3, 4, 5])
      for (const fitnessGoals of [['gain_muscle'], ['gradual_loss'], ['improve_cardio'], []] as Draft['fitnessGoals'][]) {
        const ex = [0, 1, 2].map((exerciseOption) => JSON.stringify(acts(buildStarterPlan(answered({ exerciseOption, daysPerWeek, fitnessGoals }))).filter((a) => a.kind !== 'meal')));
        expect(new Set(ex).size).toBe(3);
      }
  });

  it('removed items stay out; faster loss keeps three meals', () => {
    expect(acts(buildStarterPlan(answered({ removed: ['strength'] }))).some((a) => a.id === 'strength')).toBe(false);
    expect(acts(buildStarterPlan(answered({ fitnessGoals: ['faster_loss'] }))).some((a) => a.id === 'snack')).toBe(false);
  });

  it('every generated week has recovery: a rest day, and strength never on consecutive days', () => {
    const idx = (d: string) => weekdays.indexOf(d as never);
    for (const fitnessGoals of [['maintain'], ['gradual_loss', 'gain_muscle', 'improve_cardio'], ['faster_loss', 'gain_muscle'], []] as Draft['fitnessGoals'][]) {
      for (const activityLevel of ['mostly_sitting', 'already_training'] as const) {
        for (const exerciseOption of [0, 1, 2]) {
          for (const daysPerWeek of [undefined, 2, 5]) {
            const raw = buildStarterPlan(answered({ fitnessGoals, activityLevel, exerciseOption, daysPerWeek, equipment: ['gym'] }));
            valid(raw);
            const training = acts(raw).filter((a) => a.kind === 'exercise' && a.required !== false);
            const used = new Set(training.flatMap((a) => a.appliesTo.days));
            expect(used.size).toBeLessThanOrEqual(6);
            const strength = acts(raw).find((a) => a.id === 'strength')!.appliesTo.days.map(idx).sort();
            for (let i = 1; i < strength.length; i++) expect(strength[i] - strength[i - 1]).toBeGreaterThan(1);
          }
        }
      }
    }
  });

  it('gender never changes the plan', () => {
    const plans = (['male', 'female', 'other', undefined] as const).map((gender) => JSON.stringify(acts(buildStarterPlan(answered({ gender })))));
    expect(new Set(plans).size).toBe(1);
  });

  it('under 18: tracking only, no exercise or meal plan, whatever else was answered', () => {
    const raw = buildStarterPlan(answered({ ageBand: 'under_18', fitnessGoals: [] }));
    valid(raw);
    expect(raw.activities).toEqual([]);
    expect(raw.exercise).toBeUndefined();
  });

  it('copies nothing from the bundled personal plan', () => {
    const text = JSON.stringify(buildStarterPlan(answered()));
    for (const a of seed.activities) expect(text).not.toContain(`"${a.label}"`);
    expect(text).not.toContain(seed.title);
  });

  it('lb users get lb, kcal and inches', () => {
    expect(buildStarterPlan(answered({ unit: 'lb' })).units).toEqual({ mass: 'lb', energy: 'kcal', length: 'in' });
  });
});

describe('optional AI refinement', () => {
  const raw = buildStarterPlan(answered());
  const reply = JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, schedule: { activities: { merge: [{ id: 'walk', kind: 'exercise', label: 'Brisk walk with a friend', when: 'morning', duration: { minutes: 30 }, appliesTo: { days: ['tue', 'sat'] } }] } } } });

  it('the prompt has the answers and the starter plan, leaves nutrition out, and stays provider-neutral', () => {
    const prompt = buildSetupPrompt(raw, answered(), TODAY);
    for (const s of ['Female', '40–59', '70–99 kg (a range)', 'Gradual weight loss, Gain muscle', 'Vegetarian', 'Sore left knee']) expect(prompt).toContain(s);
    expect(prompt).toMatch(/Leave nutrition out completely/);
    expect(prompt).not.toMatch(/ChatGPT|Claude|Gemini|OpenAI|liab/i);
    expect(prompt).toMatch(/not medical advice/);
  });

  it('a reply is applied on top of the starter plan; nutrition in it is left out, with a note', () => {
    const withFood = JSON.parse(reply);
    withFood.fitnessConfigUpdate.nutrition = { targets: [{ id: 'energy', label: 'Energy', quantity: 'energy', max: 6000 }] };
    const r = checkSetupReply(raw, JSON.stringify(withFood), answered(), 'kJ');
    if (!r.ok) throw new Error(r.errors.join('\n'));
    expect(acts(r.nextRaw).find((a) => a.id === 'walk')!.label).toBe('Brisk walk with a friend');
    expect(acts(r.nextRaw).some((a) => a.id === 'breakfast')).toBe(true); // sample meals kept
    expect(r.nextRaw.nutrition).toEqual({ targets: [] });
    expect(r.notes).toContain("Nutrition isn't set up yet, so the AI's nutrition suggestions were left out.");
  });

  it('under 18: refused', () => {
    const minor = answered({ ageBand: 'under_18', fitnessGoals: [] });
    expect(checkSetupReply(buildStarterPlan(minor), reply, minor, 'kJ').ok).toBe(false);
  });
});

describe('finishing setup', () => {
  const fresh = () => new KeyValueTrackingStore(new MemoryKeyValue());

  it('a new install stores the confirmed plan; setup never returns', async () => {
    const store = fresh();
    expect(await loadActivePlan(store)).toBeNull();
    await finishSetup(store, buildStarterPlan(answered()), answered(), TODAY);
    expect(await store.getActivePlan()).toMatchObject({ planId: STARTER_PLAN_ID, origin: 'onboarding', formatVersion: 7 });
    expect((await loadActivePlan(store))!.activities.length).toBeGreaterThan(0);
  });

  it('a weight band is never recorded; an exact weight only when ticked, lb stored canonically', async () => {
    const store = fresh();
    await finishSetup(store, buildStarterPlan(answered()), answered({ logWeighIn: true }), TODAY);
    expect((await store.getDay(STARTER_PLAN_ID, TODAY)).observations).toEqual([]);
    const d = { ...enterExactWeight(answered({ unit: 'lb' }), 180), logWeighIn: true };
    expect(weighInFor(valid(buildStarterPlan(d)), d, TODAY)!.value).toBeCloseTo(81.65, 2);
    expect(weighInFor(valid(buildStarterPlan(d)), { ...d, logWeighIn: false }, TODAY)).toBeNull();
  });

  it('editing setup on an existing plan: a new revision of the same plan, history and records kept, undoable', async () => {
    const store = fresh();
    await installSeedPlan(store);
    const obs = { id: 'w1', date: '2026-11-01', metric: 'weight', value: 97, unit: 'kg', kind: 'observed' as const, label: null, note: null, source: { type: 'integration' as const, app: 'withings', capturedAt: null, confidence: null, importId: 'health-connect', assetId: null, evidence: null, edited: false }, recordedAt: 't' };
    await store.addObservations([obs]);
    await store.setActivity(seed.id, '2026-11-02', 'lunch', { activityId: 'lunch', status: 'done', count: 0, labelSnapshot: 'Lunch', updatedAt: 't' });
    const before = (await store.getActivePlan())!;

    const plan = await applySetupToExisting(store, before, buildStarterPlan(answered()), answered(), TODAY);
    const after = (await store.getActivePlan())!;
    expect(after).toMatchObject({ planId: seed.id, revision: before.revision + 1, origin: 'config' });
    expect(plan.measurements.map((m) => m.id)).toEqual(expect.arrayContaining(['weight', 'waist'])); // kept
    expect(plan.goals).toEqual(JSON.parse(before.json).goals); // measurement goals kept
    expect(plan.profile).toMatchObject({ fitnessGoals: ['gradual_loss', 'gain_muscle'] });
    expect(await store.latestObservation('weight', TODAY)).toMatchObject({ id: 'w1' }); // imports untouched
    expect((await store.getDay(seed.id, '2026-11-02')).activities.lunch.status).toBe('done'); // history untouched
    const [change] = await store.configHistory();
    expect(change).toMatchObject({ sections: ['setup'], previousPlanJson: before.json });

    const undone = await undoConfigChange(store, after, change);
    expect({ ...JSON.parse(undone.json), revision: 0 }).toEqual({ ...JSON.parse(before.json), revision: 0 });
  });

  it('refuses to store an invalid plan', async () => {
    await expect(finishSetup(fresh(), { ...buildStarterPlan(answered()), formatVersion: 99 }, answered(), TODAY)).rejects.toThrow(/isn't valid/);
  });
});

describe('existing customised plans are protected (#53)', () => {
  const fresh = () => new KeyValueTrackingStore(new MemoryKeyValue());
  const nonProfile = (raw: any) => {
    const { profile: _p, revision: _r, formatVersion: _f, ...rest } = raw;
    return rest;
  };

  it('Edit profile changes only the setup answers: schedule, day types, meals, activities, requirements, targets and units stay byte-for-byte', async () => {
    const store = fresh();
    await installSeedPlan(store); // a customised personal plan: day types, meals, requirements, targets
    await store.setActivity(seed.id, '2026-11-02', 'lunch', { activityId: 'lunch', status: 'done', count: 0, labelSnapshot: 'Lunch', updatedAt: 't' });
    await store.addObservations([{ id: 'w1', date: '2026-11-01', metric: 'weight', value: 97, unit: 'kg', kind: 'observed', label: null, note: null, source: { type: 'integration', app: 'withings', capturedAt: null, confidence: null, importId: 'health-connect', assetId: null, evidence: null, edited: false }, recordedAt: 't' }]);
    const before = (await store.getActivePlan())!;

    await applyProfileToExisting(store, before, answered({ unit: 'lb', exactWeight: 200, weightBand: undefined, fitnessGoals: ['faster_loss'] }), TODAY);
    const after = (await store.getActivePlan())!;
    const b = JSON.parse(before.json);
    const a = JSON.parse(after.json);
    expect(nonProfile(a)).toEqual(nonProfile(b)); // nothing but the profile changed
    expect(a.units).toEqual(b.units); // kg plan stays kg
    expect(a.profile).toMatchObject({ fitnessGoals: ['faster_loss'], weight: 90.7 }); // 200 lb stored in the plan's kg
    expect(after).toMatchObject({ planId: seed.id, revision: before.revision + 1, origin: 'config' });
    expect((await store.getDay(seed.id, '2026-11-02')).activities.lunch.status).toBe('done');
    expect(await store.latestObservation('weight', TODAY)).toMatchObject({ id: 'w1' });

    const [change] = await store.configHistory();
    expect(change).toMatchObject({ sections: ['profile'], previousPlanJson: before.json });
    const undone = await undoConfigChange(store, after, change);
    expect({ ...JSON.parse(undone.json), revision: 0 }).toEqual({ ...b, revision: 0 });
  });

  it("Edit profile keeps the plan's own profile notes and removes only answers the user cleared", async () => {
    const store = fresh();
    await installSeedPlan(store);
    const cur = (await store.getActivePlan())!;
    await store.setActivePlan({ ...cur, json: JSON.stringify({ ...JSON.parse(cur.json), formatVersion: 6, profile: { displayName: 'K', heightCm: 182, dietary: ['vegan'] } }) });
    await applyProfileToExisting(store, (await store.getActivePlan())!, answered({ dietary: [], heightCm: 182 }), TODAY);
    const p = JSON.parse((await store.getActivePlan())!.json).profile;
    expect(p.displayName).toBe('K');
    expect(p.dietary).toBeUndefined();
  });

  it('Rebuild shows what it replaces before anything is applied', () => {
    const current = JSON.parse(JSON.stringify(seed));
    const next = replanExisting(current, buildStarterPlan(answered()));
    const c = rebuildSummary(current, next);
    expect(c.removed).toEqual(expect.arrayContaining(seed.activities.map((a) => a.label).filter((l) => !acts(next).some((x) => x.label === l))));
    expect(c.removed.length).toBeGreaterThan(0);
    expect(c.added).toContain('Full-body strength at home');
    expect(c.dayTypes).toEqual(seed.dayTypes.map((d) => d.label));
    expect(c.requirements.length).toBeGreaterThan(0);
  });
});

describe('plan formatVersion 6 profile rules', () => {
  const v = (formatVersion: number, profile: Record<string, unknown>) => ({ ...JSON.parse(JSON.stringify(example)), formatVersion, profile });

  it('setup fields need formatVersion 6', () => {
    for (const profile of [{ gender: 'other' }, { ageBand: '18_39' }, { fitnessGoals: ['maintain'] }, { dietary: ['vegan'] }]) {
      expect(validatePlan(v(5, profile)).ok).toBe(false);
      expect(contractValidate(v(5, profile))).toBe(false);
      expect(validatePlan(v(6, profile)).ok).toBe(true);
      expect(contractValidate(v(6, profile))).toBe(true);
    }
  });

  it.each([
    ['gradual and faster loss together', { fitnessGoals: ['gradual_loss', 'faster_loss'] }],
    ['maintain with weight loss', { fitnessGoals: ['maintain', 'gradual_loss'] }],
    ['weight loss under 18', { ageBand: 'under_18', fitnessGoals: ['faster_loss'] }],
    ['an age outside its band', { age: 30, ageBand: '40_59' }],
    ['an exact weight and a band', { weight: 80, weightBand: '70_99' }],
    ['an age under 18', { age: 16 }],
    ['an old #49 band', { ageBand: '40_49' }],
  ])('rejects %s', (_n, profile) => {
    expect(validatePlan(v(6, profile)).ok).toBe(false);
  });
});
