import Ajv2020 from 'ajv/dist/2020';
import contract from '../../../docs/design-contracts/plan.schema.json';
import example from '../../../fixtures/plans/prescription-example.plan.json';
import seed from '../../../plans/seed.plan.json';
import { buildAiInstructions } from '../../config/instructions';
import { loadActivePlan } from '../../plan/bootstrap';
import { validatePlan } from '../../plan/validate';
import { KeyValueTrackingStore, MemoryKeyValue } from '../../storage/keyValueStore';
import { buildSetupPrompt, checkSetupReply } from '../ai';
import { chooseWeightBand, enterExactWeight, newDraft, readDraft, toggleGoal, toProfile, type Draft } from '../draft';
import { finishSetup, weighInFor } from '../finish';
import { answerLines } from '../labels';
import { noNutritionSeed, setNutritionSeed } from '../nutritionSeed';
import { buildStarterPlan, STARTER_PLAN_ID } from '../starterPlan';

/** #49: first-run setup. Pure parts: answers, starter plan, the AI prompt and reply, and finishing. */

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
const contractValidate = ajv.compile(contract);
const TODAY = '2026-11-06';

const answered = (over: Partial<Draft> = {}): Draft => ({
  ...newDraft(),
  gender: 'female',
  ageBand: '40_49',
  weightBand: '80_99',
  fitnessGoals: ['lose_weight', 'gain_muscle'],
  primaryGoal: 'lose_weight',
  daysPerWeek: 3,
  sessionMinutes: 45,
  trainingPlaces: ['home', 'no_equipment'],
  activityLevel: 'some_walking',
  considerations: 'Sore left knee',
  ...over,
});

const scheduleReply = JSON.stringify({
  fitnessConfigUpdate: {
    schemaVersion: 1,
    schedule: {
      activities: [
        { id: 'walk', kind: 'exercise', label: 'Brisk walk', when: 'morning', duration: { minutes: 30 } },
        { id: 'strength', kind: 'exercise', label: 'Home strength', time: '18:00', duration: { minutes: 30 }, appliesTo: { days: ['mon', 'wed', 'fri'] } },
      ],
    },
    exercise: { goals: ['weight_loss', 'muscle_gain'], constraints: { location: 'home' } },
  },
});

describe('answers (draft)', () => {
  it('a missing or unreadable draft starts fresh; a valid one resumes', () => {
    expect(readDraft(null)).toEqual(newDraft());
    expect(readDraft('{nope')).toEqual(newDraft());
    expect(readDraft(JSON.stringify({ v: 1, step: 'warp' }))).toEqual(newDraft());
    const d = answered({ step: 'context' });
    expect(readDraft(JSON.stringify(d))).toEqual(d);
  });

  it('the first goal leads; removing the primary passes it on; several goals allowed', () => {
    let d = toggleGoal(newDraft(), 'gain_muscle');
    d = toggleGoal(d, 'improve_cardio');
    expect(d).toMatchObject({ fitnessGoals: ['gain_muscle', 'improve_cardio'], primaryGoal: 'gain_muscle' });
    d = toggleGoal(d, 'gain_muscle');
    expect(d).toMatchObject({ fitnessGoals: ['improve_cardio'], primaryGoal: 'improve_cardio' });
    d = toggleGoal(d, 'improve_cardio');
    expect(d.fitnessGoals).toEqual([]);
    expect(d.primaryGoal).toBeUndefined();
  });

  it('a band and an exact weight replace each other; choosing a band always clears the weigh-in', () => {
    let d = enterExactWeight(newDraft(), 82.4);
    d = { ...d, logWeighIn: true };
    d = chooseWeightBand(d, '80_99');
    expect(d).toMatchObject({ weightBand: '80_99', exactWeight: undefined, logWeighIn: false });
    expect(enterExactWeight(d, 81)).toMatchObject({ weightBand: undefined, exactWeight: 81 });
  });

  it('the profile holds only what the user said', () => {
    expect(toProfile(newDraft())).toEqual({});
    expect(toProfile(answered())).toEqual({
      gender: 'female', ageBand: '40_49', weightBand: '80_99', fitnessGoals: ['lose_weight', 'gain_muscle'], primaryGoal: 'lose_weight',
      daysPerWeek: 3, sessionMinutes: 45, trainingPlaces: ['home', 'no_equipment'], activityLevel: 'some_walking', considerations: 'Sore left knee',
    });
  });

  it('under 18: no goals or training context reach the profile', () => {
    expect(toProfile(answered({ ageBand: 'under_18' }))).toEqual({ gender: 'female', ageBand: 'under_18', weightBand: '80_99' });
    expect(answerLines(answered({ ageBand: 'under_18' })).map((l) => l.label)).toEqual(['Gender', 'Age', 'Weight']);
  });

  it('"From you" lines read as the user chose them, primary goal first, lb shown in lb', () => {
    const lines = Object.fromEntries(answerLines(answered({ unit: 'lb', fitnessGoals: ['gain_muscle', 'lose_weight'], primaryGoal: 'lose_weight' })).map((l) => [l.label, l.value]));
    expect(lines).toMatchObject({ Goals: 'Lose a little weight (primary), Gain muscle', Weight: '176–219 lb (a range)', 'Where you train': 'Home, No equipment' });
  });
});

describe('the starter plan', () => {
  it('is a valid formatVersion 6 plan with the profile, weight tracking and nothing else', () => {
    const raw = buildStarterPlan(answered());
    expect(contractValidate(raw) ? [] : contractValidate.errors).toEqual([]);
    const r = validatePlan(raw);
    expect(r.ok).toBe(true);
    expect(raw).toMatchObject({ id: STARTER_PLAN_ID, formatVersion: 6, activities: [], goals: [], nutrition: { targets: [] }, quickLogs: [] });
    expect(raw.measurements).toEqual([expect.objectContaining({ id: 'weight', quantity: 'mass' })]);
    expect(raw.profile).toEqual(toProfile(answered()));
  });

  it('copies nothing from the bundled personal plan: no meals, workouts, diet or goal targets', () => {
    const text = JSON.stringify(buildStarterPlan(answered()));
    for (const a of seed.activities) expect(text).not.toContain(`"${a.label}"`);
    expect(text).not.toContain(seed.title);
    expect(text).not.toMatch(/"kind":"meal"|ingredients|protein|eatingWindow|"max":/);
  });

  it('lb users get lb, kcal and inches', () => {
    expect(buildStarterPlan(answered({ unit: 'lb' })).units).toEqual({ mass: 'lb', energy: 'kcal', length: 'in' });
  });

  it('no answers at all is still a valid plan', () => {
    const raw = buildStarterPlan(newDraft());
    expect(raw.profile).toBeUndefined();
    expect(validatePlan(raw).ok).toBe(true);
  });
});

describe('the nutrition seed is pluggable and empty for now', () => {
  afterEach(() => setNutritionSeed(null));

  it('by default: no nutrition in the plan, and the prompt tells the AI to leave it out', () => {
    const raw = buildStarterPlan(answered());
    expect(raw.nutrition).toEqual({ targets: [] });
    const prompt = buildSetupPrompt(raw, answered(), TODAY);
    expect(prompt).toMatch(/Leave nutrition out completely/);
    expect(prompt).toMatch(/Never include nutrition/);
    expect(prompt).not.toMatch(/7300|"protein"|eatingWindow|Afternoon snack/);
    expect(prompt).toMatch(/Sections you can change: profile, goals, exercise, schedule, tracking\./);
  });

  it('a provider plugs in without changing the wizard: plan, prompt and reply handling all follow it', () => {
    setNutritionSeed({
      id: 'test',
      apply: (raw) => ({ ...raw, nutrition: { targets: [{ id: 'protein', label: 'Protein', quantity: 'grams', min: 1 }] } }),
      prompt: () => 'TEST NUTRITION INSTRUCTIONS',
      allowsAiNutrition: true,
    });
    const raw = buildStarterPlan(answered());
    expect(raw.nutrition.targets).toHaveLength(1);
    expect(validatePlan(raw).ok).toBe(true);
    const prompt = buildSetupPrompt(raw, answered(), TODAY);
    expect(prompt).toContain('TEST NUTRITION INSTRUCTIONS');
    expect(prompt).not.toMatch(/Leave nutrition out/);
    const reply = JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, nutrition: { eatingWindow: { start: '10:00', end: '18:00' } } } });
    const r = checkSetupReply(raw, reply, answered(), 'kJ');
    expect(r.ok && r.nextRaw.nutrition.eatingWindow).toEqual({ start: '10:00', end: '18:00' });
  });

  it('reset restores the empty provider', () => {
    setNutritionSeed(null);
    expect(buildStarterPlan(answered()).nutrition).toEqual(noNutritionSeed.apply({ nutrition: { targets: [] } }, {}).nutrition);
  });
});

describe('the AI prompt', () => {
  const prompt = buildSetupPrompt(buildStarterPlan(answered()), answered(), TODAY);

  it('includes what the user told the app, and only that', () => {
    for (const s of ['Female', '40–49', '80–99 kg (a range)', 'Lose a little weight (primary), Gain muscle', 'Home, No equipment', 'Sore left knee']) expect(prompt).toContain(s);
    expect(prompt).not.toContain(seed.title);
  });

  it('is provider-neutral, asks before guessing about health, and makes no medical or liability claims', () => {
    expect(prompt).not.toMatch(/ChatGPT|Claude|Gemini|OpenAI|function call|tool_use/i);
    expect(prompt).toMatch(/Don't guess about health limits/);
    expect(prompt).toMatch(/This is a suggestion, not medical advice/);
    expect(prompt).not.toMatch(/liab|responsib/i);
  });

  it('every example in it is a valid reply for a new plan', () => {
    const raw = buildStarterPlan(answered());
    const blocks = [...prompt.matchAll(/^\{"fitnessConfigUpdate".*\}$/gm)].map((m) => m[0]).filter((b) => !b.includes('<section>'));
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const b of blocks) expect(checkSetupReply(raw, b, answered(), 'kJ')).toMatchObject({ ok: true });
  });

  it("doesn't change Configure with AI's own instructions", () => {
    const text = buildAiInstructions(JSON.parse(JSON.stringify(seed)), TODAY);
    expect(text).toMatch(/Sections you can change: profile, goals, nutrition, exercise, schedule, tracking\./);
    expect(text).toMatch(/Start by asking me what I'd like to change\.$/);
  });
});

describe('checking the reply', () => {
  const raw = buildStarterPlan(answered());

  it('a schedule reply becomes the plan to review, with every assumed change listed', () => {
    const r = checkSetupReply(raw, scheduleReply, answered(), 'kJ');
    if (!r.ok) throw new Error(r.errors.join('\n'));
    expect(r.nextRaw.activities.map((a: { id: string }) => a.id)).toEqual(['walk', 'strength']);
    expect(r.nextRaw.profile).toEqual(raw.profile); // the user's answers are untouched
    expect(r.preview.map((p) => p.section)).toEqual(['exercise', 'schedule']);
    expect(r.preview.flatMap((p) => p.lines.map((l) => l.text)).join('\n')).toMatch(/Brisk walk/);
  });

  it('a chatty, fenced reply still imports (#47 importer)', () => {
    const r = checkSetupReply(raw, `Here's your plan!\n\`\`\`json\n${scheduleReply}\n\`\`\`\nGood luck.`, answered(), 'kJ');
    expect(r.ok).toBe(true);
  });

  it('nutrition in the reply is left out, and the review says so', () => {
    const withFood = JSON.parse(scheduleReply);
    withFood.fitnessConfigUpdate.nutrition = { targets: [{ id: 'energy', label: 'Energy', quantity: 'energy', max: 6000 }] };
    const r = checkSetupReply(raw, JSON.stringify(withFood), answered(), 'kJ');
    if (!r.ok) throw new Error(r.errors.join('\n'));
    expect(r.nextRaw.nutrition).toEqual({ targets: [] });
    expect(r.notes).toContain("Nutrition isn't set up yet, so the AI's nutrition suggestions were left out.");
  });

  it('a nutrition-only reply has nothing to use', () => {
    const r = checkSetupReply(raw, JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, nutrition: { targets: [] } } }), answered(), 'kJ');
    expect(r).toMatchObject({ ok: false, errors: [expect.stringMatching(/nothing the app can use/)] });
  });

  it('an unusable reply explains why, with details to copy for the AI', () => {
    const r = checkSetupReply(raw, 'Sure! What days suit you?', answered(), 'kJ');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.diagnostics).toMatch(/could not be imported/);
  });

  it('an invalid plan is refused as a whole', () => {
    const bad = JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, schedule: { activities: [{ id: 'x', kind: 'exercise', label: 'X', time: '25:00' }] } } });
    expect(checkSetupReply(raw, bad, answered(), 'kJ').ok).toBe(false);
  });

  it('under 18: no AI plan, whatever is pasted', () => {
    const minor = answered({ ageBand: 'under_18' });
    expect(checkSetupReply(buildStarterPlan(minor), scheduleReply, minor, 'kJ')).toMatchObject({ ok: false, errors: [expect.stringMatching(/adults \(18\+\)/)] });
  });
});

describe('finishing setup', () => {
  const fresh = () => new KeyValueTrackingStore(new MemoryKeyValue());

  it('stores the confirmed plan; after that the app opens on it and setup never returns', async () => {
    const store = fresh();
    expect(await loadActivePlan(store)).toBeNull(); // fresh install: setup
    const plan = await finishSetup(store, buildStarterPlan(answered()), answered(), TODAY);
    expect(await store.getActivePlan()).toMatchObject({ planId: STARTER_PLAN_ID, origin: 'onboarding', formatVersion: 6 });
    expect((await loadActivePlan(store))!.id).toBe(plan.id);
  });

  it('a weight band is never recorded as a weigh-in', async () => {
    const store = fresh();
    await finishSetup(store, buildStarterPlan(answered()), answered({ logWeighIn: true }), TODAY);
    expect((await store.getDay(STARTER_PLAN_ID, TODAY)).observations).toEqual([]);
  });

  it('an exact weight is recorded only when the box is ticked', async () => {
    const off = fresh();
    const d = enterExactWeight(answered(), 82.4);
    await finishSetup(off, buildStarterPlan(d), d, TODAY);
    expect((await off.getDay(STARTER_PLAN_ID, TODAY)).observations).toEqual([]);

    const on = fresh();
    const ticked = { ...d, logWeighIn: true };
    await finishSetup(on, buildStarterPlan(ticked), ticked, TODAY);
    expect((await on.getDay(STARTER_PLAN_ID, TODAY)).observations).toEqual([
      expect.objectContaining({ metric: 'weight', value: 82.4, unit: 'kg', kind: 'observed', date: TODAY, source: expect.objectContaining({ type: 'manual' }) }),
    ]);
  });

  it('an exact weight in lb is stored canonically', () => {
    const d = { ...enterExactWeight(answered({ unit: 'lb' }), 180), logWeighIn: true };
    const plan = validatePlan(buildStarterPlan(d));
    if (!plan.ok) throw new Error('invalid');
    expect(weighInFor(plan.plan, d, TODAY)!.value).toBeCloseTo(81.65, 2);
  });

  it('refuses to store an invalid plan', async () => {
    await expect(finishSetup(fresh(), { ...buildStarterPlan(answered()), formatVersion: 99 }, answered(), TODAY)).rejects.toThrow(/isn't valid/);
  });
});

describe('plan formatVersion 6 (profile) and empty plans', () => {
  const v = (formatVersion: number, edit: (p: any) => void) => {
    const p = { ...JSON.parse(JSON.stringify(example)), formatVersion };
    edit(p);
    return p;
  };

  it.each([
    ['gender', (p: any) => (p.profile = { gender: 'female' })],
    ['ageBand', (p: any) => (p.profile = { ageBand: '30_39' })],
    ['fitnessGoals', (p: any) => (p.profile = { fitnessGoals: ['maintain'] })],
  ])('profile %s needs formatVersion 6', (_n, edit) => {
    for (const [ver, ok] of [[5, false], [6, true]] as const) {
      const p = v(ver, edit);
      expect(validatePlan(p).ok).toBe(ok);
      expect(contractValidate(p)).toBe(ok);
    }
  });

  it.each([
    ['a primary goal that is not one of the goals', (p: any) => (p.profile = { fitnessGoals: ['maintain'], primaryGoal: 'gain_muscle' })],
    ['both an exact weight and a band', (p: any) => (p.profile = { weight: 80, weightBand: '80_99' })],
    ['an unknown age band', (p: any) => (p.profile = { ageBand: '17' })],
    ['the same goal twice', (p: any) => (p.profile = { fitnessGoals: ['maintain', 'maintain'] })],
  ])('rejects %s', (_n, edit) => {
    const p = v(6, edit);
    expect(validatePlan(p).ok).toBe(false);
  });

  it('a plan may have no activities yet', () => {
    const p = v(6, (x) => (x.activities = []));
    delete p.requirements;
    expect(validatePlan(p).ok).toBe(true);
    expect(contractValidate(p) ? [] : contractValidate.errors).toEqual([]);
  });
});
