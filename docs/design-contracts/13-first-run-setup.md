# 13 · First-run setup (#49, #53)

A fresh install has no plan. Before the app shell appears, the user goes through a short setup that creates **their own** plan. The bundled personal seed plan is never installed for a new user (04). Existing installs never see first-run setup; they can rerun it from the menu (**Edit setup answers**).

## When it shows

- **First run:** when storage has no active plan (`loadActivePlan` returns null), `AppProvider` renders the wizard instead of the app (no app bar, no menu).
- **Never again** once it finishes: the plan it stores (`origin: onboarding`) is the active plan from then on. Existing installs are untouched (no migration).
- **Resume:** the answers, the step and the review choices are saved on the device after every change (`preferences.setupDraft`, small JSON; drafts from #49 start fresh). A pasted AI reply isn't kept. The draft is removed when setup finishes.
- **Edit setup answers:** the `/setup` full-screen route (02). It starts from the current plan's saved answers and never persists a draft.

## Layout

Every step: **screen header** (step count, progress bar, Skip), **content** (scrolls only when it must), **fixed bottom bar** (Back, one primary action). Every question is optional; Skip goes to the next step. Touch targets are at least 44 pt.

1. **About you**
   - **Gender:** Male, Female, Other. "Other" includes non-binary. Gender is stored only; it never changes a plan or a number, and "Other" is never mapped to male or female.
   - **Age:** three adult bands showing their ages (18–39, 40–59, 60+), or **Enter a specific age**. Never a date of birth.
   - **Under 18:** a checkbox right under the age question, "Under 18? Tracking only" (screen-reader label "I'm under 18: tracking only"). A specific age under 18 has the same effect.
   - **Weight:** three bands (kg: under 70, 70–99, 100+; lb: under 155, 155–219, 220+), or **Enter a specific weight**, with kg/lb. A band is a rough guide only: never a weigh-in, an exact weight or a BMI. A specific weight has "Also log this as today's weigh-in", **unticked by default**.
   - **Height:** optional (cm, or inches for lb). Only used for BMI, together with an exact weight.
2. **Goals:** Maintain weight, Gradual weight loss, Faster weight loss, Gain muscle, Improve cardio.
   - Gradual and faster loss exclude each other, and maintain excludes both.
   - Also asked: activity now, days per week (at most), equipment (None, Bands, Dumbbells or kettlebell, Gym), "Go easy on" (knees, back, shoulders), dietary needs and allergies (vegetarian, vegan, dairy-free, gluten-free, nut allergy), and free text.
   - Changing an answer resets the review choices.
3. **Your starter plan** (option B): **Exercise | Meals** tabs and an "Option n of 3" chooser in a fixed area under the header, then the list.
   - **Exercise:** three options (Balanced, More strength, More cardio). Each activity can be removed and added back. The rest days are stated.
   - **Meals:** three sample days. **Swap** opens an inline list of the safe alternatives for that meal (no nested modal), each with **Use**, plus **Leave it unplanned**. A meal with no safe template shows why it is unplanned.
   - **Refine with AI (optional):** an inline step to copy a provider-neutral prompt and paste the reply. The reply goes through the 07 importer and validation. The review then shows "AI version" with every change it made and "Use the presets instead".
   - Primary: **Start with this plan** (first run) or **Replace my plan** (editing, which first asks "Replace your current plan?").

   Nothing is stored before then.

## The starter plan (offline, `buildStarterPlan`)

Adults always get a usable plan without AI, built from bundled data in `presets/`:

- **Exercise** (`presets/exercise-routines.json`, `src/presets/exercisePlan.ts`):
  - four beginner full-body routines (no equipment, bands, weights, gym), each with a short version;
  - walking, steady cardio, cardio intervals and an optional stretch.
- **Inputs:** goals, activity now, equipment, limits and days per week.
- **Recovery is built in:**
  - at most 6 training days, so there's always at least one rest day;
  - strength days are never consecutive;
  - "Faster loss" adds activity, never a bigger food cut.
- **Limits** use the plan's own `exercise.limitations` and `substitutions`, so avoided movements are swapped on every session.
- **Meals** (`presets/meal-templates.json`, `src/presets/meals.ts`):
  - affordable, varied breakfast, lunch, dinner and snack templates;
  - simple ingredients with hand-sized portions (palm, fist, cupped hand, thumb), plus preparation and swap notes.
- **What the meals are not:**
  - **no energy or nutrient values or targets** anywhere;
  - suggestions only (`required: false`), never logged intake: ticking a planned meal records the plan item as done, not food eaten.
- **Dietary needs and allergies are strict.** Each template lists what it `contains` (meat, fish, dairy, egg, gluten, nuts; peanuts count as nuts), and only safe templates are offered: in the first choice, in all three sample days and in every swap. A slot with no safe template stays **unplanned**; nothing is invented. Faster loss plans three meals (no snack).
- **Other plan content:** a daily weight measurement and the `profile` (only what the user answered). Units follow kg/lb (lb → kcal and inches).
- **Under 18:** tracking only. No activities, no exercise section and no AI. The schema also rejects weight-loss goals with `ageBand: under_18`.

## Editing setup on an existing plan

**Edit setup answers** (☰ menu) never touches a customised plan unless the user explicitly asks it to. After the questions, the last step is **Save your answers**:

- **Save profile** (the primary action, `profileOnly`): only the setup answers in `profile` change, as the next revision through the 07 history (`sections: ['profile']`, undoable).
  - **Untouched:** schedule, day types, activities, meals, requirements, nutrition targets, measurement goals, measurements and units. An exact weight typed in the other unit is converted to the plan's unit.
  - **Profile entries setup doesn't own** (such as `displayName`) are kept.
- **Rebuild starter plan instead** (an explicit secondary action, `replanExisting`): shows the starter plan with the Exercise and Meals tabs.
  - **"What will change" first:** activities removed and added, day types that become one "Every day" schedule, requirements removed, and what is kept.
  - **Replace my plan** asks "Replace your current plan?" before applying anything.
  - **The result:** a new revision of the **same plan id**, so day logs stay attached, through the 07 history (`sections: ['setup']`), so it can be undone.
  - **Kept:** measurements (with weight added if missing), measurement goals, nutrition targets (day-type limits removed), quick logs, due times and units other than mass.

Both paths keep every observation, import, activity log, completion event and earlier revision. Cancel, Back or declining the confirmation leave the plan exactly as it was.

## Meal safety and wording

- **On the Meals tab and on each planned meal:** sample meals are **general suggestions, not a personalised nutrition plan and not food the user has logged**.
- **Portions:** hand-sized portions are a rough guide and **don't guarantee enough energy or protein**.
- **Allergens:** filtering by ingredient type can't guarantee a meal is free of an allergen. The Meals tab, the swap list and each meal's detail tell the user to **check ingredients and allergen labels themselves**.
- **Tags are conservative:** an optional or alternative ingredient counts, and soy sauce counts as gluten. A test reads every template's ingredient names and fails if an implied tag (gluten, dairy, egg, meat, fish, nuts, soy, sesame) is missing. Soy and sesame are recorded but not yet filterable.
- **Release:** a qualified dietitian should review the templates and their guidance before public release.

## Nutrition hook

Meals come from the active `NutritionSeed` (`src/onboarding/nutritionSeed.ts`): `mealOptions(diet)`, `prompt(profile)` and `allowsAiNutrition`. The default is the bundled templates. The future nutrition specification registers its own provider with `setNutritionSeed`, without changing the wizard, its prompt or its review. Until then:

- the AI prompt hides the nutrition section and its examples, and tells the AI to leave nutrition out;
- a nutrition section in a reply is dropped, and the review says so.

## The AI prompt

`buildSetupPrompt` is the 07 instructions with:

- an introduction listing what the user told the app and the current starter plan;
- a request to ask first and not guess about health limits;
- "This is a suggestion, not medical advice…".

No provider names. No claim that any AI provider takes legal responsibility. No medical claims.
