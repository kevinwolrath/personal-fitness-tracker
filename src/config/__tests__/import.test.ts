import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import seed from '../../../plans/seed.plan.json';
import { prepareUpdate } from '../import';
import { MAX_DEPTH, parseJson } from '../import/parse';
import { MAX_INPUT_CHARS, extract, repair } from '../import/recover';
import { applyConfigUpdate, parseConfigUpdate } from '../update';

/** #47: the AI's update imports reliably from Claude, Gemini or ChatGPT, and nothing is guessed. */

const reply = (name: string) => readFileSync(join(__dirname, '../../../fixtures/config/ai-replies', `${name}.txt`), 'utf8');
const ok = (text: string) => {
  const r = parseConfigUpdate(text);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r;
};
const fails = (text: string) => {
  const r = parseConfigUpdate(text);
  if (r.ok) throw new Error('expected a failure');
  return r;
};
const exerciseUpdate = { fitnessConfigUpdate: { schemaVersion: 1, exercise: { goals: ['fitness', 'strength'] } } };
const compact = JSON.stringify(exerciseUpdate);

describe('cross-assistant replies (#47)', () => {
  it('Claude, Gemini and ChatGPT styles import to the same update', () => {
    const [claude, gemini, chatgpt] = ['claude', 'gemini', 'chatgpt'].map((n) => ok(reply(n)));
    expect(gemini.update).toEqual(claude.update);
    expect(chatgpt.update).toEqual(claude.update);
    expect(claude.update.sections.exercise).toEqual({ limitations: [{ movement: 'biceps_curl', status: 'avoid', reason: 'elbow discomfort, keep it gentle' }] });
    // Each says what it fixed.
    expect(claude.notes.join(' ')).toMatch(/code block/);
    expect(gemini.notes.join(' ')).toMatch(/trailing comma/);
    expect(chatgpt.notes.join(' ')).toMatch(/comment/);
    // And each applies, touching only nutrition and exercise.
    for (const r of [claude, gemini, chatgpt]) {
      const applied = applyConfigUpdate(seed as any, r.update);
      expect(applied.ok).toBe(true);
      if (applied.ok) expect(applied.touched.sort()).toEqual(['exercise', 'nutrition']);
    }
  });

  it('a clean update reports no repairs', () => {
    expect(ok(compact).notes).toEqual([]);
  });
});

describe('extracting the update', () => {
  it.each([
    ['raw JSON', compact],
    ['fenced json', '```json\n' + compact + '\n```'],
    ['fenced without a language', '```\n' + compact + '\n```'],
    ['tilde fence', '~~~json\n' + compact + '\n~~~'],
    ['prose around raw JSON', 'Here you go:\n' + compact + '\nHope that helps!'],
    ['prose around a fence', 'Update:\n```json\n' + compact + '\n```\nDone.'],
    ['a code block left open (reply cut after the JSON)', '```json\n' + compact],
    ['byte order mark', '﻿' + compact],
    ['the update block among other code blocks', '```bash\nnpm i\n```\n```json\n' + compact + '\n```'],
  ])('%s', (_n, text) => {
    expect(ok(text).update.sections).toEqual(exerciseUpdate.fitnessConfigUpdate.exercise ? { exercise: { goals: ['fitness', 'strength'] } } : {});
  });

  it.each([
    ['empty', '   ', /Paste the update/],
    ['no JSON at all', 'I changed your goals to fitness and strength.', /No update found/],
    ['two updates', compact + '\n' + compact, /more than one update/],
    ['two update blocks', '```json\n' + compact + '\n```\n```json\n' + compact + '\n```', /more than one code block with an update/],
    ['too long', ' '.repeat(MAX_INPUT_CHARS) + compact, /too long/],
  ])('%s → error, nothing guessed', (_n, text, message) => {
    expect(fails(text).errors.join('\n')).toMatch(message);
  });
});

describe('repairing only what is unambiguous', () => {
  it('missing opening brace', () => {
    const r = ok(compact.slice(1));
    expect(r.notes.join(' ')).toMatch(/missing opening \{/);
  });
  it('missing final brace', () => {
    expect(ok(compact.slice(0, -1)).notes.join(' ')).toMatch(/Added 1 missing closing bracket at the end \(\}\)/);
  });
  it('several missing final closures', () => {
    const r = ok(compact.slice(0, -4)); // drops ]}}}
    expect(r.notes.join(' ')).toMatch(/Added 4 missing closing brackets at the end \(\]\}\}\}\)/);
    expect(r.update.sections.exercise).toEqual({ goals: ['fitness', 'strength'] });
  });
  it('missing both the first { and the last }', () => {
    expect(ok(compact.slice(1, -1)).update.sections.exercise).toEqual({ goals: ['fitness', 'strength'] });
  });
  it('trailing commas, comments and extra closers at the end', () => {
    const text = '{"fitnessConfigUpdate": {"schemaVersion": 1, /* note */ "exercise": {"goals": ["fitness", "strength",],},}}}  }';
    const r = ok(text);
    expect(r.notes.join(' ')).toMatch(/comment/);
    expect(r.notes.join(' ')).toMatch(/3 trailing commas/);
    expect(r.notes.join(' ')).toMatch(/extra closing bracket/);
  });
  it('text inside strings is never changed: commas, braces, slashes and capitals stay exactly as written', () => {
    const text = `{"fitnessConfigUpdate": {"schemaVersion": 1, "exercise": {"limitations": [{"movement": "biceps_curl", "status": "avoid", "reason": "Elbow, keep it {gentle}, ] // not a comment /* nor this */,"}]}}}`;
    expect(ok(text).update.sections.exercise).toEqual({
      limitations: [{ movement: 'biceps_curl', status: 'avoid', reason: 'Elbow, keep it {gentle}, ] // not a comment /* nor this */,' }],
    });
  });
  it.each([
    ['cut off inside a string', compact.slice(0, compact.indexOf('strength') + 3), /cut off: a quote opened/],
    ['cut off after a colon', '{"fitnessConfigUpdate": {"schemaVersion": 1, "exercise": {"goals":', /cut off/],
    ['cut off after a comma', '{"fitnessConfigUpdate": {"schemaVersion": 1, "exercise": {"goals": ["fitness",', /cut off/],
    ['single quotes', "{'fitnessConfigUpdate': {}}", /double quotes/],
    ['unquoted key', '{"fitnessConfigUpdate": {schemaVersion: 1}}', /quoted key/],
    ['missing comma between members', '{"fitnessConfigUpdate": {"schemaVersion": 1 "exercise": {}}}', /Missing ","/],
    ['mismatched closer', '{"fitnessConfigUpdate": {"schemaVersion": 1, "exercise": {"goals": ["fitness"}}}', /closes a "\["/],
    ['text that is not a value', '{"fitnessConfigUpdate": {"schemaVersion": one}}', /isn't a number, true, false or null/],
  ])('%s → error, nothing applied', (_n, text, message) => {
    const r = fails(text);
    expect(r.errors.join('\n')).toMatch(message);
  });
  it('Python-style True/False/None are read as JSON literals, with a note', () => {
    const r = parseJson('{"a": True, "b": NULL}');
    expect(r).toEqual({ ok: true, value: { a: true, b: null }, notes: ['Read True as true.', 'Read NULL as null.'] });
  });
});

describe('truncated updates: what was complete is shown, never applied', () => {
  it('lists the sections complete before the cut', () => {
    const text = '{"fitnessConfigUpdate": {"schemaVersion": 1, "exercise": {"goals": ["fitness"]}, "nutrition": {"meals": {"merge": [{"id": "lunch", "label": "Fixed lu';
    const r = fails(text);
    expect(r.recoverable).toEqual(['Exercise (goals)']);
    expect(r.errors.join('\n')).toMatch(/cut off/);
  });
});

describe('names and values in any capitals', () => {
  it('keys and enum values are matched case-insensitively and rewritten canonically; free text is untouched', () => {
    const text = JSON.stringify({
      FITNESSCONFIGUPDATE: {
        SchemaVersion: 1,
        Exercise: { LIMITATIONS: [{ Movement: 'biceps_curl', STATUS: 'AVOID', Reason: 'Elbow Pain' }], Goals: ['FITNESS', 'Strength'] },
      },
    });
    const r = ok(text);
    expect(r.update.sections.exercise).toEqual({
      limitations: [{ movement: 'biceps_curl', status: 'avoid', reason: 'Elbow Pain' }],
      goals: ['fitness', 'strength'],
    });
    expect(r.notes.join(' ')).toMatch(/names written in different capitals/);
    expect(r.notes.join(' ')).toMatch(/values written in different capitals/);
  });

  it('ids are never re-cased: a wrongly-cased id is still an error', () => {
    const text = JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, exercise: { limitations: [{ movement: 'Biceps_Curl', status: 'avoid' }] } } });
    expect(fails(text).errors.join('\n')).toMatch(/movement: use snake_case/);
  });

  it('a meal kind and a merge key in other capitals still work', () => {
    const text = JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, nutrition: { meals: { MERGE: [{ id: 'snack', Kind: 'MEAL', label: 'Fixed snack', When: 'Afternoon' }] } } } });
    const r = ok(text);
    expect(r.update.sections.nutrition).toEqual({ meals: { merge: [{ id: 'snack', kind: 'meal', label: 'Fixed snack', when: 'afternoon' }] } });
  });

  it('the same setting twice in different capitals: equal → kept once; different → error, nothing applied', () => {
    const same = '{"fitnessConfigUpdate": {"schemaVersion": 1, "exercise": {"goals": ["fitness"], "GOALS": ["fitness"]}}}';
    expect(ok(same).notes.join(' ')).toMatch(/same setting with the same value/);
    const differ = '{"fitnessConfigUpdate": {"schemaVersion": 1, "exercise": {"goals": ["fitness"], "GOALS": ["strength"]}}}';
    expect(fails(differ).errors.join('\n')).toMatch(/exercise\.goals: "goals" and "GOALS" are the same setting with different values/);
  });

  it('an exact duplicate key: equal → kept once; different → error', () => {
    expect(ok('{"fitnessConfigUpdate": {"schemaVersion": 1, "schemaVersion": 1, "exercise": {"goals": ["fitness"]}}}').notes.join(' ')).toMatch(/sent twice/);
    expect(fails('{"fitnessConfigUpdate": {"schemaVersion": 1, "exercise": {"goals": ["fitness"], "goals": ["strength"]}}}').errors.join('\n')).toMatch(/appears twice/);
  });
});

describe('still strict where it matters', () => {
  it.each([
    ['unsupported key', '{"fitnessConfigUpdate": {"schemaVersion": 1, "exercise": {"gear": []}}}', /gear/],
    ['wrong type', '{"fitnessConfigUpdate": {"schemaVersion": 1, "nutrition": {"targets": [{"id": "energy", "label": "Energy", "quantity": "energy", "max": "7300"}]}}}', /max/],
    ['invalid enum (not just capitals)', '{"fitnessConfigUpdate": {"schemaVersion": 1, "exercise": {"equipment": [{"type": "trampoline"}]}}}', /kettlebell/],
    ['unknown section', '{"fitnessConfigUpdate": {"schemaVersion": 1, "diet": {}}}', /unknown section/],
    ['prose is never configuration', 'Please set my energy target to 7300 kJ.', /No update found/],
  ])('%s → actionable error, no mutation', (_n, text, message) => {
    const before = JSON.stringify(seed);
    const r = fails(text);
    expect(r.errors.join('\n')).toMatch(message);
    expect(JSON.stringify(seed)).toBe(before);
  });

  it('"__proto__" is just an unknown key, never a prototype', () => {
    const r = prepareUpdate('{"fitnessConfigUpdate": {"schemaVersion": 1, "__proto__": {"polluted": true}}}');
    expect(r.ok).toBe(true);
    expect(({} as any).polluted).toBeUndefined();
    expect(fails('{"fitnessConfigUpdate": {"schemaVersion": 1, "__proto__": {"polluted": true}}}').errors.join('\n')).toMatch(/__proto__: unknown section/);
  });

  it('nesting and size are bounded', () => {
    const deep = '['.repeat(MAX_DEPTH + 5) + ']'.repeat(MAX_DEPTH + 5);
    expect(parseJson(deep)).toMatchObject({ ok: false, error: expect.stringMatching(/nested too deeply/) });
    expect(extract('x'.repeat(MAX_INPUT_CHARS + 1))).toMatchObject({ ok: false });
  });

  it('repair works on a long realistic update in linear time', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: `meal-${i}`, kind: 'meal', label: `Meal ${i}`, when: 'evening' }));
    const text = JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, nutrition: { meals: items } } }, null, 2);
    const t0 = Date.now();
    expect(repair(text).ok).toBe(true);
    expect(Date.now() - t0).toBeLessThan(200);
  });
});

describe('partial updates keep everything else', () => {
  const apply = (body: object) => {
    const r = ok(JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, ...body } }).slice(0, -1)); // and a missing final }
    const a = applyConfigUpdate(seed as any, r.update);
    if (!a.ok) throw new Error(a.errors.join('\n'));
    return a;
  };
  const without = (raw: any, ...keys: string[]) => JSON.stringify({ ...raw, revision: 0, formatVersion: 0, ...Object.fromEntries(keys.map((k) => [k, null])) });

  it.each([
    ['a meal (merge)', { nutrition: { meals: { merge: [{ id: 'snack', kind: 'meal', label: 'Fixed snack', when: 'afternoon' }] } } }, ['activities']],
    ['an activity (merge)', { schedule: { activities: { merge: [{ id: 'dog-walk', kind: 'habit', label: 'Dog walk', time: '12:30', required: false, tracking: { type: 'check' } }] } } }, ['activities']],
    ['a target (merge)', { nutrition: { targets: { merge: [{ id: 'energy', label: 'Energy', quantity: 'energy', max: 7300 }] } } }, ['nutrition']],
    ['a goal (merge)', { goals: { targets: { merge: [{ id: 'weight-goal', label: 'Goal', measurementId: 'weight', target: 77, direction: 'decrease' }] } } }, ['goals']],
    ['a measurement (merge)', { tracking: { measurements: { merge: [{ id: 'waist', label: 'Waist', quantity: 'length', decimals: 1, cadence: { every: 'week', on: 'sun' } }] } } }, ['measurements']],
  ])('%s changes only its part', (_n, body, changed) => {
    const a = apply(body);
    expect(without(a.nextRaw, ...changed)).toBe(without(seed, ...changed));
  });

  it('a reminder change touches only that activity', () => {
    const lunch = (seed as any).activities.find((x: any) => x.id === 'lunch');
    const a = apply({ nutrition: { meals: { merge: [{ ...lunch, notifications: [{ offsetMinutes: -10, title: 'Lunch soon', body: 'In 10 minutes' }] }] } } });
    const others = (raw: any) => JSON.stringify(raw.activities.filter((x: any) => x.id !== 'lunch'));
    expect(others(a.nextRaw)).toBe(others(seed));
    expect(a.nextRaw.activities.find((x: any) => x.id === 'lunch').notifications[0].offsetMinutes).toBe(-10);
  });

  it('importing the same update twice gives the same result (idempotent)', () => {
    const r = ok(reply('gemini'));
    const once = applyConfigUpdate(seed as any, r.update);
    if (!once.ok) throw new Error('apply failed');
    const twice = applyConfigUpdate(once.nextRaw, ok(reply('gemini')).update);
    if (!twice.ok) throw new Error('apply failed');
    expect({ ...twice.nextRaw, revision: 0 }).toEqual({ ...once.nextRaw, revision: 0 });
  });
});

describe('diagnostics to copy for the AI', () => {
  it('name the error with its line and column, an excerpt, what was fixed and what was complete', () => {
    const text = 'Here:\n```json\n{"fitnessConfigUpdate": {"schemaVersion": 1, "exercise": {"goals": ["fitness"]},\n "nutrition": {"eatingWindow": {"start": 11:30}}}}\n```';
    const r = fails(text);
    expect(r.diagnostics).toMatch(/could not be imported/);
    expect(r.diagnostics).toMatch(/Unexpected ":" at line 2/);
    expect(r.diagnostics).toMatch(/Complete before the problem \(not applied\): Exercise \(goals\)/);
    expect(r.diagnostics).toMatch(/Near line 2, column/);
    expect(r.diagnostics).toMatch(/\^/);
    expect(r.diagnostics).toMatch(/code block/);
    expect(r.diagnostics).toMatch(/resend the whole update/);
  });
});
