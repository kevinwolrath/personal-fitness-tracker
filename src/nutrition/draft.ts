import { limits, nutrientKeys, nutrientLabels, type Confidence, type MealItem, type MealLog, type MealPhoto, type NutrientKey, type Nutrients } from './contract';
import { extractReply } from './parse';
import { validateReply, type Issue } from './validate';
import { interpretInput } from '../input/interpret';

/**
 * The "Log different meal" wizard's state (#97), pure and serialisable, so it survives leaving the app for the AI
 * app, the app being killed, and a restart. Field values are kept as typed text; `finalizeDraft` turns them into a
 * MealLog only when every value is a valid number or empty (unknown). Nothing is filled in.
 */

export const DRAFT_VERSION = 1;
export const STEPS = ['capture', 'photos', 'share', 'paste', 'review'] as const;
export type Step = (typeof STEPS)[number];

export type DraftItem = { key: string; name: string; quantity: string; unit: string } & Record<NutrientKey, string>;

export type ParsedInfo = {
  schemaVersion: number;
  confidence: Confidence | null;
  assumptions: string[];
  uncertainties: string[];
  aiTotals: Nutrients | null;
  issues: Issue[];
  repaired: string[];
  /** Items as parsed, to tell whether the user edited them. */
  signature: string;
};

export type MealDraft = {
  v: typeof DRAFT_VERSION;
  /** The meal log id, fixed when the draft starts: saving twice writes the same record (duplicate-save protection). */
  id: string;
  mode: 'new' | 'edit';
  date: string;
  planId: string | null;
  activityId: string | null;
  replacedLabel: string | null;
  step: Step;
  photos: MealPhoto[];
  /** Photos added in this draft: deleted if the draft is cancelled (they were never part of a saved meal). */
  addedPhotoIds: string[];
  /** Saved photos the user removed while editing: deleted from storage only after Save. */
  removedPhotos: MealPhoto[];
  reply: string;
  replyError: string | null;
  parsed: ParsedInfo | null;
  source: 'photo-ai' | 'manual';
  name: string;
  items: DraftItem[];
  /** Kept from the saved meal when editing. */
  at: string | null;
  recordedAt: string | null;
  edited: boolean;
  shared: boolean;
  promptCopied: boolean;
  updatedAt: string;
};

let counter = 0;
const itemKey = () => `i${Date.now().toString(36)}${(counter++).toString(36)}`;

const numText = (n: number | null) => (n === null ? '' : String(Math.round(n * 10) / 10));

export const blankItem = (): DraftItem => ({ key: itemKey(), name: '', quantity: '', unit: '', energyKj: '', proteinG: '', carbsG: '', fatG: '' });

const toDraftItem = (i: MealItem): DraftItem => ({
  key: itemKey(),
  name: i.name,
  quantity: numText(i.quantity),
  unit: i.unit ?? '',
  ...(Object.fromEntries(nutrientKeys.map((k) => [k, numText(i[k])])) as Record<NutrientKey, string>),
});

export function newDraft(o: { id: string; date: string; planId: string | null; activityId: string | null; replacedLabel: string | null; now: string }): MealDraft {
  return {
    v: DRAFT_VERSION,
    id: o.id,
    mode: 'new',
    date: o.date,
    planId: o.planId,
    activityId: o.activityId,
    replacedLabel: o.replacedLabel,
    step: 'capture',
    photos: [],
    addedPhotoIds: [],
    removedPhotos: [],
    reply: '',
    replyError: null,
    parsed: null,
    source: 'photo-ai',
    name: '',
    items: [],
    at: null,
    recordedAt: null,
    edited: false,
    shared: false,
    promptCopied: false,
    updatedAt: o.now,
  };
}

/** Edit a saved meal: straight to the review, photos as saved. */
export function draftFromLog(log: MealLog, now: string): MealDraft {
  return {
    ...newDraft({ id: log.id, date: log.date, planId: log.planId, activityId: log.activityId, replacedLabel: log.replacedLabel, now }),
    mode: 'edit',
    step: 'review',
    photos: log.photos,
    source: log.source,
    name: log.name,
    items: log.items.map(toDraftItem),
    parsed:
      log.schemaVersion !== null
        ? { schemaVersion: log.schemaVersion, confidence: log.confidence, assumptions: log.assumptions, uncertainties: log.uncertainties, aiTotals: log.aiTotals, issues: [], repaired: [], signature: signature(log.items) }
        : null,
    at: log.at,
    recordedAt: log.recordedAt,
    edited: log.edited,
  };
}

const signature = (items: MealItem[]) => JSON.stringify(items.map((i) => [i.name, i.quantity, i.unit, ...nutrientKeys.map((k) => i[k])]));

/** Read the pasted reply into the draft's review fields. On failure the draft keeps the paste and gets one message. */
export function applyReply(d: MealDraft, reply: string, now: string): MealDraft {
  const base = { ...d, reply, updatedAt: now };
  const ex = extractReply(reply);
  if (!ex.ok) {
    const interpretation = interpretInput(reply);
    const meals = interpretation.intents.filter((entry) => entry.kind === 'meal_entry' && entry.outcome === 'ACCEPT');
    if (!meals.length) return { ...base, replyError: interpretation.intents.find((entry) => entry.outcome === 'CLARIFY')?.message ?? ex.message };
    const items = meals.flatMap((entry) => entry.items ?? []);
    if (items.length > limits.items) return { ...base, replyError: `A meal supports at most ${limits.items} foods.` };
    return { ...base, source: 'manual', parsed: null, replyError: null, name: items.map((item) => item.name).join(', '), items: items.map(toDraftItem), step: 'review' };
  }
  const v = validateReply(ex.value);
  if (!v.ok) return { ...base, replyError: v.message };
  const r = v.reply;
  return {
    ...base,
    replyError: null,
    source: 'photo-ai',
    name: r.mealName || d.replacedLabel || '',
    items: r.items.map(toDraftItem),
    parsed: {
      schemaVersion: r.schemaVersion,
      confidence: r.confidence,
      assumptions: r.assumptions,
      uncertainties: r.uncertainties,
      aiTotals: r.aiTotals,
      issues: v.issues,
      repaired: ex.repaired,
      signature: signature(r.items),
    },
    step: 'review',
  };
}

/** "Enter the numbers myself": an empty review with one blank food. Keeps any photos. */
export function manualEntry(d: MealDraft, now: string): MealDraft {
  return { ...d, source: 'manual', parsed: null, replyError: null, items: d.items.length ? d.items : [blankItem()], step: 'review', updatedAt: now };
}

/** A typed field: empty = unknown (null); otherwise a finite, non-negative number. */
export function readField(s: string): number | null | 'invalid' {
  const t = s.trim().replace(/,/g, '');
  if (!t) return null;
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(t)) return 'invalid';
  const n = Number(t);
  return Number.isFinite(n) ? n : 'invalid';
}

/** Draft items as numbers where they're valid (invalid fields read as unknown), for live totals. */
export function liveItems(items: DraftItem[]): MealItem[] {
  return items.map((i) => {
    const num = (s: string) => {
      const v = readField(s);
      return v === 'invalid' ? null : v;
    };
    return { name: i.name.trim(), quantity: num(i.quantity), unit: i.unit.trim() || null, ...(Object.fromEntries(nutrientKeys.map((k) => [k, num(i[k])])) as Nutrients) };
  });
}

export type FieldError = { key: string; field: keyof DraftItem | 'name'; message: string };

/** Everything that stops Save, field by field. */
export function draftErrors(d: MealDraft): FieldError[] {
  const errors: FieldError[] = [];
  if (!d.name.trim()) errors.push({ key: 'meal', field: 'name', message: 'Give the meal a name.' });
  if (!d.items.length) errors.push({ key: 'meal', field: 'name', message: 'Add at least one food.' });
  d.items.forEach((i, n) => {
    const where = i.name.trim() || `Food ${n + 1}`;
    if (!i.name.trim()) errors.push({ key: i.key, field: 'name', message: `Food ${n + 1} needs a name.` });
    const q = readField(i.quantity);
    if (q === 'invalid') errors.push({ key: i.key, field: 'quantity', message: `${where}: the amount isn’t a number.` });
    else if (q !== null && q > limits.quantity) errors.push({ key: i.key, field: 'quantity', message: `${where}: the amount is more than one meal.` });
    for (const k of nutrientKeys) {
      const v = readField(i[k]);
      const { label, unit } = nutrientLabels[k];
      if (v === 'invalid') errors.push({ key: i.key, field: k, message: `${where}: ${label.toLowerCase()} must be a number of ${unit}, or empty if unknown.` });
      else if (v !== null && v > limits.itemNutrient[k]) errors.push({ key: i.key, field: k, message: `${where}: ${label.toLowerCase()} is more than one food can have.` });
    }
  });
  return errors;
}

export function finalizeDraft(d: MealDraft, now: string): { ok: true; log: MealLog; removedPhotos: MealPhoto[] } | { ok: false; errors: FieldError[] } {
  const errors = draftErrors(d);
  if (errors.length) return { ok: false, errors };
  const items = liveItems(d.items);
  const p = d.parsed;
  const log: MealLog = {
    id: d.id,
    date: d.date,
    at: d.at ?? now,
    planId: d.planId,
    activityId: d.activityId,
    replacedLabel: d.replacedLabel,
    name: d.name.trim(),
    items,
    aiTotals: p?.aiTotals ?? null,
    confidence: p?.confidence ?? null,
    assumptions: p?.assumptions ?? [],
    uncertainties: p?.uncertainties ?? [],
    source: p ? 'photo-ai' : 'manual',
    schemaVersion: p?.schemaVersion ?? null,
    edited: d.edited || (p ? signature(items) !== p.signature : false),
    photos: d.photos,
    recordedAt: d.recordedAt ?? now,
    updatedAt: now,
  };
  return { ok: true, log, removedPhotos: d.removedPhotos };
}

/** Restore a saved draft. Anything unexpected (another version, damaged JSON) gives null: start again, don't crash. */
export function restoreDraft(json: string | null): MealDraft | null {
  if (!json) return null;
  try {
    const d = JSON.parse(json) as MealDraft;
    if (!d || d.v !== DRAFT_VERSION || typeof d.id !== 'string' || typeof d.date !== 'string' || !STEPS.includes(d.step)) return null;
    if (!Array.isArray(d.photos) || !Array.isArray(d.items) || !Array.isArray(d.addedPhotoIds) || !Array.isArray(d.removedPhotos)) return null;
    return d;
  } catch {
    return null;
  }
}

/** Is this draft for the meal being opened? (Same day and scheduled meal, or the same saved meal being edited.) */
export function draftMatches(d: MealDraft, target: { date: string; activityId: string | null; editId?: string | null }): boolean {
  if (target.editId) return d.mode === 'edit' && d.id === target.editId;
  return d.mode === 'new' && d.date === target.date && d.activityId === target.activityId;
}
