import { extractReply } from '../parse';
import { mealPrompt } from '../prompt';
import { MEAL_REPLY_SCHEMA_VERSION } from '../contract';

const reply = { schemaVersion: 1, mealName: 'Bowl', items: [{ name: 'Rice', quantity: 180, unit: 'g', energyKj: 980, proteinG: 5, carbsG: 52, fatG: 1 }] };
const json = JSON.stringify(reply, null, 2);

describe('extractReply (#97): find exactly one JSON object, never run anything', () => {
  it('reads a ```json fenced block with prose around it', () => {
    const r = extractReply(`Here's my estimate:\n\`\`\`json\n${json}\n\`\`\`\nLet me know if you want changes.`);
    expect(r).toEqual({ ok: true, value: reply, repaired: [] });
  });

  it('reads a plain ``` fence and a bare object in prose', () => {
    expect(extractReply(`\`\`\`\n${json}\n\`\`\``)).toMatchObject({ ok: true, value: reply });
    expect(extractReply(`Sure! ${JSON.stringify(reply)} Hope that helps.`)).toMatchObject({ ok: true, value: reply });
    expect(extractReply(json)).toMatchObject({ ok: true, value: reply });
  });

  it('ignores braces inside strings and non-JSON fences', () => {
    const tricky = { ...reply, assumptions: ['Sauce {not visible}', 'He said "hi" }'] };
    expect(extractReply(`\`\`\`python\nprint(1)\n\`\`\`\nAnd: ${JSON.stringify(tricky)}`)).toMatchObject({ ok: true, value: tricky });
  });

  it('reports a cut-off reply as truncated, not invalid', () => {
    expect(extractReply('Here:\n```json\n{ "schemaVersion": 1, "mealName": "Chicken bur')).toMatchObject({ ok: false, code: 'truncated' });
    expect(extractReply('Here: { "schemaVersion": 1, "items": [ { "name": "Rice"')).toMatchObject({ ok: false, code: 'truncated' });
    expect(extractReply('```json\n{"a": [1, 2\n```')).toMatchObject({ ok: false, code: 'truncated' });
  });

  it('reports invalid JSON with an actionable message', () => {
    const r = extractReply('```json\n{ schemaVersion: 1, items: [] }\n```');
    expect(r).toMatchObject({ ok: false, code: 'invalid-json' });
    if (!r.ok) expect(r.message).toMatch(/Ask the AI/);
  });

  it('repairs curly quotes and trailing commas from chat apps, and says so', () => {
    const r = extractReply('{“schemaVersion”: 1, “items”: [{“name”: “Rice”,},],}');
    expect(r).toEqual({ ok: true, value: { schemaVersion: 1, items: [{ name: 'Rice' }] }, repaired: ['curly quotes', 'trailing commas'] });
  });

  it('refuses two different objects, but accepts the same object repeated', () => {
    const other = { ...reply, mealName: 'Other' };
    expect(extractReply(`\`\`\`json\n${json}\n\`\`\`\n\`\`\`json\n${JSON.stringify(other)}\n\`\`\``)).toMatchObject({ ok: false, code: 'multiple' });
    expect(extractReply(`${JSON.stringify(reply)} and again ${JSON.stringify(reply)}`)).toMatchObject({ ok: true, value: reply });
    expect(extractReply(JSON.stringify([reply, other]))).toMatchObject({ ok: false, code: 'multiple' });
    expect(extractReply(JSON.stringify([reply]))).toMatchObject({ ok: true, value: reply });
  });

  it('empty, prose-only, huge and non-object pastes', () => {
    expect(extractReply('   ')).toMatchObject({ ok: false, code: 'empty' });
    expect(extractReply('I can’t see any food in this photo.')).toMatchObject({ ok: false, code: 'no-json' });
    expect(extractReply(`{"a":"${'x'.repeat(100_001)}"}`)).toMatchObject({ ok: false, code: 'too-long' });
    expect(extractReply('```json\n[1, 2]\n```')).toMatchObject({ ok: false, code: 'multiple' });
    expect(extractReply('```json\n"just a string"\n```')).toMatchObject({ ok: false, code: 'no-json' });
  });

  it('never evaluates pasted code', () => {
    const g = globalThis as { __pwned?: boolean };
    const r = extractReply('```json\n(function(){ globalThis.__pwned = true; return {} })()\n```\n{"x": (globalThis.__pwned = true)}');
    expect(r.ok).toBe(false);
    expect(g.__pwned).toBeUndefined();
  });
});

describe('mealPrompt (#97)', () => {
  it('asks for kJ, macros, nulls instead of guesses and one fenced JSON object in the current version', () => {
    const p = mealPrompt();
    expect(p).toMatch(/kilojoules \(kJ, not kcal\)/);
    expect(p).toMatch(/protein, carbohydrate and fat/);
    expect(p).toMatch(/use null/);
    expect(p).toMatch(/exactly one JSON object/);
    expect(p).toContain(`"schemaVersion": ${MEAL_REPLY_SCHEMA_VERSION}`);
    expect(p).toMatch(/assumptions/);
    expect(p).toMatch(/uncertainties/);
    expect(mealPrompt(3)).toMatch(/the 3 attached photos of one meal/);
  });

  it('its own example parses and validates (the prompt and the parser agree)', () => {
    const example = mealPrompt().split('```json\n')[1].split('\n```')[0].replace('"low | medium | high"', '"medium"');
    expect(extractReply(`\`\`\`json\n${example}\n\`\`\``)).toMatchObject({ ok: true });
  });
});
