import { defaultContext, parseShared, quickErrors, quickMealLog, usableContext, type QuickContext } from '../quickLog';
import { QUICK_MEAL_PROMPT } from '../prompt';

/** #183: the shared AI text → Description + Energy (kJ) → one meal log. Reuses the #179 parser; nothing invented. */
const NOW = '2026-11-13T19:30:00+11:00';
const photo = { id: 'p1', uri: 'file:///app/meal-photos/p1.jpg', addedAt: NOW, width: 1, height: 1 };
const ctx: QuickContext = { id: 'meal-183', date: '2026-11-13', planId: 'plan', activityId: 'dinner', replacedLabel: 'Family dinner', photo, startedAt: '2026-11-13T19:00:00+11:00' };

describe('the prompt sent with the photo', () => {
  it('is Kevin’s wording, asking for an immediate shareable plain-text block with description, kJ and protein', () => {
    expect(QUICK_MEAL_PROMPT).toBe('Analyse this meal photo. In your FIRST reply output a native shareable text/writing block where supported. Include a short meal description, estimated total energy in kJ and protein g where estimable. No JSON, verbose breakdown, extra prompts or commentary. If I correct the meal, regenerate the complete block.');
  });
});

describe('parseShared: the AI’s block → the two fields', () => {
  it.each([
    ['Beef curry with lentil dhal and rice\nEstimated energy: ~2,650 kJ\nProtein: ~45 g', 'Beef curry with lentil dhal and rice', '2650', 45],
    ['Dinner: beef curry and dhal — ~2,650 kJ, 45 g protein', 'Beef curry and dhal', '2650', 45],
    ['**Meal:** Chicken salad wrap\n**Energy:** about 1,900 kJ\n**Protein:** 32 g', 'Chicken salad wrap', '1900', 32],
    ['Grilled salmon, greens and rice — approx 633 kcal, 38 g protein', 'Grilled salmon, greens and rice', '2648', 38],
  ])('%s', (text, description, kj, protein) => {
    const p = parseShared(text, ctx, NOW);
    expect(p.fields).toEqual({ description, energyKj: kj });
    expect(p.proteinG).toBe(protein);
    expect(p.problems).toEqual({});
  });

  it('protein is optional: a block without it still fills both required fields', () => {
    const p = parseShared('Dinner: beef curry and dhal, about 2,650 kJ', ctx, NOW);
    expect(p.fields).toEqual({ description: 'Beef curry and dhal', energyKj: '2650' });
    expect(p.proteinG).toBeNull();
    expect(p.problems).toEqual({});
  });

  it('a range or contradiction leaves Energy empty with the reason inline; nothing is invented', () => {
    const p = parseShared('Dinner: curry, 2,400–2,900 kJ, 45 g protein', ctx, NOW);
    expect(p.fields.energyKj).toBe('');
    expect(p.problems.energyKj).toMatch(/range/);
  });

  it('junk text: both fields empty with an inline reason, never a crash', () => {
    const p = parseShared('Thanks! Have a lovely evening.', ctx, NOW);
    expect(p.fields).toEqual({ description: '', energyKj: '' });
    expect(Object.keys(p.problems).sort()).toEqual(['description', 'energyKj']);
    expect(parseShared('', ctx, NOW).fields.energyKj).toBe('');
  });
});

describe('Save', () => {
  it('one entry with description, kJ and the parsed protein, the photo, the slot; fixed id', () => {
    const p = parseShared('Dinner: beef curry and dhal — ~2,650 kJ, 45 g protein', ctx, NOW);
    const r = quickMealLog(p, p.fields, ctx, NOW);
    expect(r.ok && r.log).toMatchObject({
      id: 'meal-183', date: '2026-11-13', planId: 'plan', activityId: 'dinner', replacedLabel: 'Family dinner', name: 'Beef curry and dhal',
      items: [{ name: 'Beef curry and dhal', energyKj: 2650, proteinG: 45, carbsG: null, fatG: null }], photos: [photo], source: 'photo-ai', schemaVersion: null, edited: false,
      assumptions: ['AI estimate as written: ~2,650 kJ, 45 g protein.'],
    });
    // The same inputs give the same record (save twice = one meal).
    const again = quickMealLog(p, p.fields, ctx, NOW);
    expect(again.ok && again.log.id).toBe('meal-183');
  });

  it('an inline edit is saved and marked edited; protein is kept', () => {
    const p = parseShared('Dinner: beef curry and dhal — ~2,650 kJ, 45 g protein', ctx, NOW);
    const r = quickMealLog(p, { description: 'Beef curry, dhal and rice', energyKj: '2,900' }, ctx, NOW);
    expect(r.ok && r.log).toMatchObject({ name: 'Beef curry, dhal and rice', edited: true, items: [{ energyKj: 2900, proteinG: 45 }] });
  });

  it('a slot that already has a replacement keeps its id (no double counting)', () => {
    const p = parseShared('Dinner: curry — 2,650 kJ', ctx, NOW);
    const existing = quickMealLog(p, p.fields, { ...ctx, id: 'older' }, NOW);
    const r = quickMealLog(p, { ...p.fields, energyKj: '2400' }, ctx, NOW, existing.ok ? existing.log : null);
    expect(r.ok && r.log).toMatchObject({ id: 'older', items: [{ energyKj: 2400 }] });
  });

  it('only description and a believable kJ are required', () => {
    expect(quickErrors({ description: '', energyKj: '' })).toEqual({ description: 'Add a short description.', energyKj: 'Enter the energy in kJ.' });
    expect(quickErrors({ description: 'Curry', energyKj: 'lots' }).energyKj).toBe('Energy must be a number of kJ.');
    expect(quickErrors({ description: 'Curry', energyKj: '0' }).energyKj).toMatch(/between 1 and 30,000 kJ/);
    expect(quickErrors({ description: 'Curry', energyKj: '2650' })).toEqual({});
    const p = parseShared('junk', ctx, NOW);
    expect(quickMealLog(p, p.fields, ctx, NOW)).toMatchObject({ ok: false, errors: { energyKj: 'Enter the energy in kJ.' } });
  });
});

describe('context: the slot the photo was taken for', () => {
  const now = new Date('2026-11-13T20:00:00+11:00');
  it('a recent photo for today or a past day is used; a stale, future or missing one falls back', () => {
    expect(usableContext(ctx, now, '2026-11-13')).toBe(ctx);
    expect(usableContext({ ...ctx, startedAt: '2026-11-12T08:00:00+11:00' }, now, '2026-11-13')).toBeNull();
    expect(usableContext({ ...ctx, date: '2026-11-14' }, now, '2026-11-13')).toBeNull();
    expect(usableContext(null, now, '2026-11-13')).toBeNull();
  });
  it('the safe default is an extra meal today: nothing scheduled is replaced', () => {
    expect(defaultContext('m', '2026-11-13', NOW)).toEqual({ id: 'm', date: '2026-11-13', planId: null, activityId: null, replacedLabel: null, photo: null, startedAt: NOW });
  });
});
