import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import seed from '../../../plans/seed.plan.json';
import gemini from '../../../fixtures/config/text-replies/gemini-2026-11-11.json';
import { interpretInput } from '../interpret';
import { combineUpdates } from '../combine';
import { applyConfigUpdate } from '../../config/update';
import { applyReply, finalizeDraft, newDraft } from '../../nutrition/draft';
import type { RawPlan } from '../../config/sections';

type Case = { id: string; input: string; context?: string; expected: { intents: unknown[]; stateChanges: Record<string, unknown>; recovered?: boolean; allMatching?: boolean } };
const local: Case[] = readFileSync('fixtures/input/corpus.jsonl', 'utf8').trim().split('\n').map((line) => JSON.parse(line));
const corrections = JSON.parse(readFileSync('fixtures/input/expectation-corrections.json', 'utf8'));
const provider: Case[] = gemini.map((sample) => ({
  id: `gemini-original-${sample.id}`,
  input: sample.structured_text_payload,
  expected: {
    allMatching: true,
    intents: [{ kind: /START_CONFIG|^\s*\{/.test(sample.structured_text_payload) ? 'configuration_update' : 'irrelevant_text', outcome: /START_CONFIG|^\s*\{/.test(sample.structured_text_payload) ? 'REJECT' : 'IGNORE' }],
    stateChanges: {},
  },
}));
const cases = [...local, ...provider].map((entry) => ({ ...entry, expected: { ...entry.expected, intents: entry.expected.intents.map((value) => ({ fields: {}, ...(value as object) })) } }));
const report: { id: string; originalInput: string; expected: unknown; actual: { outcome: string; intents: unknown[]; recovered: string[]; stateChanges: Record<string, unknown> }; regressionStatus: string }[] = [];

function context(name?: string): RawPlan {
  const raw: RawPlan = JSON.parse(JSON.stringify(seed));
  if (name === 'imperial') {
    raw.units = { mass: 'lb', energy: 'kcal', length: 'in' };
    raw.profile = { weight: 220.46226218487757 };
  }
  if (name === 'chest' || name === 'multiple-chest') {
    for (const activity of raw.activities) {
      if (activity.session) {
        activity.session.exercises = activity.session.exercises.filter((entry: { movement: string }) => entry.movement !== 'chest_press');
        if (activity.session.short) activity.session.short.exercises = activity.session.short.exercises.filter((entry: { movement: string }) => entry.movement !== 'chest_press');
      }
    }
    raw.activities.push({ id: 'fixture-chest', kind: 'exercise', label: 'Fixture chest press', session: { exercises: [{ movement: 'chest_press', sets: 3, reps: 10, loadKg: 20 }] } });
    if (name === 'multiple-chest') raw.activities.push({ ...raw.activities.at(-1), id: 'fixture-chest-two' });
  }
  return raw;
}

afterAll(() => {
  mkdirSync('artifacts', { recursive: true });
  const counts = Object.fromEntries(['ACCEPT', 'IGNORE', 'CLARIFY', 'REJECT'].map((outcome) => [outcome, report.filter((entry) => entry.actual.outcome === outcome).length]));
  writeFileSync('artifacts/input-corpus-report.json', JSON.stringify({ total: cases.length, counts, regressions: report.filter((entry) => entry.regressionStatus === 'FAIL').map((entry) => entry.id), recoveredMalformed: report.filter((entry) => entry.actual.recovered.some((note) => /Matched|Removed|Converted|Added|Read/.test(note))).map((entry) => entry.id), cases: report }, null, 2) + '\n');
});

it('has unique stable corpus ids and documented expectation corrections', () => {
  expect(new Set(cases.map((entry) => entry.id)).size).toBe(cases.length);
  for (const [id, correction] of Object.entries(corrections) as [string, { reason: string }][]) {
    expect(cases.some((entry) => entry.id === id)).toBe(true);
    expect(correction.reason.length).toBeGreaterThan(20);
  }
});

it.each(cases)('$id', (entry) => {
  const previous = report.length;
  try { runCase(entry); }
  catch (error) {
    if (report.length === previous) report.push({ id: entry.id, originalInput: entry.input, expected: entry.expected, actual: { outcome: 'ERROR', intents: [{ message: String(error) }], recovered: [], stateChanges: {} }, regressionStatus: 'FAIL' });
    throw error;
  }
});

function runCase(entry: Case) {
  const expected = corrections[entry.id]?.expected ?? entry.expected;
  const raw = context(entry.context);
  const before = JSON.stringify(raw);
  const actual = interpretInput(entry.input, raw);
  const proposals = actual.intents.flatMap((result) => result.update ? [result.update] : []);
  let plan = raw;
  if (proposals.length) {
    const combined = combineUpdates(proposals);
    if (!combined) throw new Error('Corpus produced conflicting configuration updates');
    const applied = applyConfigUpdate(raw, combined);
    if (!applied.ok) throw new Error(applied.errors.join('\n'));
    plan = applied.nextRaw;
  }
  const foods = actual.intents.filter((result) => result.kind === 'meal_entry' && result.outcome === 'ACCEPT');
  const draft = newDraft({ id: entry.id, date: '2026-11-11', planId: null, activityId: null, replacedLabel: null, now: '2026-11-11T12:00:00+11:00' });
  const meal = foods.length ? finalizeDraft(applyReply(draft, foods.map((food) => food.source).join('; '), draft.updatedAt), draft.updatedAt) : null;
  const state = { plan, meal: meal?.ok ? meal.log : null, activityOrder: plan.activities.map((activity: { id: string }) => activity.id), exerciseLoadKg: plan.activities.find((activity: { id: string }) => activity.id === 'fixture-chest')?.session.exercises[0].loadKg };
  const stateChanges = Object.fromEntries(Object.keys(expected.stateChanges).map((path) => [path, path.split('.').reduce((value: any, key: string) => value?.[key], state)]));
  const priority = ['ACCEPT', 'CLARIFY', 'REJECT', 'IGNORE'];
  const outcome = priority.find((value) => actual.intents.some((result) => result.outcome === value))!;
  const result = { id: entry.id, originalInput: entry.input, expected, actual: { ...actual, outcome, stateChanges }, regressionStatus: 'PASS' };
  try {
    if (expected.allMatching) for (const result of actual.intents) expect(result).toMatchObject(expected.intents[0]);
    else expect(actual.intents).toMatchObject(expected.intents);
    if (expected.recovered) expect(actual.recovered.length).toBeGreaterThan(0);
    for (const [path, value] of Object.entries(expected.stateChanges)) {
      if (typeof value === 'number') expect(stateChanges[path]).toBeCloseTo(value, 8);
      else expect(stateChanges[path]).toEqual(value);
    }
    if (foods.length) expect(meal?.ok).toBe(true);
    expect(JSON.stringify(raw)).toBe(before);
  } catch (error) {
    result.regressionStatus = 'FAIL';
    throw error;
  } finally { report.push(result); }
}
