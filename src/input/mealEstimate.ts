import { limits } from '../nutrition/contract';
import { convert } from './units';

/**
 * An AI's plain-text meal estimate (#179), read as ONE meal: "Dinner: beef curry and dhal — ~2,650 kJ, 45 g protein".
 * Pure, part of the natural-language interpreter (`interpret.ts`), regression-tested by the rolling input corpus.
 *
 * - Reads the meal type, a readable description, the date (if given), total energy (kcal converted to kJ) and total
 *   protein, in any order, case or punctuation, with approximate wording, across lines, and with chatter around it.
 * - Never invents a number. A missing value stays empty. A range, two different totals, kJ and kcal that disagree, or a
 *   breakdown without a total leave that value empty, with a message saying why, so the review asks the user.
 * - An optional per-food breakdown is kept as names only; it is never required and never summed.
 */

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type AsWritten = { value: number; unit: 'kJ' | 'kcal' | 'g'; approximate: boolean };
export type MealEstimate = {
  mealType: MealType | null;
  description: string | null;
  /** YYYY-MM-DD, when the text names a date. */
  date: string | null;
  energyKj: number | null;
  proteinG: number | null;
  /** The chosen totals as the AI wrote them, before any conversion. */
  energyAsWritten: AsWritten | null;
  proteinAsWritten: AsWritten | null;
  /** Approximate wording (~, about, estimated…) anywhere in the estimate. */
  estimated: boolean;
  /** Food names from an optional breakdown, never required. */
  foods: string[];
  /** Why a value was left empty, for the review. */
  issues: string[];
};

const NUM = String.raw`\d{1,3}(?:[,   ]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+`;
const APPROX = String.raw`~|≈|±|about|approx\.?|approximately|around|roughly|circa|ca\.|est\.?|estimated|estimate(?:\s+of)?|nearly|almost|close\s+to|some`;
const RANGE = String.raw`(?:\s*(?:-|–|—|to)\s*(${NUM}))?`;
const ENERGY_UNIT = String.raw`kilojoules?|kj|kilocalories?|kcals?|calories|cals?`;
const energyAfter = new RegExp(String.raw`(?:(${APPROX})\s*)?(${NUM})${RANGE}\s*(${ENERGY_UNIT})(?![a-z])`, 'gi');
const energyLabel = new RegExp(String.raw`\b(calories|kcals?|kilojoules|kj)\s*(?:[:=]|is|are|of)\s*(?:(${APPROX})\s*)?(${NUM})${RANGE}(?!\s*(?:${ENERGY_UNIT}|g\b|grams?\b|%))`, 'gi');
const proteinBefore = new RegExp(String.raw`\bprotein\b\s*(?:[:=–—-]|\bis\b|\bof\b)?\s*(?:(${APPROX})\s*)?(${NUM})${RANGE}\s*(?:g|grams?|gm)(?![a-z])`, 'gi');
const proteinAfter = new RegExp(String.raw`(?:(${APPROX})\s*)?(${NUM})${RANGE}\s*(?:g|grams?|gm)\s*(?:of\s+)?protein\b`, 'gi');
const APPROX_WORD = new RegExp(String.raw`(?:^|[^a-z])(?:${APPROX})(?![a-z])`, 'i');
const TOTAL_LINE = /\b(?:totals?|overall|altogether|in all|combined|whole meal|meal total|for the (?:whole )?meal|all up|sum)\b/i;
const COMMAND = /^\s*(?:please\s+|(?:can|could|would)\s+you\s+(?:please\s+)?)?(?:add|log|record|use|change|set|switch|increase|decrease|update|display|delete|remove|do not|don't|never)\b/i;
const CHATTER = /^(?:sure|here(?:'s|’s| is| are)|okay|ok|great|happy to|i(?:'d|’d| would| estimate| think)|these are|this is|note|disclaimer|let me|hope|please note|keep in mind|values are|numbers are|nutrition|estimates?)\b/i;

type Mention = { kind: 'energy' | 'protein'; value: number; to: number | null; unit: 'kJ' | 'kcal' | 'g'; approximate: boolean; line: number; start: number; end: number };

const toNumber = (s: string) => Number(s.replace(/[,   ]/g, ''));
const energyUnit = (u: string): 'kJ' | 'kcal' => (/^k?j|kilojoule/i.test(u) && !/cal/i.test(u) ? 'kJ' : 'kcal');
const grouped = (n: number) => new Intl.NumberFormat('en-AU', { maximumFractionDigits: 1 }).format(n);
const show = (m: Mention) => `${m.approximate ? '~' : ''}${grouped(m.value)}${m.to !== null ? `–${grouped(m.to)}` : ''} ${m.unit}`;

function mentions(lines: string[]): Mention[] {
  const out: Mention[] = [];
  const taken = (line: number, start: number, end: number) => out.some((m) => m.line === line && start < m.end && end > m.start);
  lines.forEach((text, line) => {
    const push = (m: Mention) => { if (!taken(m.line, m.start, m.end)) out.push(m); };
    for (const r of text.matchAll(proteinBefore)) push({ kind: 'protein', approximate: !!r[1], value: toNumber(r[2]), to: r[3] ? toNumber(r[3]) : null, unit: 'g', line, start: r.index!, end: r.index! + r[0].length });
    for (const r of text.matchAll(proteinAfter)) push({ kind: 'protein', approximate: !!r[1], value: toNumber(r[2]), to: r[3] ? toNumber(r[3]) : null, unit: 'g', line, start: r.index!, end: r.index! + r[0].length });
    for (const r of text.matchAll(energyAfter)) push({ kind: 'energy', approximate: !!r[1], value: toNumber(r[2]), to: r[3] ? toNumber(r[3]) : null, unit: energyUnit(r[4]), line, start: r.index!, end: r.index! + r[0].length });
    for (const r of text.matchAll(energyLabel)) push({ kind: 'energy', approximate: !!r[2], value: toNumber(r[3]), to: r[4] ? toNumber(r[4]) : null, unit: energyUnit(r[1]), line, start: r.index!, end: r.index! + r[0].length });
  });
  return out;
}

const kjOf = (m: Mention) => (m.unit === 'kcal' ? convert(m.value, 'kcal', 'kJ', 'energy') : m.value);

/** The meal total for one quantity, or null with a reason. Never sums, averages or picks between different values. */
function total(all: Mention[], kind: 'energy' | 'protein', totalLines: Set<number>, label: string): { value: number | null; asWritten: AsWritten | null; issue: string | null } {
  let ms = all.filter((m) => m.kind === kind);
  if (!ms.length) return { value: null, asWritten: null, issue: `No ${label} total was given, so it’s left empty. Enter it if you know it.` };
  const onTotals = ms.filter((m) => totalLines.has(m.line));
  if (onTotals.length) ms = onTotals;
  const ranged = ms.find((m) => m.to !== null);
  if (ranged) return { value: null, asWritten: null, issue: `The ${label} was given as a range (${show(ranged)}), so it’s left empty. Enter the amount you want to log.` };
  const canonical = (m: Mention) => (kind === 'energy' ? kjOf(m) : m.value);
  const clusters: Mention[][] = [];
  for (const m of ms) {
    const c = clusters.find((group) => Math.abs(canonical(group[0]) - canonical(m)) <= 0.03 * Math.max(canonical(group[0]), canonical(m), 1));
    if (c) c.push(m); else clusters.push([m]);
  }
  if (clusters.length > 1) {
    const lines = new Set(ms.map((m) => m.line));
    const listed = clusters.map((c) => show(c[0])).join(', ');
    return {
      value: null,
      asWritten: null,
      issue: !onTotals.length && lines.size > 1
        ? `Several ${label} amounts were listed (${listed}) but no meal total, so it’s left empty. Enter the total, or ask the AI for one.`
        : `The ${label} amounts don’t agree (${listed}), so it’s left empty. Enter the right one.`,
    };
  }
  const chosen = clusters[0].find((m) => m.unit !== 'kcal') ?? clusters[0][0];
  const value = kind === 'energy' ? Math.round(kjOf(chosen)) : Math.round(chosen.value * 10) / 10;
  const max = kind === 'energy' ? limits.mealNutrient.energyKj : limits.mealNutrient.proteinG;
  if (value <= 0 || value > max) return { value: null, asWritten: null, issue: `${show(chosen)} ${kind === 'protein' ? 'protein ' : ''}isn’t a believable meal total, so it’s left empty. Check it and enter it.` };
  return { value, asWritten: { value: chosen.value, unit: chosen.unit, approximate: clusters[0].some((m) => m.approximate) }, issue: null };
}

const mealWords: [RegExp, MealType][] = [
  [/\bbreakfast\b/i, 'breakfast'],
  [/\b(?:lunch|brunch)\b/i, 'lunch'],
  [/\b(?:dinner|supper|evening meal)\b/i, 'dinner'],
  [/\b(?:snack|dessert)\b/i, 'snack'],
];
const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const pad = (n: number) => String(n).padStart(2, '0');
function validDate(y: number, m: number, d: number): string | null {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}
function readDate(text: string, year: number): string | null {
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) return validDate(+iso[1], +iso[2], +iso[3]);
  const dmy = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?${MONTH}\.?,?(?:\s+(20\d{2}))?\b`, 'i').exec(text);
  if (dmy) return validDate(dmy[3] ? +dmy[3] : year, months.indexOf(dmy[2].slice(0, 3).toLowerCase()) + 1, +dmy[1]);
  const mdy = new RegExp(String.raw`\b${MONTH}\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?(?:\s+(20\d{2}))?\b`, 'i').exec(text);
  if (mdy) return validDate(mdy[3] ? +mdy[3] : year, months.indexOf(mdy[1].slice(0, 3).toLowerCase()) + 1, +mdy[2]);
  const slash = /\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/.exec(text); // day/month/year (en-AU)
  if (slash) return validDate(+slash[3], +slash[2], +slash[1]);
  return null;
}

const DATE_TEXT = new RegExp(String.raw`\b(?:on\s+)?(?:(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?,?\s+)?(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?${MONTH}\.?,?(?:\s+20\d{2})?|${MONTH}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?(?:\s+20\d{2})?|20\d{2}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/20\d{2})\b`, 'gi');

/** A line with the numbers, dates and approximate wording taken out, tidied into a readable description. */
function prose(line: string, ms: Mention[]): string {
  let t = line;
  for (const m of [...ms].sort((a, b) => b.start - a.start)) t = t.slice(0, m.start) + ' ' + t.slice(m.end);
  return t
    .replace(DATE_TEXT, ' ')
    .replace(/\b(?:energy|protein|calories|kilojoules|kj|kcal)\b\s*[:=]?/gi, ' ')
    .replace(/\b(?:estimated|estimate|approx(?:imately)?|about|around|roughly|total|totals)\b\s*[:=]?/gi, ' ')
    .replace(/[~≈±]/g, ' ')
    .replace(/\(\s*[,;·/|-]*\s*\)/g, ' ')
    .replace(/\s*[·|]\s*(?=[·|,;]|$)/g, ' ')
    .replace(/(?:\s*[,;·|—–-]\s*)+$/g, '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
    .replace(/^[\s,;:·|—–-]+/, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/(?:\s*[.,;:]){2,}/g, '.')
    .replace(/(?:[\s.,;:—–-]+|\s+(?:with|and|plus|of|for|at|in|on|is|are|was)\b)+$/i, '')
    .replace(/(?:[\s.,;:—–-]+|\s+(?:with|and|plus|of|for|at|in|on|is|are|was)\b)+$/i, '')
    .trim();
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Read a plain-text meal estimate, or null when the text isn't one (a command such as "add 1000 kJ of rice", a
 * configuration update, or unrelated text: those stay with the rest of the interpreter).
 */
export function readMealEstimate(input: string, opts: { year?: number } = {}): MealEstimate | null {
  if (!input || input.length > limits.pasteChars || COMMAND.test(input) || /[{}]/.test(input)) return null;
  const text = input.replace(/\r\n?/g, '\n').replace(/−/g, '-').replace(/\*\*|__|`/g, '');
  const lines = text.split('\n');
  const ms = mentions(lines);
  const hasEnergy = ms.some((m) => m.kind === 'energy');
  const hasProtein = ms.some((m) => m.kind === 'protein');
  const meal = mealWords.find(([re]) => re.test(text));
  const estimateWords = APPROX_WORD.test(text) || TOTAL_LINE.test(text);
  if (!(hasEnergy || hasProtein) || !(hasProtein || meal || estimateWords)) return null;

  const totalLines = new Set(lines.flatMap((l, i) => (TOTAL_LINE.test(l) && ms.some((m) => m.line === i) ? [i] : [])));
  const energy = total(ms, 'energy', totalLines, 'energy');
  const protein = total(ms, 'protein', totalLines, 'protein');

  // Description: after "Dinner:" (or "Meal:") if there is one, else the first line of real prose, else what's left of the
  // nutrition line. Lines that are only numbers, chatter, a heading or a breakdown row don't describe the meal.
  const bullet = /^\s*(?:[-*•]|\d+[.)])\s+/;
  const breakdown = lines.map((l, i) => bullet.test(l) && ms.some((m) => m.line === i) && !totalLines.has(i));
  const lineMentions = (i: number) => ms.filter((m) => m.line === i);
  let description: string | null = null;
  const labelled = /^\s*(?:[-*•]\s*)?(?:(?:breakfast|brunch|lunch|dinner|supper|snack|dessert|meal|description|food|what you (?:ate|had))\b[^:\n]{0,24}?)\s*[:—–-]\s*(.+)$/i;
  for (let i = 0; i < lines.length && !description; i++) {
    const m = labelled.exec(lines[i]);
    if (!m) continue;
    const offset = lines[i].length - m[1].length;
    const rest = prose(m[1], lineMentions(i).map((x) => ({ ...x, start: x.start - offset, end: x.end - offset })).filter((x) => x.start >= 0));
    if (rest && /[a-z]{3}/i.test(rest)) description = rest;
  }
  for (let i = 0; i < lines.length && !description; i++) {
    const l = lines[i].trim();
    if (!l || breakdown[i] || totalLines.has(i) || CHATTER.test(l) || /:\s*$/.test(l) || l.split(/\s+/).length < 2) continue;
    if (lineMentions(i).length) continue;
    const p = prose(l, []);
    if (p && /[a-z]{3}/i.test(p) && !/^(?:energy|protein|date)\b/i.test(p)) description = p;
  }
  for (let i = 0; i < lines.length && !description; i++) {
    if (!lineMentions(i).length || breakdown[i]) continue;
    const p = prose(lines[i], lineMentions(i)).replace(/^(?:breakfast|brunch|lunch|dinner|supper|snack|dessert)\b\s*[:—–-]?\s*/i, '');
    if (p && /[a-z]{3}/i.test(p) && !CHATTER.test(p)) description = p;
  }
  if (description) description = capital(description.replace(/\.$/, '')) + '.';

  const foods = lines.flatMap((l, i) => (breakdown[i] ? [prose(l, lineMentions(i)).replace(/[:—–-]\s*$/, '')].filter((f) => /[a-z]{3}/i.test(f)) : [])).slice(0, limits.items);
  const issues = [energy.issue, protein.issue].filter((x): x is string => !!x);
  // Only a value that was never given is "missing"; a missing protein alongside a found energy is still a review note.
  return {
    mealType: meal ? meal[1] : null,
    description: description ? description.slice(0, 300) : null,
    date: readDate(text, opts.year ?? new Date().getFullYear()),
    energyKj: energy.value,
    proteinG: protein.value,
    energyAsWritten: energy.asWritten,
    proteinAsWritten: protein.asWritten,
    estimated: APPROX_WORD.test(text) || /\bestimat/i.test(text),
    foods,
    issues,
  };
}

/** "~2,650 kJ, 45 g protein": the totals as the AI wrote them, for the meal's notes. */
export function asWrittenNote(e: MealEstimate): string | null {
  const parts = [
    e.energyAsWritten ? `${e.energyAsWritten.approximate ? '~' : ''}${grouped(e.energyAsWritten.value)} ${e.energyAsWritten.unit}` : null,
    e.proteinAsWritten ? `${e.proteinAsWritten.approximate ? '~' : ''}${grouped(e.proteinAsWritten.value)} g protein` : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  return `${e.estimated ? 'AI estimate' : 'AI figures'} as written: ${parts.join(', ')}.`;
}

export const mealTypeLabel = (t: MealType | null) => (t ? capital(t) : null);
