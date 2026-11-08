import { validateReply } from '../validate';

const item = (over: Record<string, unknown> = {}) => ({ name: 'Rice', quantity: 180, unit: 'g', energyKj: 980, proteinG: 5, carbsG: 52, fatG: 1, ...over });
const base = (over: Record<string, unknown> = {}) => ({ schemaVersion: 1, mealName: 'Bowl', items: [item()], confidence: 'medium', assumptions: ['No sauce'], ...over });

describe('validateReply (#97): contract checks and normalisation', () => {
  it('accepts a valid reply as is', () => {
    const r = validateReply(base({ totals: { energyKj: 980, proteinG: 5, carbsG: 52, fatG: 1 }, uncertainties: ['Rice type'] }));
    expect(r).toEqual({
      ok: true,
      issues: [],
      reply: {
        schemaVersion: 1,
        mealName: 'Bowl',
        items: [{ name: 'Rice', quantity: 180, unit: 'g', energyKj: 980, proteinG: 5, carbsG: 52, fatG: 1 }],
        aiTotals: { energyKj: 980, proteinG: 5, carbsG: 52, fatG: 1 },
        confidence: 'medium',
        assumptions: ['No sauce'],
        uncertainties: ['Rice type'],
      },
    });
  });

  it('refuses missing, unknown and newer versions with actionable messages', () => {
    expect(validateReply({ items: [item()] })).toMatchObject({ ok: false, message: expect.stringMatching(/no schemaVersion/) });
    expect(validateReply(base({ schemaVersion: 2 }))).toMatchObject({ ok: false, message: expect.stringMatching(/newer format \(schemaVersion 2\)/) });
    expect(validateReply(base({ schemaVersion: '1' }))).toMatchObject({ ok: false });
    expect(validateReply(base({ schemaVersion: 0 }))).toMatchObject({ ok: false });
  });

  it('refuses a reply with no foods, or too many', () => {
    expect(validateReply(base({ items: undefined }))).toMatchObject({ ok: false, message: expect.stringMatching(/no list of foods/) });
    expect(validateReply(base({ items: [] }))).toMatchObject({ ok: false, message: expect.stringMatching(/no foods/) });
    expect(validateReply(base({ items: Array.from({ length: 31 }, () => item()) }))).toMatchObject({ ok: false });
    expect(validateReply(base({ items: ['rice'] }))).toMatchObject({ ok: false });
  });

  it('keeps nulls as unknown: nothing is invented', () => {
    const r = validateReply(base({ items: [item({ quantity: null, unit: null, energyKj: null, proteinG: null, carbsG: null, fatG: null })] }));
    expect(r.ok && r.reply.items[0]).toEqual({ name: 'Rice', quantity: null, unit: null, energyKj: null, proteinG: null, carbsG: null, fatG: null });
    expect(r.ok && r.issues).toEqual([]);
  });

  it('missing fields read as unknown; a missing name is flagged', () => {
    const r = validateReply(base({ items: [{ energyKj: 500 }] }));
    expect(r.ok && r.reply.items[0]).toEqual({ name: '', quantity: null, unit: null, energyKj: 500, proteinG: null, carbsG: null, fatG: null });
    expect(r.ok && r.issues.map((i) => i.path)).toEqual(['items[0].name']);
  });

  it('negative, non-numeric and non-finite values are left empty and listed, never clipped', () => {
    const r = validateReply(base({ items: [item({ proteinG: -5, carbsG: 'lots', fatG: Number.POSITIVE_INFINITY })] }));
    expect(r.ok && r.reply.items[0]).toMatchObject({ proteinG: null, carbsG: null, fatG: null, energyKj: 980 });
    const messages = r.ok ? r.issues.map((i) => i.message) : [];
    expect(messages[0]).toMatch(/Rice: protein can’t be negative/);
    expect(messages[1]).toMatch(/Rice: carbs “lots” isn’t a number/);
    expect(messages[2]).toMatch(/Rice: fat isn’t a finite number/);
  });

  it('outliers above sensible limits are left empty for the user to check', () => {
    const r = validateReply(base({ items: [item({ energyKj: 90_000, proteinG: 450 })], totals: { energyKj: 50_000 } }));
    expect(r.ok && r.reply.items[0]).toMatchObject({ energyKj: null, proteinG: null });
    expect(r.ok && r.reply.aiTotals).toBeNull();
    expect(r.ok && r.issues.map((i) => i.path)).toEqual(['items[0].energyKj', 'items[0].proteinG', 'totals.energyKj']);
  });

  it('normalises mixed units exactly: kg → g, l → ml, oz → g, kcal → kJ, and keeps unknown units as written', () => {
    const r = validateReply(
      base({
        items: [
          item({ quantity: 0.18, unit: 'kg' }),
          item({ name: 'Milk', quantity: 0.25, unit: 'L' }),
          item({ name: 'Steak', quantity: 8, unit: 'oz', energyKj: undefined, energyKcal: 500 }),
          item({ name: 'Chips', quantity: 1, unit: 'packet' }),
          item({ name: 'Egg', quantity: 2, unit: 'pieces' }),
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reply.items.map((i) => [i.quantity, i.unit])).toEqual([[180, 'g'], [250, 'ml'], [227, 'g'], [1, 'packet'], [2, 'piece']]);
    expect(r.reply.items[2].energyKj).toBe(2092);
    expect(r.issues.map((i) => i.message)).toEqual([
      'Rice: 0.18 kg converted to 180 g.',
      'Milk: 0.25 l converted to 250 ml.',
      'Steak: 8 oz converted to 227 g.',
      'Steak: energy was given in kcal and converted to 2,092 kJ.',
      'Chips: unit “packet” kept as written.',
    ]);
  });

  it('accepts numeric strings and confidence as a 0–1 number', () => {
    const r = validateReply(base({ items: [item({ energyKj: '1,200', proteinG: '12 g' })], confidence: 0.55 }));
    expect(r.ok && r.reply.items[0]).toMatchObject({ energyKj: 1200, proteinG: 12 });
    expect(r.ok && r.reply.confidence).toBe('medium');
    expect(validateReply(base({ confidence: 'very sure' }))).toMatchObject({ ok: true, reply: { confidence: null } });
  });

  it('trims long text and caps the number of notes', () => {
    const r = validateReply(base({ mealName: 'x'.repeat(200), assumptions: Array.from({ length: 20 }, (_, i) => `a${i}`), uncertainties: 'one' }));
    expect(r.ok && r.reply.mealName).toHaveLength(80);
    expect(r.ok && r.reply.assumptions).toHaveLength(12);
    expect(r.ok && r.reply.uncertainties).toEqual(['one']);
  });
});
