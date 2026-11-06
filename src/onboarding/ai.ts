import { APP_NAME } from '../brand';
import { previewUpdate, type SectionPreview } from '../config/diff';
import { buildAiInstructions } from '../config/instructions';
import type { RawPlan, SectionName } from '../config/sections';
import { applyConfigUpdate, parseConfigUpdate, type ConfigUpdate } from '../config/update';
import type { EnergyDisplay } from '../energy';
import { isMinor, type Draft } from './draft';
import { answerLines } from './labels';
import { activeNutritionSeed, type NutritionSeed } from './nutritionSeed';

/**
 * The AI step of first-run setup (#49). Provider-neutral: plain text to copy into any chat assistant, and its
 * reply goes through the same fault-tolerant importer, validation and preview as Configure with AI (#47).
 * Nothing is applied here; the review decides.
 */

const excluded = (seed: NutritionSeed): SectionName[] => (seed.allowsAiNutrition ? [] : ['nutrition']);

export function buildSetupPrompt(starterRaw: RawPlan, d: Draft, today: string, seed: NutritionSeed = activeNutritionSeed()): string {
  const answers = answerLines(d);
  const told = answers.length ? answers.map((a) => `- ${a.label}: ${a.value}`).join('\n') : '- Nothing yet: please ask me.';
  const nutrition = seed.prompt((starterRaw.profile ?? {}) as Record<string, unknown>);
  const intro = `# ${APP_NAME}: my first plan

I've just installed ${APP_NAME}, a personal health and fitness app, and I'd like help refining my starting plan. Here is what I told the app (anything missing, I chose not to say):

${told}

Please:
1. Ask me anything you need first, especially about health conditions, injuries and what I can realistically do. Don't guess about health limits.
2. The app already made me a starter plan (under "My current configuration" below). Suggest changes that suit me better: the weekly schedule (schedule.activities) and the exercise and profile sections. Keep it achievable, keep at least one rest day, and say what you assumed.
3. This is a suggestion, not medical advice. If something I want needs a doctor or other health professional, tell me in the chat.
${nutrition ? `4. Nutrition:\n${nutrition}` : '4. Leave nutrition out completely. Don\'t suggest diets, meals or energy targets: the app sets up nutrition separately.'}

When we've agreed, reply with ONE update in the format below.`;
  return buildAiInstructions(starterRaw, today, {
    exclude: excluded(seed),
    intro,
    ending: 'Start by asking me your questions.',
  });
}

export type SetupReply =
  | { ok: true; nextRaw: RawPlan; preview: SectionPreview[]; notes: string[]; payload: unknown }
  | { ok: false; errors: string[]; notes: string[]; diagnostics?: string };

/** Check a pasted reply against the starter plan. Pure: returns the plan it would produce and what changes. */
export function checkSetupReply(
  starterRaw: RawPlan,
  text: string,
  d: Draft,
  display: EnergyDisplay,
  seed: NutritionSeed = activeNutritionSeed(),
): SetupReply {
  if (isMinor(d)) return { ok: false, errors: ['Personalised AI plans are for adults (18+).'], notes: [] };
  const parsed = parseConfigUpdate(text);
  if (!parsed.ok) return { ok: false, errors: parsed.errors, notes: parsed.notes, diagnostics: parsed.diagnostics };
  const notes = [...parsed.notes];
  const sections = { ...parsed.update.sections };
  for (const s of excluded(seed)) {
    if (sections[s]) {
      delete sections[s];
      notes.push("Nutrition isn't set up yet, so the AI's nutrition suggestions were left out.");
    }
  }
  if (!Object.keys(sections).length) {
    return { ok: false, errors: ['The reply had nothing the app can use yet. Ask the AI for a weekly schedule of exercise and habits.'], notes };
  }
  const update: ConfigUpdate = { ...parsed.update, sections };
  const applied = applyConfigUpdate(starterRaw, update);
  if (!applied.ok) return { ok: false, errors: applied.errors, notes };
  return { ok: true, nextRaw: applied.nextRaw, preview: previewUpdate(starterRaw, applied.nextRaw, update, display).filter((p) => p.supplied), notes, payload: parsed.json };
}
