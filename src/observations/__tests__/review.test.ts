import { buildObservations, formatReviewValue, parseReviewValue, type ReviewedCandidate } from '../review';
import type { ImportSession } from '../types';

const session: ImportSession = {
  id: 'imp',
  createdAt: '2026-11-01T16:45:00+11:00',
  extractor: 'anthropic:claude-opus-5-5',
  assets: [
    { id: 'fit', fileName: 'fitbit.png', mimeType: 'image/png', capturedAt: '2026-11-01T16:39:00+11:00', storedUri: null, sourceApp: 'fitbit' },
    { id: 'scale', fileName: 'scale.png', mimeType: 'image/png', capturedAt: null, storedUri: null, sourceApp: 'renpho' },
  ],
};
const c = (over: Partial<ReviewedCandidate>): ReviewedCandidate => ({
  key: 'k', assetId: 'fit', metric: 'steps', label: 'Steps', value: 13765, unit: 'count', kind: 'observed',
  evidence: '13,765', confidence: 0.98, date: '2026-11-01', include: true, ...over,
});
let n = 0;
const id = () => `id${++n}`;
beforeEach(() => (n = 0));

it('saves only included values, with provenance per screenshot and source app', () => {
  const r = buildObservations(session, [
    c({ key: '1' }),
    c({ key: '2', assetId: 'scale', metric: 'weight', label: 'Weight', value: 97.25, unit: 'kg', evidence: '97.25 kg' }),
    c({ key: '3', assetId: 'scale', metric: 'weight', value: 99.8, unit: 'kg', kind: 'inferred', include: false }),
    c({ key: '4', include: false }),
  ], 'now', id);
  if (!r.ok) throw new Error('expected ok');
  expect(r.observations).toEqual([
    {
      id: 'id1', date: '2026-11-01', metric: 'steps', value: 13765, unit: 'count', kind: 'observed', label: null, note: null, recordedAt: 'now',
      source: { type: 'screenshot', app: 'fitbit', capturedAt: '2026-11-01T16:39:00+11:00', confidence: 0.98, importId: 'imp', assetId: 'fit', evidence: '13,765', edited: false },
    },
    {
      id: 'id2', date: '2026-11-01', metric: 'weight', value: 97.25, unit: 'kg', kind: 'observed', label: null, note: null, recordedAt: 'now',
      source: { type: 'screenshot', app: 'renpho', capturedAt: null, confidence: 0.98, importId: 'imp', assetId: 'scale', evidence: '97.25 kg', edited: false },
    },
  ]);
});

it('an inferred value the user explicitly includes is stored as inferred, never observed', () => {
  const r = buildObservations(session, [c({ metric: 'weight', value: 99.8, unit: 'kg', kind: 'inferred', include: true })], 'now', id);
  expect(r.ok && r.observations[0].kind).toBe('inferred');
});

it('records user edits and flags them in provenance', () => {
  const r = buildObservations(session, [c({ editedText: '13800' }), c({ key: 'same', editedText: '13765' })], 'now', id);
  if (!r.ok) throw new Error('expected ok');
  expect(r.observations.map((o) => [o.value, o.source.edited])).toEqual([[13800, true], [13765, false]]);
});

it('keeps the workout type as the label', () => {
  const r = buildObservations(session, [c({ metric: 'exercise_session', label: 'Weights', value: 35, unit: 'min' })], 'now', id);
  expect(r.ok && r.observations[0].label).toBe('Weights');
});

it('rejects invalid edits without saving anything', () => {
  const r = buildObservations(session, [c({ key: 'a', editedText: 'abc' }), c({ key: 'b', editedText: '-3' }), c({ key: 'ok' })], 'now', id);
  expect(r).toEqual({ ok: false, errors: { a: 'Enter a number', b: 'Must not be negative' } });
});

describe('review values are shown like the Daily Log and stay editable (#21)', () => {
  it.each([
    ['count', 13765, '13,765'],
    ['min', 465, '7h 45m'],
    ['min', 45, '45m'],
    ['kg', 97.25, '97.25'],
    ['kg', -2.55, '-2.55'],
    ['score', 84, '84'],
  ])('%s %p → %s and back', (unit, value, text) => {
    expect(formatReviewValue(unit, value)).toBe(text);
    expect(parseReviewValue(unit, text)).toBe(value);
  });

  it.each([
    ['min', '7h45', 465],
    ['min', '7:45', 465],
    ['min', '7 h', 420],
    ['min', '465', 465],
    ['count', '13765', 13765],
    ['kg', '97,25', 97.25],
  ])('accepts %s "%s"', (unit, text, value) => expect(parseReviewValue(unit, text)).toBe(value));

  it.each([['min', 'abc'], ['min', ''], ['kg', 'x']])('rejects %s "%s"', (unit, text) => expect(parseReviewValue(unit, text)).toBeNull());

  it('a comma that is not a thousands group is a decimal comma', () => expect(parseReviewValue('kg', '13,76')).toBe(13.76));
});
