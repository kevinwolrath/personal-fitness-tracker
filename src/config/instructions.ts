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
import { CONFIG_SCHEMA_VERSION, readConfig, sectionNames, sections, type RawPlan } from './sections';

const fence = (json: unknown) => '```json\n' + JSON.stringify(json, null, 2) + '\n```';

/**
 * The text the user pastes into ChatGPT or Claude (contract 07). Plain text and JSON only, no
 * provider-specific features, so any chat assistant can follow it. Generated from the live
 * configuration and the app's own schema enums, so it can't drift from what the importer accepts.
 */
export function buildAiInstructions(raw: RawPlan, today: string): string {
  const config = readConfig(raw);
  const fieldDocs = sectionNames
    .map((s) => {
      const fields = Object.entries(sections[s].fields).map(([k, f]) => `  - ${k}${f.clearable ? ' (may be null to clear)' : ''}: ${f.doc}`);
      return `- ${s}\n${fields.join('\n')}`;
    })
    .join('\n');

  return `# Fitness tracker: configuration session

You are helping me update the configuration of my personal fitness tracker app. Talk with me normally. Ask questions when something is unclear, and don't guess about health limits, equipment or food. When I say I'm done, reply with ONE update for the app in the exact format below.

The app owns my configuration. You only propose changes. The app validates your update, shows me a preview, and applies it only if I confirm.

Today is ${today}. Configuration schema version: ${CONFIG_SCHEMA_VERSION}.

## My current configuration

${fence({ schemaVersion: CONFIG_SCHEMA_VERSION, ...config })}

## Update format

Reply with exactly one JSON code block and nothing else inside it:

${fence({ fitnessConfigUpdate: { schemaVersion: CONFIG_SCHEMA_VERSION, '<section>': { '<field>': '<new value>' } } })}

Rules (the app rejects updates that break them):
1. Include ONLY the sections you are changing. A missing section is left exactly as it is. Never repeat unchanged sections.
2. Inside a section, include ONLY the fields you are changing. Each field you include REPLACES that whole field. To add one item to a list, send the complete new list, with the existing items plus the new one.
3. To clear an optional field, set it to null (only where marked "may be null").
4. Use exactly the field names, enum values and id formats listed here. Unknown fields or values are errors. No comments, no trailing commas, and numbers as numbers, not strings.
5. Keep ids stable. Use lower-case-hyphen ids for plan items (meals, activities, targets, goals, measurements), and snake_case ids for movements and activity types (e.g. "hammer_curl").
6. Use the units of the current configuration (profile.units). Weights for equipment are always kg (weightsKg).
7. Times are 24-hour "HH:MM". Weekdays are mon tue wed thu fri sat sun.
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
- session exercises: movement is a snake_case id; movements marked "avoid" are swapped for the configured substitute automatically

## Examples

Exercise only (nutrition and everything else stay unchanged):

${fence({
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
})}

Nutrition only:

${fence({
  fitnessConfigUpdate: {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    nutrition: { targets: [{ id: 'energy', label: 'Energy', quantity: 'energy', max: 7300 }, { id: 'protein', label: 'Protein', quantity: 'grams', min: 160, max: 180 }] },
  },
})}

Nutrition and exercise together:

${fence({
  fitnessConfigUpdate: {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    nutrition: { eatingWindow: { start: '11:30', end: '19:30' } },
    exercise: { constraints: { location: 'home', gymMembership: false, maxSessionMinutes: 40 } },
  },
})}

Start by asking me what I'd like to change.`;
}
