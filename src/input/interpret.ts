import { parseConfigUpdate, applyConfigUpdate, type ConfigUpdate } from '../config/update';
import { CONFIG_SCHEMA_VERSION, type RawPlan } from '../config/sections';
import { readConfigText, UPDATE_END, UPDATE_HEADER } from '../config/text';
import { MAX_INPUT_CHARS } from '../config/import/recover';
import { bundledInventory } from '../exercises/inventory';
import type { MealItem } from '../nutrition/contract';
import { limits } from '../nutrition/contract';
import { convert, namedUnit, unitsUpdate, unitWords, type Units } from './units';
import { unitsSchema, type Plan } from '../plan/schema';

export type Outcome = 'ACCEPT' | 'IGNORE' | 'CLARIFY' | 'REJECT';
export type IntentKind = 'configuration_update' | 'meal_entry' | 'exercise_update' | 'clarification' | 'irrelevant_text' | 'unsupported_operation';
export type Intent = {
  kind: IntentKind;
  outcome: Outcome;
  source: string;
  fields: Record<string, unknown>;
  message: string;
  update?: ConfigUpdate;
  items?: MealItem[];
};
export type Interpretation = { intents: Intent[]; recovered: string[] };

const normalized = (text: string) => text.toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();
const number = (text: string) => Number(text.replace(/,/g, '').replace(/−/g, '-'));
const energyPattern = /([+−-]?(?:\d[\d,]*(?:\.\d+)?|\.\d+))\s*(kilojoules?|kj|kilocalories?|kcal|calories)\b/gi;
const unitPattern = new RegExp(`\\b(${unitWords})\\b`, 'gi');
const foodWords = /\b(rice|chicken|beef|fish|tofu|beans|lentils|bread|pasta|potato(?:es)?|salad|eggs?|oats?|yogu?rt|milk|fruit|apple|banana|soup|sandwich|pizza|meal|food)\b/i;

function intent(kind: IntentKind, outcome: Outcome, source: string, fields: Record<string, unknown>, message: string): Intent {
  return { kind, outcome, source, fields, message };
}

function validated(source: string, update: ConfigUpdate, raw: RawPlan | undefined, kind: IntentKind = 'configuration_update'): Intent {
  const parsed = parseConfigUpdate(JSON.stringify({ fitnessConfigUpdate: { schemaVersion: update.schemaVersion, ...update.sections } }));
  if (!parsed.ok) return intent(kind, 'REJECT', source, update.sections, parsed.errors.join('\n'));
  const applied = raw ? applyConfigUpdate(raw, parsed.update) : null;
  if (applied && !applied.ok) return intent(kind, 'CLARIFY', source, update.sections, applied.errors.join('\n'));
  return { ...intent(kind, 'ACCEPT', source, update.sections, 'Review the proposed configuration changes before applying.'), update: parsed.update };
}

function meal(source: string): Intent | null {
  if (!/^(?:please\s+)?(?:add|log|record|ate|eat|i ate|i have eaten)\b/i.test(source)) return null;
  const text = source.replace(/(\d)[ \u00a0](?=\d{3}(?:\D|$))/g, '$1,');
  const amounts = [...text.matchAll(energyPattern)];
  if (!foodWords.test(source) && !amounts.length) return null;
  let name = text.replace(/^(?:please\s+)?(?:add|log|record|ate|eat|i ate|i have eaten)\s+/i, '')
    .replace(energyPattern, '').replace(/^\s*(?:of\s+)?/i, '')
    .replace(/\s+(?:to|for|in)\s+(?:(?:my|your|the|a)\s+)?(?:meal|lunch|dinner|breakfast)\b.*$/i, '').trim();
  name = name.replace(/\s+(?:of|at)$/i, '').trim();
  name = name.replace(/^["“](.*)["”]$/, '$1');
  const quantity = /(?:^|\s)(-?(?:\d+(?:\.\d+)?|\.\d+))\s*(kg|kilograms?|g|grams?|ml|millilitres?|cups?|slices?|pieces?|servings?)\b/i.exec(name);
  if (quantity) name = name.replace(quantity[0], '').replace(/^\s*of\s+/i, '').trim();
  if (amounts.length > 1) return intent('meal_entry', 'CLARIFY', source, { food: name }, 'Give one energy amount for this food, or separate the foods into individual instructions.');
  if (!name || /^(?:meal|food)$/i.test(name)) return intent('meal_entry', 'CLARIFY', source, {}, 'What food would you like to log?');
  if (/^-?[\d.]/.test(name)) return intent('meal_entry', 'CLARIFY', source, { food: name }, 'Specify a supported unit for the food quantity.');
  if (name.length > limits.name || /[<>{}=]/.test(name)) return intent('meal_entry', 'REJECT', source, {}, 'The food name contains unsupported markup or exceeds the meal field limit.');
  const amount = amounts[0];
  if (amount?.[1].includes(',') && !/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(amount[1])) return intent('meal_entry', 'CLARIFY', source, { food: name }, 'Confirm the energy amount using consistent thousands separators.');
  const energy = amount ? { value: number(amount[1]), unit: namedUnit(amount[2]) } : null;
  const energyKj = energy ? convert(energy.value, energy.unit, 'kJ', 'energy') : null;
  if (energyKj !== null && (!Number.isFinite(energyKj) || energyKj < 0 || energyKj > limits.itemNutrient.energyKj)) {
    return intent('meal_entry', 'REJECT', source, { food: name, energy }, 'The energy amount is outside the existing meal limits.');
  }
  const quantityUnit = quantity ? /^(kg|kilogram)/i.test(quantity[2]) ? 'g' : quantity[2].toLowerCase().replace(/s$/, '').replace(/^gram$/, 'g').replace(/^millilitre$/, 'ml') : null;
  const quantityValue = quantity ? number(quantity[1]) * (/^(kg|kilogram)/i.test(quantity[2]) ? 1000 : 1) : null;
  if (quantityValue !== null && (quantityValue < 0 || quantityValue > limits.quantity)) return intent('meal_entry', 'REJECT', source, { food: name }, 'The food quantity is outside the existing meal limits.');
  const item: MealItem = { name, quantity: quantityValue, unit: quantityUnit, energyKj, proteinG: null, carbsG: null, fatG: null };
  return { ...intent('meal_entry', 'ACCEPT', source, { food: name, energy, energyKj, quantity: quantityValue, unit: quantityUnit }, 'Review this food in meal logging. Unknown quantities and nutrients remain empty.'), items: [item] };
}

function exercise(source: string, raw?: RawPlan): Intent | null {
  if (!/^(?:please\s+)?(?:increase|change|set|update|log|record|i did)\b/i.test(source)) return null;
  const movement = bundledInventory.exercises.find((entry) => {
    const name = normalized(entry.name).replace(/ machine$/, '');
    return normalized(source).includes(name) || normalized(source).includes(normalized(entry.movement));
  });
  if (!movement) return null;
  const load = /\bto\s+(-?\d+(?:\.\d+)?)\s*([a-z]+)\b/i.exec(source);
  const fields = { movement: movement.movement, ...(load ? { load: { value: number(load[1]), unit: load[2].toLowerCase() } } : {}) };
  if (/^(?:please\s+)?(?:log|record|i did)\b/i.test(source)) return intent('exercise_update', 'CLARIFY', source, fields, 'Log completed exercise in the workout workflow with its sets, reps or duration and date. Confirm these details before saving.');
  if (!load || toLoadKg(load[1], load[2]) === null) return intent('exercise_update', 'CLARIFY', source, fields, 'Specify the load in kg or lb. For slabs or plates, supply their weight and identify the session to change.');
  if (!raw) return intent('exercise_update', 'CLARIFY', source, fields, 'Choose the configured session to update.');
  const activities = (raw.activities ?? []) as Plan['activities'];
  const matches = activities.filter((activity) => activity.session?.exercises.some((entry) => entry.movement === movement.movement) || activity.session?.short?.exercises.some((entry) => entry.movement === movement.movement));
  const named = matches.filter((activity) => [activity.id, activity.label].some((name) => ` ${normalized(source)} `.includes(` ${normalized(name)} `)));
  const selected = named.length ? named : matches;
  if (selected.length !== 1) return intent('exercise_update', 'CLARIFY', source, fields, 'Identify the session and full or short workout whose prescribed load should change.');
  const activity = selected[0];
  const short = /\bshort (?:workout|session|version)\b/i.test(source);
  if (activity.session!.short && !short && !/\bfull (?:workout|session|version)\b/i.test(source)) return intent('exercise_update', 'CLARIFY', source, fields, 'Choose the full or short workout version.');
  const target = short ? activity.session!.short : activity.session;
  if (!target || target.exercises.filter((entry) => entry.movement === movement.movement).length !== 1) return intent('exercise_update', 'CLARIFY', source, fields, 'Identify the specific exercise entry whose load should change.');
  const exercises = target.exercises.map((entry) => entry.movement === movement.movement ? { ...entry, loadKg: toLoadKg(load[1], load[2])! } : entry);
  const session = short ? { ...activity.session!, short: { ...target, exercises } } : { ...activity.session!, exercises };
  const update: ConfigUpdate = { schemaVersion: CONFIG_SCHEMA_VERSION, sections: { schedule: { activities: { merge: [{ ...activity, session }] } } } };
  return { ...validated(source, update, raw, 'exercise_update'), fields };
}

function toLoadKg(value: string, unit: string): number | null {
  if (!/^(kg|kgs|kilograms?|lb|lbs|pounds?)$/i.test(unit)) return null;
  return convert(number(value), namedUnit(unit), 'kg', 'mass');
}

/** Pure interpretation. Every accepted action is a proposal for an existing review workflow. */
export function interpretInput(input: string, raw?: RawPlan): Interpretation {
  if (input.length > MAX_INPUT_CHARS) return { intents: [intent('unsupported_operation', 'REJECT', input, {}, 'The input exceeds the existing import size limit.')], recovered: [] };
  const strict = parseConfigUpdate(input);
  if (strict.ok) {
    const block = /BODY ANVIL UPDATE v\d+\s*[\s\S]*?END UPDATE/i.exec(input);
    const outside = block ? input.replace(block[0], '').replace(/```\w*|~~~/g, '').trim() : '';
    const others = outside ? interpretInput(outside, raw) : { intents: [], recovered: [] };
    return { intents: [validated(input, strict.update, raw), ...others.intents], recovered: [...strict.notes, ...others.recovered] };
  }
  if (/fitnessConfigUpdate|BODY\s+ANVIL\s+UPDATE|END UPDATE|START_CONFIG/i.test(input) || /^\s*[{[]/.test(input)) {
    const fragment = /^\s*\[[A-Za-z][A-Za-z _-]*\]\s*\r?\n/.test(input);
    const recovered = readConfigText(fragment ? `${UPDATE_HEADER}\n${input}\n${UPDATE_END}` : input, true);
    if (recovered.ok) {
      const parsed = parseConfigUpdate(JSON.stringify(recovered.value));
      if (parsed.ok) return { intents: [validated(input, parsed.update, raw)], recovered: [fragment ? 'Read the section fragment using the current configuration schema.' : 'Matched section and field names, enum values, punctuation and spacing to the existing schema.'] };
    }
    return { intents: [intent('configuration_update', 'REJECT', input, {}, strict.errors.join('\n'))], recovered: [] };
  }
  const intents: Intent[] = [];
  const units: Partial<Units> = {};
  let unitProblem: string | null = null;
  const recovered: string[] = [];
  const clauseInput = input.replace(new RegExp(`,\\s+(?=(?:${unitWords})\\b|(?:add|use|change|set|log)\\b)`, 'gi'), '; ');
  const clauses = clauseInput.trim().split(/\s+(?:and|then|but)\s+|[;\n]+|[!?]+(?:\s|$)|\.(?:\s+|$)/i).map((text) => text.trim().replace(/[,!.?]+$/, '')).filter(Boolean);
  if (clauses.length > 256) return { intents: [intent('unsupported_operation', 'REJECT', input, {}, 'Review at most 256 instructions at a time.')], recovered: [] };
  let unitCommand = false;
  let mealCommand = false;
  const negatedDimensions = new Set<string>();
  for (const clause of clauses) {
    const source = clause.replace(/^(?:can|could|would)\s+you\s+(?:please\s+)?/i, '');
    if (/^(?:should|is it|what|how|why)\b/i.test(source) && /\b(?:weight|energy|unit|meal|food|exercise)\b/i.test(source)) {
      intents.push(intent('clarification', 'CLARIFY', source, {}, 'Confirm a specific change or logging action to review.'));
      continue;
    }
    if (/^(?:do not|don't|never)\s+(?:add|log|change|use)\b/i.test(source)) {
      for (const previous of intents) {
        if (previous.kind === 'meal_entry' && source.toLowerCase().includes(String(previous.fields.food).toLowerCase())) {
          previous.outcome = 'CLARIFY';
          previous.message = 'Conflicting food instructions. Confirm whether to include this food.';
          delete previous.items;
        }
      }
      if (/\b(?:weight|mass)\b/i.test(source)) negatedDimensions.add('mass');
      if (/\benergy\b/i.test(source)) negatedDimensions.add('energy');
      if (/\b(?:height|length)\b/i.test(source)) negatedDimensions.add('length');
      if (Object.keys(units).some((dimension) => negatedDimensions.has(dimension))) unitProblem = 'Confirm whether the requested unit change should be made.';
      intents.push(intent('irrelevant_text', 'IGNORE', source, {}, 'Kept the negated instruction as text.'));
      continue;
    }
    if (/\b(?:if|unless|maybe|or)\b/i.test(source) && /^(?:please\s+)?(?:add|change|set|increase|log|use)\b/i.test(source)) {
      intents.push(intent('clarification', 'CLARIFY', source, {}, 'Confirm the intended action and value before applying a conditional or alternative instruction.'));
      continue;
    }
    if (/^(?:please\s+)?(?:ignore|execute|run|delete|erase|send|upload|install|override|reset)\b|<script|\b(?:eval|fetch)\s*\(/i.test(source)) {
      intents.push(intent('unsupported_operation', 'REJECT', source, {}, 'This operation is outside the supported review workflows.'));
      continue;
    }
    const isUnitCommand = /\b(?:use|change|set|switch|display)\b/i.test(source) || unitCommand;
    const dimension = /\b(?:weight|mass)\b/i.test(source) ? 'mass' : /\b(?:energy|calories)\b/i.test(source) ? 'energy' : /\b(?:height|length)\b/i.test(source) ? 'length' : null;
    const words = [...source.matchAll(unitPattern)].map((match) => namedUnit(match[1]));
    if (isUnitCommand && dimension && (/\bunits?\b|\buse\b|\bfor\b|\bswitch\b/i.test(source))) {
      unitCommand = true;
      if (negatedDimensions.has(dimension)) unitProblem = 'Confirm whether the requested unit change should be made.';
      else if (words.length !== 1 || !unitsSchema.shape[dimension].safeParse(words[0]).success) unitProblem = `Specify one supported ${dimension} unit.`;
      else if (units[dimension] && units[dimension] !== words[0]) unitProblem = `Conflicting ${dimension} units. Choose one unit.`;
      else Object.assign(units, { [dimension]: words[0] });
      continue;
    }
    const inheritedFood = mealCommand && foodWords.test(source) && !/\b(?:swim|jump|run|delete|change|use|increase)\b/i.test(source) && !/^(?:add|log|record|i|please)\b/i.test(source);
    const food = meal(inheritedFood ? `add ${source}` : source);
    if (food) {
      if (intents.some((previous) => /^(?:do not|don't|never)/i.test(previous.source) && previous.source.toLowerCase().includes(String(food.fields.food).toLowerCase()))) {
        food.outcome = 'CLARIFY'; food.message = 'Conflicting food instructions. Confirm whether to include this food.'; delete food.items;
      }
      if (/\b(?:yesterday|tomorrow|\d{4}-\d{2}-\d{2})\b/i.test(source)) {
        food.outcome = 'CLARIFY'; food.message = 'Choose the logging date in the meal workflow before adding this food.'; delete food.items;
      }
      intents.push({ ...food, source }); mealCommand = true; continue;
    }
    mealCommand = false;
    const height = /^(?:please\s+)?(?:set|change|update)\s+(?:my\s+)?height\s+(?:to\s+)?(-?\d+(?:\.\d+)?)\s*(cm|centimet(?:er|re)s?|in|inches|inch)\s*$/i.exec(source);
    if (height) {
      intents.push(validated(source, { schemaVersion: CONFIG_SCHEMA_VERSION, sections: { profile: { heightCm: convert(number(height[1]), namedUnit(height[2]), 'cm', 'length') } } }, raw));
      continue;
    }
    const training = exercise(source, raw);
    if (training) { intents.push(training); continue; }
    const unknownEntry = /^(?:please\s+)?(?:add|log|record)\s+/i.test(source) && !/\b(?:database|tables|server|wallet)\b/i.test(source);
    if (unknownEntry || /\b(?:weight|height|meal|exercise|workout|unit|calories)\b/i.test(source) && /^(?:please\s+)?(?:add|change|set|increase|decrease|log|record|update|use)\b/i.test(source)) {
      intents.push(intent('clarification', 'CLARIFY', source, {}, 'Specify the value, its unit, and whether this changes your plan or records an event.'));
    } else {
      intents.push(intent('irrelevant_text', 'IGNORE', source, {}, 'No supported instruction recognized.'));
    }
  }
  if (Object.keys(units).length || unitProblem) {
    if (unitProblem || !raw) intents.unshift(intent('configuration_update', 'CLARIFY', input, { units }, unitProblem ?? 'Load the current configuration before changing units.'));
    else intents.unshift(validated(input, { schemaVersion: CONFIG_SCHEMA_VERSION, sections: unitsUpdate(raw, units) }, raw));
  }
  if (!intents.length) intents.push(intent('irrelevant_text', 'IGNORE', input, {}, 'No supported instruction recognized.'));
  if (intents.reduce((count, entry) => count + (entry.items?.length ?? 0), 0) > limits.items) {
    for (const entry of intents.filter((result) => result.items)) {
      entry.outcome = 'REJECT'; entry.message = `A meal supports at most ${limits.items} foods.`; delete entry.items;
    }
  }
  if (intents.some((entry) => entry.outcome === 'ACCEPT') && intents.some((entry) => entry.outcome === 'IGNORE')) recovered.push('Kept recognized instructions and ignored unrelated text.');
  return { intents, recovered };
}
