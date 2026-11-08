import { MEAL_REPLY_SCHEMA_VERSION } from './contract';

/**
 * The prompt shared with an external AI next to the meal photo(s) (#97). Pure and fixed: it names no plan,
 * person or app account, so sharing it reveals nothing beyond the photo the user chose to share.
 */
export function mealPrompt(photoCount = 1): string {
  const photos = photoCount > 1 ? `the ${photoCount} attached photos of one meal` : 'the attached photo of a meal';
  return [
    `Estimate the nutrition of ${photos}.`,
    '',
    '1. List each food you can see. Estimate each portion (grams or ml where you can).',
    '2. For each food, estimate energy in kilojoules (kJ, not kcal), protein, carbohydrate and fat in grams.',
    '3. Say what you assumed (hidden oil, sauce, portion size) and what you are unsure of.',
    "4. If you can't estimate a value, use null. Don't guess a number you can't see evidence for.",
    '',
    `Reply with exactly one JSON object in a \`\`\`json code block, using this format (schemaVersion ${MEAL_REPLY_SCHEMA_VERSION}):`,
    '```json',
    '{',
    `  "schemaVersion": ${MEAL_REPLY_SCHEMA_VERSION},`,
    '  "mealName": "Short name for the meal",',
    '  "items": [',
    '    { "name": "Food", "quantity": 150, "unit": "g", "energyKj": 600, "proteinG": 10, "carbsG": 20, "fatG": 5 }',
    '  ],',
    '  "totals": { "energyKj": 600, "proteinG": 10, "carbsG": 20, "fatG": 5 },',
    '  "confidence": "low | medium | high",',
    '  "assumptions": ["What you assumed"],',
    '  "uncertainties": ["What you could not tell from the photo"]',
    '}',
    '```',
    'Units: g, ml, piece, slice, cup, tbsp, tsp or serving. Numbers only (no "~" or ranges); null when unknown.',
  ].join('\n');
}
