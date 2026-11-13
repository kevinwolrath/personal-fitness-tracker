import { asWrittenNote, readMealEstimate } from '../mealEstimate';
import { interpretInput } from '../interpret';

/** #179: an AI's plain-text meal estimate is one meal with its totals. Nothing is invented. */
const read = (text: string) => readMealEstimate(text, { year: 2026 });

describe('plain-text meal estimates (#179)', () => {
  it('reads the issue’s one-liner as one dinner', () => {
    expect(read('Dinner: beef curry and dhal — ~2,650 kJ, 45 g protein')).toMatchObject({
      mealType: 'dinner', description: 'Beef curry and dhal.', energyKj: 2650, proteinG: 45, estimated: true, issues: [],
      energyAsWritten: { value: 2650, unit: 'kJ', approximate: true },
    });
  });

  it.each([
    ['Protein 45g; energy 2650kj', 2650, 45],
    ['ENERGY: 2650 KJ\nPROTEIN: 45 G', 2650, 45],
    ['dinner – 45 grams of protein and about 2 650 kilojoules', 2650, 45],
    ['Beef curry and dhal: roughly 2650 kilojoules with 45 grams of protein', 2650, 45],
    ['Dinner (est.): 2650kJ / 45g protein.', 2650, 45],
    ['Dinner: curry. Calories: 633. Protein: 45 g', 2648, 45],
    ['dinner — beef curry, ≈633 kcal, protein 45g', 2648, 45],
  ])('any order, case, punctuation and unit: %s', (text, kj, protein) => {
    expect(read(text)).toMatchObject({ energyKj: kj, proteinG: protein, issues: [] });
  });

  it('a multi-line reply with chatter: the meal, the date and the totals; the chatter is ignored', () => {
    const e = read(`Sure! Here's my estimate for your dinner on 13 November 2026:

Beef curry, lentil dhal, low-carb potatoes, rice and low-carb wrap.

Estimated total: about 2,650 kJ (≈633 kcal) and 45 g protein.

These are rough estimates, not measurements.`);
    expect(e).toMatchObject({ mealType: 'dinner', date: '2026-11-13', description: 'Beef curry, lentil dhal, low-carb potatoes, rice and low-carb wrap.', energyKj: 2650, proteinG: 45, issues: [] });
    expect(asWrittenNote(e!)).toBe('AI estimate as written: ~2,650 kJ, 45 g protein.');
  });

  it('kcal converts to kJ and keeps the value as written', () => {
    const e = read('Lunch: chicken wrap, 500 kcal, 30 g protein')!;
    expect(e.energyKj).toBe(2092);
    expect(e.energyAsWritten).toEqual({ value: 500, unit: 'kcal', approximate: false });
    expect(asWrittenNote(e)).toBe('AI figures as written: 500 kcal, 30 g protein.');
  });

  it('an optional breakdown with a total: the total, and the foods by name only', () => {
    const e = read('Lunch: chicken salad\n- Chicken: 900 kJ, 30 g protein\n- Salad: 300 kJ, 2 g protein\nTotal: 1,200 kJ, 32 g protein');
    expect(e).toMatchObject({ description: 'Chicken salad.', energyKj: 1200, proteinG: 32, foods: ['Chicken', 'Salad'], issues: [] });
  });

  describe('never invents a number', () => {
    it('a breakdown without a total is not summed', () => {
      const e = read('Lunch: chicken salad\n- Chicken: 900 kJ, 30 g protein\n- Salad: 300 kJ, 2 g protein')!;
      expect(e).toMatchObject({ energyKj: null, proteinG: null });
      expect(e.issues.join(' ')).toMatch(/Several energy amounts were listed \(900 kJ, 300 kJ\) but no meal total/);
    });
    it('a range is left empty', () => {
      const e = read('Dinner: curry, 2,400–2,900 kJ, 40-50 g protein')!;
      expect(e).toMatchObject({ energyKj: null, proteinG: null });
      expect(e.issues[0]).toMatch(/range \(2,400–2,900 kJ\)/);
    });
    it('kJ and kcal that disagree are left empty; ones that agree are fine', () => {
      expect(read('Dinner: curry 2650 kJ (900 kcal), 45 g protein')).toMatchObject({ energyKj: null, proteinG: 45, issues: [expect.stringMatching(/don’t agree \(2,650 kJ, 900 kcal\)/)] });
      expect(read('Dinner: curry 2650 kJ (633 kcal), 45 g protein')).toMatchObject({ energyKj: 2650, issues: [] });
    });
    it('a missing protein stays empty with a note', () => {
      expect(read('Dinner: beef curry, about 2,650 kJ')).toMatchObject({ energyKj: 2650, proteinG: null, issues: [expect.stringMatching(/No protein total/)] });
    });
    it('an unbelievable total is left empty', () => {
      expect(read('Dinner: curry, 265,000 kJ, 45 g protein')).toMatchObject({ energyKj: null, issues: [expect.stringMatching(/isn’t a believable meal total/)] });
    });
  });

  describe('not an estimate: left to the rest of the interpreter', () => {
    it.each([
      'jump in the river in your pajamas and swim with sharks',
      'add 1000kj of rice to your meal',
      'log rice 500 kcal',
      'use kg for weight and kcal for energy',
      'Dinner: beef curry',
      'I walked 5 km this morning',
      '{"schemaVersion": 1, "items": []}',
    ])('%s', (text) => expect(read(text)).toBeNull());
  });

  it('dates: ISO, day month, month day and day/month/year', () => {
    expect(read('Dinner 2026-11-12: curry, 2650 kJ, 45 g protein')!.date).toBe('2026-11-12');
    expect(read('Dinner, 12th Nov: curry, 2650 kJ, 45 g protein')!.date).toBe('2026-11-12');
    expect(read('Dinner on November 12: curry, 2650 kJ, 45 g protein')!.date).toBe('2026-11-12');
    expect(read('Dinner 12/11/2026: curry, 2650 kJ, 45 g protein')!.date).toBe('2026-11-12');
    expect(read('Dinner: curry, 2650 kJ, 45 g protein')!.date).toBeNull();
  });

  it('the interpreter returns it as one meal_entry: ACCEPT when clear, CLARIFY with the reason otherwise', () => {
    const ok = interpretInput('Dinner: beef curry and dhal — ~2,650 kJ, 45 g protein');
    expect(ok.intents).toHaveLength(1);
    expect(ok.intents[0]).toMatchObject({ kind: 'meal_entry', outcome: 'ACCEPT', items: [{ name: 'Beef curry and dhal', energyKj: 2650, proteinG: 45, carbsG: null, fatG: null }] });
    const unclear = interpretInput('Dinner: curry, 2,400–2,900 kJ, 45 g protein');
    expect(unclear.intents[0]).toMatchObject({ kind: 'meal_entry', outcome: 'CLARIFY', message: expect.stringMatching(/range/) });
  });
});
