import {
  MEAL_REPLY_SCHEMA_VERSION,
  knownUnits,
  limits,
  nutrientKeys,
  nutrientLabels,
  type Confidence,
  type MealItem,
  type NutrientKey,
  type Nutrients,
} from './contract';

/**
 * Step 2 of reading a pasted AI reply (#97): check the extracted object against the versioned contract and
 * normalise it. Pure.
 *
 * - Structure problems (unknown version, no items) stop here with one actionable message.
 * - A bad value (negative, not a number, above a sensible limit) is **not** clipped or guessed: it is left empty
 *   (null) and listed as a problem, so the user sees it and can type the right number in the review.
 * - Units are normalised where the conversion is exact (kg → g, l → ml, kcal → kJ); other units are kept as written.
 */

export type Issue = { path: string; message: string };

export type ValidatedReply = {
  schemaVersion: number;
  mealName: string;
  items: MealItem[];
  aiTotals: Nutrients | null;
  confidence: Confidence | null;
  assumptions: string[];
  uncertainties: string[];
};

export type ValidateResult =
  | { ok: true; reply: ValidatedReply; /** Values left empty, conversions made, things to check. */ issues: Issue[] }
  | { ok: false; message: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const KJ_PER_KCAL = 4.184;

const grouped = (n: number) => new Intl.NumberFormat('en-AU', { maximumFractionDigits: 2 }).format(n);

/**
 * A number from the reply: finite numbers, or numeric strings ("12", "12.5", "12 g"). Null/absent/"unknown" = null.
 * Anything else is a problem.
 */
function readNumber(v: unknown): { value: number | null; problem: string | null } {
  if (v === null || v === undefined) return { value: null, problem: null };
  if (typeof v === 'number') return Number.isFinite(v) ? { value: v, problem: null } : { value: null, problem: 'isn’t a finite number' };
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === '' || s === 'null' || s === 'unknown' || s === 'n/a' || s === '?') return { value: null, problem: null };
    const m = s.replace(/,/g, '').match(/^(?:~|≈|about|approx\.?|approximately|around)?\s*(-?\d+(?:\.\d+)?)\s*(?:g|grams?|kj|kilojoules?|ml)?$/);
    if (m) return { value: Number(m[1]), problem: null };
    return { value: null, problem: `“${v.slice(0, 30)}” isn’t a number` };
  }
  return { value: null, problem: 'isn’t a number' };
}

const unitAliases: Record<string, { unit: string; factor: number }> = {
  g: { unit: 'g', factor: 1 }, gram: { unit: 'g', factor: 1 }, grams: { unit: 'g', factor: 1 }, gr: { unit: 'g', factor: 1 }, gm: { unit: 'g', factor: 1 },
  kg: { unit: 'g', factor: 1000 }, kilogram: { unit: 'g', factor: 1000 }, kilograms: { unit: 'g', factor: 1000 },
  oz: { unit: 'g', factor: 28.3495 }, ounce: { unit: 'g', factor: 28.3495 }, ounces: { unit: 'g', factor: 28.3495 },
  ml: { unit: 'ml', factor: 1 }, millilitre: { unit: 'ml', factor: 1 }, milliliter: { unit: 'ml', factor: 1 }, millilitres: { unit: 'ml', factor: 1 }, milliliters: { unit: 'ml', factor: 1 },
  l: { unit: 'ml', factor: 1000 }, litre: { unit: 'ml', factor: 1000 }, liter: { unit: 'ml', factor: 1000 }, litres: { unit: 'ml', factor: 1000 }, liters: { unit: 'ml', factor: 1000 },
  piece: { unit: 'piece', factor: 1 }, pieces: { unit: 'piece', factor: 1 }, pc: { unit: 'piece', factor: 1 }, pcs: { unit: 'piece', factor: 1 }, each: { unit: 'piece', factor: 1 }, whole: { unit: 'piece', factor: 1 },
  slice: { unit: 'slice', factor: 1 }, slices: { unit: 'slice', factor: 1 },
  cup: { unit: 'cup', factor: 1 }, cups: { unit: 'cup', factor: 1 },
  tbsp: { unit: 'tbsp', factor: 1 }, tablespoon: { unit: 'tbsp', factor: 1 }, tablespoons: { unit: 'tbsp', factor: 1 },
  tsp: { unit: 'tsp', factor: 1 }, teaspoon: { unit: 'tsp', factor: 1 }, teaspoons: { unit: 'tsp', factor: 1 },
  serving: { unit: 'serving', factor: 1 }, servings: { unit: 'serving', factor: 1 }, portion: { unit: 'serving', factor: 1 },
  bowl: { unit: 'bowl', factor: 1 }, bowls: { unit: 'bowl', factor: 1 },
  handful: { unit: 'handful', factor: 1 }, handfuls: { unit: 'handful', factor: 1 },
};

const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null);

const notes = (v: unknown): string[] => {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
  return list.map((x) => text(x, limits.noteLength)).filter((x): x is string => !!x).slice(0, limits.notes);
};

function readConfidence(v: unknown, issues: Issue[]): Confidence | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'low' || s === 'medium' || s === 'high') return s;
    if (s === 'moderate') return 'medium';
  }
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1) return v < 0.5 ? 'low' : v < 0.8 ? 'medium' : 'high';
  issues.push({ path: 'confidence', message: 'Confidence wasn’t low, medium or high, so it isn’t shown.' });
  return null;
}

/**
 * #179: the key spellings AIs actually use, mapped to the canonical fields. Matched case- and punctuation-insensitively
 * ("energy_kj", "Energy (kJ)", "protein", "protein_g"…), so documented numbers never show up blank.
 */
const squash = (k: string) => k.toLowerCase().replace(/[^a-z]/g, '');
const aliases: Record<NutrientKey, string[]> = {
  energyKj: ['energykj', 'kj', 'kilojoules', 'energykilojoules', 'totalenergykj', 'energyinkj'],
  proteinG: ['proteing', 'protein', 'proteingrams', 'proteiningrams', 'totalproteing', 'totalprotein'],
  carbsG: ['carbsg', 'carbs', 'carbohydrate', 'carbohydrates', 'carbohydrateg', 'carbohydratesg', 'carbsgrams', 'totalcarbs'],
  fatG: ['fatg', 'fat', 'fats', 'totalfat', 'totalfatg', 'fatgrams'],
};
const kcalAliases = ['energykcal', 'kcal', 'calories', 'kilocalories', 'cal', 'cals', 'energycal', 'totalcalories', 'totalkcal', 'caloriekcal'];
function lookup(src: Record<string, unknown>, names: string[]): unknown {
  for (const [k, v] of Object.entries(src)) if (names.includes(squash(k)) && v !== undefined) return v;
  return undefined;
}

/** One nutrient of an item or the totals: number, kcal conversion, sign and limit checks. */
function readNutrient(src: Record<string, unknown>, key: NutrientKey, max: number, where: string, path: string, issues: Issue[]): number | null {
  const label = nutrientLabels[key];
  let raw: unknown = src[key] ?? lookup(src, aliases[key]);
  let fromKcal = false;
  if (key === 'energyKj' && (raw === undefined || raw === null)) {
    // Mixed units: an AI that answers in kcal anyway. Converted exactly, and said so.
    const kcal = lookup(src, kcalAliases);
    if (kcal !== undefined && kcal !== null) {
      raw = kcal;
      fromKcal = true;
    } else if (typeof src.energy === 'string' && /kcal|cal/i.test(src.energy)) {
      raw = src.energy.replace(/\s*(?:kcal|kilocalories?|calories|cals?)\s*$/i, '');
      fromKcal = true;
    } else if (typeof src.energy === 'string' && /kj|kilojoule/i.test(src.energy)) {
      raw = src.energy;
    } else if (typeof src.energy === 'number') {
      issues.push({ path: `${path}.energy`, message: `${where}: energy has no unit (kJ or kcal), so it’s left empty. Enter it if you know it.` });
      return null;
    }
  }
  if (typeof raw === 'string' && /kcal|calorie/i.test(raw) && key === 'energyKj') {
    raw = raw.replace(/\s*(?:kcal|kilocalories?|calories|cals?)\s*$/i, '');
    fromKcal = true;
  }
  const n = readNumber(raw);
  if (n.problem) {
    issues.push({ path: `${path}.${key}`, message: `${where}: ${label.label.toLowerCase()} ${n.problem}. Left empty; enter it if you know it.` });
    return null;
  }
  if (n.value === null) return null;
  let value = fromKcal ? n.value * KJ_PER_KCAL : n.value;
  if (value < 0) {
    issues.push({ path: `${path}.${key}`, message: `${where}: ${label.label.toLowerCase()} can’t be negative (${grouped(value)} ${label.unit}). Left empty; enter it if you know it.` });
    return null;
  }
  if (value > max) {
    issues.push({ path: `${path}.${key}`, message: `${where}: ${grouped(value)} ${label.unit} ${label.label.toLowerCase()} is more than a meal can have. Left empty; check the photo and enter it.` });
    return null;
  }
  if (fromKcal) {
    value = Math.round(value);
    issues.push({ path: `${path}.${key}`, message: `${where}: energy was given in kcal and converted to ${grouped(value)} kJ.` });
  }
  return value;
}

export function validateReply(input: Record<string, unknown>): ValidateResult {
  let obj = input;
  const issues: Issue[] = [];
  let version = obj.schemaVersion;
  if (version === undefined || version === null) {
    // #179: a reply without a version is read as the current one, rather than refused.
    version = MEAL_REPLY_SCHEMA_VERSION;
    issues.push({ path: 'schemaVersion', message: `The reply had no schemaVersion, so it was read as version ${MEAL_REPLY_SCHEMA_VERSION}.` });
  }
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return { ok: false, message: 'The reply’s schemaVersion isn’t a whole number. Ask the AI to use the format from the prompt.' };
  }
  if (version > MEAL_REPLY_SCHEMA_VERSION) {
    return { ok: false, message: `This reply uses a newer format (schemaVersion ${version}) than this app reads (${MEAL_REPLY_SCHEMA_VERSION}). Share the prompt from this app with the AI again.` };
  }
  if (version < 1) return { ok: false, message: `schemaVersion ${version} isn’t a format this app knows. Share the prompt with the AI again.` };

  // #179: the minimal form is one meal with its totals and no food list: read it as a single entry.
  const totalsSource = isObj(obj.totals) ? obj.totals : obj;
  const minimal = !Array.isArray(obj.items) && nutrientKeys.some((k) => readNutrient(totalsSource, k, limits.mealNutrient[k], 'Meal', 'totals', []) !== null);
  if (minimal) {
    const name = text(obj.mealName ?? obj.name ?? obj.description ?? obj.meal, limits.name) ?? '';
    obj = { ...obj, items: [{ name: name || 'Meal', ...totalsSource }] };
  }
  if (!Array.isArray(obj.items)) {
    return { ok: false, message: 'The reply has no foods (“items”) and no meal totals (energyKj, proteinG). Ask the AI for the meal’s total energy and protein, or the format from the prompt.' };
  }
  if (!obj.items.length) return { ok: false, message: 'The reply lists no foods. Check the photo shows the meal, or enter the foods yourself.' };
  if (obj.items.length > limits.items) return { ok: false, message: `The reply lists ${obj.items.length} foods; one meal can have at most ${limits.items}. Ask the AI to group small items.` };

  const items: MealItem[] = [];
  obj.items.forEach((raw, i) => {
    const path = `items[${i}]`;
    if (!isObj(raw)) {
      issues.push({ path, message: `Food ${i + 1} isn’t a food entry and was left out.` });
      return;
    }
    const name = text(raw.name, limits.name);
    const where = name ?? `Food ${i + 1}`;
    if (!name) issues.push({ path: `${path}.name`, message: `Food ${i + 1} has no name. Add one.` });

    let quantity: number | null = null;
    let unit: string | null = text(raw.unit, 20)?.toLowerCase() ?? null;
    const q = readNumber(raw.quantity);
    if (q.problem) issues.push({ path: `${path}.quantity`, message: `${where}: amount ${q.problem}. Left empty.` });
    else if (q.value !== null && q.value < 0) issues.push({ path: `${path}.quantity`, message: `${where}: amount can’t be negative. Left empty.` });
    else quantity = q.value;
    if (unit) {
      const alias = unitAliases[unit.replace(/\.$/, '')];
      if (alias) {
        if (alias.factor !== 1 && quantity !== null) {
          const converted = Math.round(quantity * alias.factor);
          issues.push({ path: `${path}.unit`, message: `${where}: ${grouped(quantity)} ${unit} converted to ${grouped(converted)} ${alias.unit}.` });
          quantity = converted;
        }
        unit = alias.unit;
      } else if (!(knownUnits as readonly string[]).includes(unit)) {
        issues.push({ path: `${path}.unit`, message: `${where}: unit “${unit}” kept as written.` });
      }
    }
    if (quantity !== null && quantity > limits.quantity) {
      issues.push({ path: `${path}.quantity`, message: `${where}: ${grouped(quantity)} ${unit ?? ''} is more than one meal. Left empty.` });
      quantity = null;
    }
    const nutrients = Object.fromEntries(nutrientKeys.map((k) => [k, readNutrient(raw, k, limits.itemNutrient[k], where, path, issues)])) as Nutrients;
    items.push({ name: name ?? '', quantity, unit, ...nutrients });
  });
  if (!items.length) return { ok: false, message: 'None of the foods in the reply could be read. Ask the AI to use the format from the prompt.' };

  let aiTotals: Nutrients | null = null;
  if (isObj(obj.totals) || minimal) {
    const t = totalsSource;
    aiTotals = Object.fromEntries(nutrientKeys.map((k) => [k, readNutrient(t, k, limits.mealNutrient[k], 'AI totals', 'totals', issues)])) as Nutrients;
    if (nutrientKeys.every((k) => aiTotals![k] === null)) aiTotals = null;
  }

  return {
    ok: true,
    reply: {
      schemaVersion: version as number,
      mealName: text(obj.mealName ?? obj.name, limits.name) ?? '',
      items,
      aiTotals,
      confidence: readConfidence(obj.confidence, issues),
      assumptions: notes(obj.assumptions),
      uncertainties: notes(obj.uncertainties ?? obj.uncertainty),
    },
    issues,
  };
}
