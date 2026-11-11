import {
  activityKinds,
  dayParts,
  purposes,
  equipmentTypes,
  exerciseGoals,
  intensities,
  limitationStatuses,
  strengthSplits,
  trainingLocations,
} from '../plan/schema';
import { bundledInventory } from '../exercises/inventory';
import { CONFIG_SCHEMA_VERSION, fieldOf, readConfig, sectionNames, sections, type RawPlan, type SectionName } from './sections';
import { CONFIG_ENVELOPE, formatConfigText, UPDATE_END, UPDATE_HEADER } from './text';

/**
 * The text the user pastes into any chat assistant (contract 07; tested with Claude, Gemini and ChatGPT reply
 * styles, #47). Plain text and JSON only, no provider-specific features, so any assistant can follow it. Generated from the live
 * configuration and the app's own schema enums, so it can't drift from what the importer accepts.
 */
export type InstructionOptions = {
  /** Sections the AI must not change (#49 setup leaves out nutrition): hidden from the fields, config and examples. */
  exclude?: SectionName[];
  /** Text before the standard instructions (#49 setup: what the user told the app). */
  intro?: string;
  /** The last line: what the AI should do first. */
  ending?: string;
};

export function buildAiInstructions(raw: RawPlan, today: string, opts: InstructionOptions = {}): string {
  const exclude = new Set(opts.exclude ?? []);
  const allowed = sectionNames.filter((s) => !exclude.has(s));
  const config = Object.fromEntries(Object.entries(readConfig(raw)).filter(([k]) => !exclude.has(k as SectionName)));
  const fieldDocs = allowed
    .map((s) => {
      const fields = Object.keys(sections[s].fields).map((k) => {
        const f = fieldOf(s, k);
        return `  - ${k}${f.clearable ? ' (CLEAR allowed)' : ''}${f.mergeById ? ' (MERGE allowed)' : ''}${f.textUnit ? ` (optional ${f.textUnit} suffix)` : ''}: ${f.doc}`;
      });
      return `- [${s}]\n${fields.join('\n')}`;
    })
    .join('\n');

  const examples = [
    {
      title: 'Exercise only (nutrition and everything else stay unchanged):',
      json: {
        fitnessConfigUpdate: {
          schemaVersion: CONFIG_SCHEMA_VERSION,
          exercise: {
            equipment: [{ type: 'kettlebell', weightsKg: [16, 24] }, { type: 'heavy_bag' }, { type: 'home_gym', brand: 'Fortis' }],
            limitations: [
              { movement: 'biceps_curl', status: 'avoid', reason: 'elbow discomfort' },
              { movement: 'hammer_curl', status: 'allowed' },
            ],
          },
        },
      },
    },
    {
      title: 'Nutrition only:',
      json: {
        fitnessConfigUpdate: {
          schemaVersion: CONFIG_SCHEMA_VERSION,
          nutrition: { targets: [{ id: 'energy', label: 'Energy', quantity: 'energy', max: 7300 }, { id: 'protein', label: 'Protein', quantity: 'grams', min: 160, max: 180 }] },
        },
      },
    },
    {
      title: 'Changing one meal without resending the others (merge by id):',
      json: {
        fitnessConfigUpdate: {
          schemaVersion: CONFIG_SCHEMA_VERSION,
          nutrition: { meals: { merge: [{ id: 'snack', kind: 'meal', label: 'Afternoon snack', when: 'afternoon', nutrition: { energy: 900, protein: 30 } }] } },
        },
      },
    },
    {
      title: 'Nutrition and exercise together:',
      json: {
        fitnessConfigUpdate: {
          schemaVersion: CONFIG_SCHEMA_VERSION,
          nutrition: { eatingWindow: { start: '11:30', end: '19:30' } },
          exercise: { constraints: { location: 'home', gymMembership: false, maxSessionMinutes: 40 } },
        },
      },
    },
    {
      title: 'A first weekly schedule (exercise and habits, merge by id):',
      json: {
        fitnessConfigUpdate: {
          schemaVersion: CONFIG_SCHEMA_VERSION,
          schedule: {
            activities: {
              merge: [
                { id: 'walk', kind: 'exercise', label: 'Brisk walk', when: 'morning', duration: { minutes: 30 }, purpose: 'walking' },
                { id: 'strength', kind: 'exercise', label: 'Strength session', time: '18:00', duration: { minutes: 30 }, appliesTo: { days: ['mon', 'wed', 'fri'] } },
              ],
            },
          },
        },
      },
    },
  ].filter((e) => !Object.keys(e.json.fitnessConfigUpdate).some((k) => exclude.has(k as SectionName)));

  return `${opts.intro ? `${opts.intro}\n\n` : ''}# Fitness tracker: configuration session

You are helping me update the configuration of my personal fitness tracker app. Talk with me normally. Ask questions when something is unclear, and don't guess about health limits, equipment or food. When I say I'm done, reply with ONE update for the app in the exact format below.

The app owns my configuration. You only propose changes. The app validates your update, shows me a preview, and applies it only if I confirm.

Today is ${today}. Configuration schema version: ${CONFIG_SCHEMA_VERSION}.

## My current configuration

${formatConfigText(config, `BODY ANVIL CURRENT CONFIGURATION v${CONFIG_SCHEMA_VERSION}`, 'END CURRENT CONFIGURATION')}

## Update format

When I say I'm done, reply with one plain text update block. Start with ${UPDATE_HEADER} and finish with ${UPDATE_END}, each on its own line. Use [section] headings and one field: value per line. See the complete examples below.

Sections you can change: ${allowed.join(', ')}.${exclude.size ? ` Never include ${[...exclude].join(' or ')}: the app sets ${exclude.size > 1 ? 'those' : 'that'} up separately.` : ''}

The update must contain EVERY change we agreed in this conversation, in the right sections, and nothing else. Before sending, check it against my requests one by one.

Rules (the app rejects updates that break them):
1. Include ONLY the sections you are changing. A missing section is left exactly as it is. Never repeat unchanged sections.
2. Inside a section, include ONLY the fields you are changing. A field value replaces the whole field. For fields marked MERGE allowed, use field: MERGE [items] to add items or replace existing items with the same id. Each item must be complete. To remove one item, send the complete remaining list without MERGE. Use [] for an empty list where allowed.
3. To remove an optional field, write field: CLEAR only where marked CLEAR allowed. Leave omitted fields untouched.
4. Use the listed names and enum values in the same letter case. Use [a, b] for lists and {key: value, otherKey: value} for grouped values. Simple words, ids and times can be unquoted. Double-quote text with spaces or punctuation and literal words like "true", "false", "CLEAR" or "null". Escape embedded quotes, backslashes and newlines as in JSON. Use unquoted numbers, true and false for their respective types. Keep each field on one line, use each key once and omit trailing commas and comments.
5. Keep ids stable. Use lower-case-hyphen ids for plan items (meals, activities, targets, goals, measurements), and snake_case ids for movements and activity types (e.g. "hammer_curl").
6. Use the numeric units in the field descriptions and current configuration (profile.units). Use bare numbers unless a field explicitly lists an optional suffix. Weights for equipment are always kg (weightsKg). Ask before interpreting an unclear quantity.
7. Times are 24-hour HH:MM. Weekdays are mon tue wed thu fri sat sun.
8. Don't change sections I didn't talk about, even if you think they could be improved. Suggest it in the chat instead.

## Sections and fields

${fieldDocs}

## Allowed values

- exercise.equipment[].type: ${equipmentTypes.join(', ')}
- exercise.limitations[].status: ${limitationStatuses.join(', ')} ("avoid" = don't program it; "caution" = only with care; "allowed" = explicitly fine)
- exercise.activityTypes[].kind: ${activityKinds.join(', ')}
- intensity: ${intensities.join(', ')}
- exercise.goals: ${exerciseGoals.join(', ')}
- exercise.strength.split: ${strengthSplits.join(', ')}
- exercise.constraints.location: ${trainingLocations.join(', ')}
- strength/conditioning.modalities: ids from exercise.activityTypes
- sessionMinutes and duration: { "minutes": 30 } or { "min": 30, "max": 45 }
- substitutions[].use must not contain movements marked "avoid"
- purpose (activities and requirements): ${purposes.join(', ')}
- when (instead of an exact time): ${dayParts.join(', ')}
- requirements: an activity with "satisfies": "<requirementId>" is one alternative; completing any one satisfies the requirement for the day. Use this instead of scheduling several redundant activities.
- muscle groups (customExercises primary/secondary, muscleGrowth.targets): ${bundledInventory.muscleGroups.map((m) => m.id).join(', ')}
- built-in exercises (movement ids for muscleGrowth.exercises; add anything else to customExercises first): ${bundledInventory.exercises.filter((e) => e.kind === 'strength').map((e) => `${e.movement} (${e.primary.join('+')})`).join(', ')}
- session exercises: movement is a snake_case id; movements marked "avoid" are swapped for the configured substitute automatically

## Examples

Each example is a complete reply.

${examples.map((e) => {
    const { schemaVersion, ...changes } = e.json.fitnessConfigUpdate;
    return `${e.title}\n\n${formatConfigText(changes)}`;
  }).join('\n\n')}

If I explicitly ask for JSON compatibility, return one JSON object with the shape {"${CONFIG_ENVELOPE}":{"schemaVersion":${CONFIG_SCHEMA_VERSION},"<section>":{"<field>": "<value>"}}}. In JSON, CLEAR is null and MERGE is {"merge":[items]}. Use the same fields, values and omissions.

${opts.ending ?? "Start by asking me what I'd like to change."}`;
}

/** Version of the shared text's framing (#119). The configuration itself is versioned by CONFIG_SCHEMA_VERSION. */
export const CONFIG_SHARE_FORMAT = 2;

/**
 * The one payload Configure with AI shares or copies (#119): a short, versioned header, then the standard
 * instructions (current configuration, schema version, update format, rules). Self-contained, so a brand new chat
 * in any assistant has everything it needs; no history, secrets or provider-specific features. Deterministic for a
 * given plan and date, so the preview the user reads is byte-identical to what is shared.
 */
export function buildConfigShare(raw: RawPlan, today: string): string {
  return buildAiInstructions(raw, today, {
    intro: `Body Anvil configuration share · format ${CONFIG_SHARE_FORMAT} · configuration schema version ${CONFIG_SCHEMA_VERSION}\n\nI'm sharing my current Body Anvil settings so we can talk about changes. Nothing changes in the app until I paste your update back into it, review the preview and confirm.`,
  });
}
