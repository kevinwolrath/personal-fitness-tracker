import { isSafe, mealTemplates, safeMeals } from '../meals';

/** #53: sample meals. Tags must cover every ingredient that implies an allergen or a dietary exclusion. */

const implied: [string, RegExp][] = [
  ['gluten', /\b(bread|toast|wrap|pasta|oats|soy sauce|flour|couscous)\b/i],
  ['dairy', /\b(yoghurt|milk|cheese|butter|cream)\b/i],
  ['egg', /\beggs?\b/i],
  ['meat', /\b(chicken|mince|beef|pork|lamb|bacon|ham|turkey)\b/i],
  ['fish', /\b(fish|tuna|salmon|sardines?|prawns?)\b/i],
  ['nuts', /\b(nuts?|peanuts?|almonds?|cashews?|walnuts?)\b/i],
  ['soy', /\b(tofu|soy|tamari)\b/i],
  ['sesame', /\b(hummus|tahini|sesame)\b/i],
];
// Plant milks and yoghurts aren't dairy; corn tortillas aren't wheat.
const plantDairy = /\b(soy|plant|other plant|oat|almond)\s+(milk|yoghurt)\b/gi;

describe('every template is tagged for what its ingredients imply', () => {
  it.each(mealTemplates.map((m) => [m.id, m] as const))('%s', (_id, m) => {
    const names = m.ingredients.map((i) => i.name).join(' · ');
    for (const [tag, re] of implied) {
      const text = tag === 'dairy' ? names.replace(plantDairy, '') : names;
      if (re.test(text)) expect({ id: m.id, contains: m.contains }).toEqual({ id: m.id, contains: expect.arrayContaining([tag]) });
    }
  });
});

describe('labelling and portions', () => {
  it('no energy or nutrient numbers; every portion is a hand measure or a count', () => {
    for (const m of mealTemplates) {
      expect(JSON.stringify(m)).not.toMatch(/\b(kcal|kJ|calorie|grams?)\b/i);
      for (const i of m.ingredients) expect(i.measure).toMatch(/palm|fist|cupped hand|thumb|slice|egg|wrap|cup|taste/i);
    }
  });

  it('a nut allergy rules out every template that mentions nuts or peanuts, in every slot', () => {
    const safe = Object.values(safeMeals(['nut_allergy'])).flat();
    expect(safe.some((m) => /nut|peanut/i.test(JSON.stringify(m.ingredients)))).toBe(false);
    expect(isSafe(mealTemplates.find((m) => m.id === 'peanut-toast-banana')!, ['nut_allergy'])).toBe(false);
  });

  it('soy sauce counts as gluten', () => {
    expect(isSafe(mealTemplates.find((m) => m.id === 'egg-fried-rice')!, ['gluten_free'])).toBe(false);
  });
});
