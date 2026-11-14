import { limits, type MealLog, type MealPhoto } from './contract';
import { applyReply, finalizeDraft, liveItems, newDraft, readField } from './draft';

/**
 * One-flow photo meal logging (#183): what the return page needs, pure. The AI's shared text is read by the SAME
 * parser as everything else (#179: `applyReply` → the natural-language interpreter and its rolling corpus, with the
 * JSON reply as a fallback), then reduced to the two required fields: Description and Energy (kJ). Protein is kept
 * when parsed, never asked for.
 */

/** Where the photo was taken from: the day and scheduled meal, remembered while the user is in the AI app. */
export type QuickContext = {
  /** The meal log id, fixed when the photo was taken: saving twice writes the same record. */
  id: string;
  date: string;
  planId: string | null;
  activityId: string | null;
  replacedLabel: string | null;
  photo: MealPhoto | null;
  startedAt: string;
};

export type QuickFields = { description: string; energyKj: string };
export type QuickParse = {
  fields: QuickFields;
  proteinG: number | null;
  /** Why a required field is empty (inline, only when it couldn't be read). */
  problems: Partial<Record<keyof QuickFields, string>>;
  /** The values as the AI wrote them, kept in the meal's notes. */
  notes: string[];
  schemaVersion: number | null;
  /** The meal type the text named ("dinner"), when it did. */
  mealType: string | null;
};

/** A remembered context is used only for a recent photo on today or a past day; otherwise the safe default applies. */
export const CONTEXT_MAX_AGE_MS = 24 * 3600 * 1000;
export function usableContext(c: QuickContext | null, now: Date, today: string): QuickContext | null {
  if (!c || typeof c.id !== 'string' || typeof c.date !== 'string' || c.date > today) return null;
  const age = now.getTime() - new Date(c.startedAt).getTime();
  return Number.isFinite(age) && age >= 0 && age <= CONTEXT_MAX_AGE_MS ? c : null;
}

/** The safe default when nothing was remembered: an extra meal today (nothing scheduled is replaced). */
export const defaultContext = (id: string, today: string, now: string): QuickContext => ({ id, date: today, planId: null, activityId: null, replacedLabel: null, photo: null, startedAt: now });

const numText = (n: number | null) => (n === null ? '' : String(Math.round(n)));

/** Read the shared text with the existing parser. Never throws; unknowns stay empty with a reason. */
export function parseShared(text: string, ctx: QuickContext, now: string): QuickParse {
  const d = applyReply({ ...newDraft({ ...ctx, now }), step: 'paste' }, text ?? '', now);
  if (d.replyError || !d.items.length) {
    return { fields: { description: '', energyKj: '' }, proteinG: null, problems: { description: 'Couldn’t read a meal from the shared text. Type a short description.', energyKj: 'Couldn’t read the energy. Enter it in kJ.' }, notes: [], schemaVersion: null, mealType: null };
  }
  const items = liveItems(d.items);
  const sum = (k: 'energyKj' | 'proteinG') => (items.some((i) => i[k] !== null) ? items.reduce((n, i) => n + (i[k] ?? 0), 0) : null);
  const energy = sum('energyKj');
  const protein = sum('proteinG');
  const description = d.name.trim();
  const problems: QuickParse['problems'] = {};
  if (!description) problems.description = 'No description was found. Type a short description.';
  if (energy === null) {
    const why = d.parsed?.issues.find((i) => /energy/i.test(i.message))?.message;
    problems.energyKj = why ?? 'No energy was found. Enter it in kJ.';
  }
  return {
    fields: { description, energyKj: numText(energy) },
    proteinG: protein === null ? null : Math.round(protein * 10) / 10,
    problems,
    notes: d.parsed?.assumptions ?? [],
    schemaVersion: d.parsed?.schemaVersion ?? null,
    mealType: d.parsed?.mealType ?? null,
  };
}

/** Inline errors that stop Save: a description and a believable energy in kJ are required; nothing else is. */
export function quickErrors(f: QuickFields): Partial<Record<keyof QuickFields, string>> {
  const errors: Partial<Record<keyof QuickFields, string>> = {};
  if (!f.description.trim()) errors.description = 'Add a short description.';
  else if (f.description.trim().length > limits.name) errors.description = `Keep the description to ${limits.name} characters.`;
  const e = readField(f.energyKj);
  if (e === null) errors.energyKj = 'Enter the energy in kJ.';
  else if (e === 'invalid') errors.energyKj = 'Energy must be a number of kJ.';
  else if (e <= 0 || e > limits.mealNutrient.energyKj) errors.energyKj = `Energy must be between 1 and ${limits.mealNutrient.energyKj.toLocaleString('en-AU')} kJ.`;
  return errors;
}

/**
 * The meal log for Save: one entry (description, energy, protein if it was parsed), the photo, the AI's values as
 * written in the notes. `existing` is this slot's saved replacement, if any: its id is reused, so a second photo for
 * the same scheduled meal replaces the first instead of counting twice.
 */
export function quickMealLog(parsed: QuickParse, f: QuickFields, ctx: QuickContext, now: string, existing?: MealLog | null): { ok: true; log: MealLog } | { ok: false; errors: Partial<Record<keyof QuickFields, string>> } {
  const errors = quickErrors(f);
  if (Object.keys(errors).length) return { ok: false, errors };
  const description = f.description.trim().replace(/\s+/g, ' ');
  const energyKj = readField(f.energyKj) as number;
  const base = newDraft({ ...ctx, id: existing?.id ?? ctx.id, now });
  const r = finalizeDraft(
    {
      ...base,
      source: 'photo-ai',
      name: description,
      items: [{ key: 'q', name: description, quantity: '', unit: '', energyKj: String(energyKj), proteinG: parsed.proteinG === null ? '' : String(parsed.proteinG), carbsG: '', fatG: '' }],
      photos: ctx.photo ? [ctx.photo] : existing?.photos ?? [],
      parsed: {
        schemaVersion: parsed.schemaVersion, format: parsed.schemaVersion === null ? 'text' : 'json', mealType: parsed.mealType, confidence: null,
        assumptions: parsed.notes, uncertainties: [], issues: [], repaired: [],
        aiTotals: { energyKj: readField(parsed.fields.energyKj) as number | null, proteinG: parsed.proteinG, carbsG: null, fatG: null },
        signature: JSON.stringify([[parsed.fields.description, null, null, readField(parsed.fields.energyKj), parsed.proteinG, null, null]]),
      },
      at: existing?.at ?? null,
      recordedAt: existing?.recordedAt ?? null,
    },
    now,
  );
  if (!r.ok) return { ok: false, errors: { description: r.errors[0]?.message } };
  return { ok: true, log: r.log };
}
