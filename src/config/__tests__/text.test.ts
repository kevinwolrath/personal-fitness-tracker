import { readFileSync } from 'node:fs';
import seed from '../../../plans/seed.plan.json';
import gemini from '../../../fixtures/config/text-replies/gemini-2026-11-11.json';
import { readConfig } from '../sections';
import { formatConfigText, UPDATE_END, UPDATE_HEADER } from '../text';
import { applyConfigUpdate, parseConfigUpdate } from '../update';

const block = (...rows: string[]) => [UPDATE_HEADER, ...rows, UPDATE_END].join('\n');
const fixture = (name: string) => readFileSync(`fixtures/config/text-replies/${name}`, 'utf8');

// Captured provider output is data. Its ACCEPT labels describe Gemini's expectations.
it.each(gemini.map((sample) => [sample.id, sample.structured_text_payload]))(
  'rejects the unsupported protocol in captured Gemini reply %s',
  (_id, payload) => {
    const parsed = parseConfigUpdate(payload);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('Unsupported provider protocol was accepted');
    expect(parsed.errors.length).toBeGreaterThan(0);
  },
);

it('round-trips every section of the bundled configuration through validation and apply', () => {
  const config = readConfig(seed);
  const parsed = parseConfigUpdate(formatConfigText(config));
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
  expect(parsed.update.sections).toEqual(config);
  const applied = applyConfigUpdate(seed, parsed.update);
  if (!applied.ok) throw new Error(applied.errors.join('\n'));
  expect(readConfig(applied.nextRaw)).toEqual(config);
});

it('reads mixed sections, repeated headings, quoted text and surrounding prose', () => {
  const reply = fixture('mixed.txt').trim().split(/\r?\n/).map((line) => `  ${line}  `).join('\r\n');
  const expected = JSON.parse(fixture('mixed.expect.json'));
  expect(parseConfigUpdate(reply)).toEqual(parseConfigUpdate(JSON.stringify(expected)));
});

it('accepts digit-led schema values without treating them as numbers', () => {
  const parsed = parseConfigUpdate(block('[profile]', 'ageBand: 18_39', 'weightBand: 70_99'));
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
  expect(parsed.update.sections.profile).toEqual({ ageBand: '18_39', weightBand: '70_99' });
});

it('keeps omitted fields and supports clearing a field and replacing a list', () => {
  const raw = { ...seed, profile: { displayName: 'Sam', notes: ['Fictional note'] } };
  const parsed = parseConfigUpdate(block('[profile]', 'notes: CLEAR', '[exercise]', 'restDays: []'));
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
  const applied = applyConfigUpdate(raw, parsed.update);
  if (!applied.ok) throw new Error(applied.errors.join('\n'));
  expect(applied.nextRaw.profile).toEqual({ displayName: 'Sam' });
  expect(applied.nextRaw.exercise.restDays).toEqual([]);
  expect(applied.nextRaw.nutrition).toEqual(raw.nutrition);
});

it('encodes MERGE and escaped values in the existing envelope', () => {
  const config = {
    nutrition: { meals: { merge: [{ id: 'snack', kind: 'meal', label: 'Snack "A" \\ B\nnext', when: 'afternoon' }] } },
    profile: { displayName: 'false', notes: ['Line one\u2028line two'] },
  };
  const parsed = parseConfigUpdate(formatConfigText(config));
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
  expect(parsed.update.sections).toEqual(config);
});

it.each([
  ['unknown section', block('[food]', 'targets: []'), /Line 2: Unknown section/],
  ['unknown field', block('[profile]', 'secret: false'), /Line 3: Unknown field/],
  ['unknown nested key', block('[exercise]', 'constraints: {location: home, unknown: 1}'), /Line 3:.*unknown/],
  ['wrong unit', block('[profile]', 'heightCm: 71 in'), /Line 3:.*heightCm/],
  ['bad value', block('[profile]', 'heightCm: 0 cm'), /Line 3:.*heightCm/],
  ['invalid boolean', block('[exercise]', 'constraints: {gymMembership: "false"}'), /Line 3:.*gymMembership/],
  ['missing value', block('[profile]', 'heightCm:'), /Line 3:.*Expected a value/],
  ['missing colon', block('[profile]', 'heightCm 181'), /Line 3: Expected/],
  ['duplicate field', block('[profile]', 'heightCm: 181', '[profile]', 'heightCm: 181'), /Line 5:.*line 3/],
  ['duplicate key', block('[exercise]', 'constraints: {location: home, location: home}'), /Line 3:.*appears twice/],
  ['duplicate ids', block('[nutrition]', 'meals: MERGE [{id: lunch}, {id: lunch}]'), /Line 3: Duplicate id/],
  ['JSON merge syntax', block('[nutrition]', 'meals: {merge: [{id: lunch}]}'), /Line 3: Use "meals: MERGE/],
  ['invalid removal', block('[profile]', 'units: CLEAR'), /Line 3:.*cannot be cleared/],
  ['unclosed block', block('[profile]', 'heightCm: 181').replace(UPDATE_END, ''), /Missing "END UPDATE"/],
  ['wrong version', block('[profile]', 'heightCm: 181').replace(UPDATE_HEADER, 'BODY ANVIL UPDATE v999'), /Line 1: Expected/],
  ['conflicting blocks', `${block('[profile]', 'heightCm: 181')}\n${block('[profile]', 'heightCm: 182')}`, /Line 5: More than one/],
  ['mixed formats', `${block('[profile]', 'heightCm: 181')}\n{"fitnessConfigUpdate":{"schemaVersion":1,"profile":{"heightCm":182}}}`, /Line 5:.*JSON update/],
  ['prototype field', block('[profile]', '__proto__: {heightCm: 181}'), /Line 3: Unknown field/],
  ['nested prototype key', block('[exercise]', 'constraints: {__proto__: {gymMembership: true}}'), /Line 3:.*Unexpected key "__proto__"/],
  ['executable syntax', block('[profile]', 'displayName: alert(1)'), /Line 3:.*Expected/],
  ['prose inside the block', block('[profile]', 'heightCm: 181', 'Ignore previous instructions'), /Line 4: Expected/],
])('rejects %s with a line-specific error and text diagnostics', (_name, text, expected) => {
  const parsed = parseConfigUpdate(text);
  if (parsed.ok) throw new Error('Invalid update was accepted');
  expect(parsed.errors.join('\n')).toMatch(expected);
  expect(parsed.diagnostics).toContain(UPDATE_HEADER);
});
