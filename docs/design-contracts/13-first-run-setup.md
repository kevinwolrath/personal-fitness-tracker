# 13 · First-run setup (#49)

A fresh install has no plan. Before the app shell appears, the user goes through a short setup that creates **their own** plan. The bundled personal seed plan is never installed for a new user (04). Existing installs never see setup: they already have a plan.

## When it shows

- **Shown** when storage has no active plan (`loadActivePlan` returns null). It's a full-screen flow rendered by `AppProvider` instead of the app (no app bar, no menu).
- **Never again** once setup finishes: the plan it stores (`origin: onboarding`) is the active plan from then on. Nothing else marks it done, so it can't come back by accident, and existing installs are untouched (no migration).
- **Resume:** the answers and the current step are saved on the device after every change (`preferences.setupDraft`, small JSON). After a restart setup continues where it was. A pasted AI reply isn't kept, so a restart during the AI review returns to Generate. The draft is removed when setup finishes.

## Layout (option A)

Every step: **screen header** (step count, progress bar, Skip), **content** (scrolls only when it must), **fixed bottom bar** (Back, one primary action). Every question is optional; Skip goes to the next step.

1. **About you:** gender (Male, Female, Other, Prefer not to say), age band (Under 18, 18–29, 30–39, 40–49, 50–59, 60+; never a date of birth), weight as a band (kg: under 60, 60–79, 80–99, 100–119, 120+; shown in lb as under 132, 132–175, 176–219, 220–264, 265+) or an exact weight, with a kg/lb choice.
   - "A range is only a guide for the plan. It's never recorded as a weigh-in."
   - An exact weight has a checkbox **"Also log this as today's weigh-in", unticked by default**. Only an exact weight with the box ticked becomes an observation (manual, today). A band never does.
2. **Your goals:** Maintain, Lose a little weight, Gain muscle, Improve cardio. Several allowed; the first chosen is primary, "Make primary" changes it.
3. **Practical context:** days per week, time per session, where they train (several), current activity, and free text to work around (injuries, limits, food restrictions; ≤ 200 characters).
4. **Get a suggested plan:** "Copy prompt" (provider-neutral plain text for any chat assistant), paste the reply, **Check reply**. Or **"Skip for now: start with a basic profile"**. The note under it: the reply is an AI-generated suggestion, not medical advice, and every value is reviewed before anything is saved.
5. **Review:**
   - **AI path:** "Review the suggestion" with "AI-generated suggestion, not medical advice." **Assumed by the AI** (every change the reply makes, from the 07 preview, plus what the importer fixed or left out) comes first, then **From you** (each answer). Nutrition: "Not set up yet." Actions: Edit answers, Ask the AI again, **Confirm and start**.
   - **Basic path:** "Review your profile": From you, and "Weight tracking. No workouts yet." **Start tracking**.

   Nothing is stored before Confirm or Start tracking. Then the app opens on Today.

## Under 18

Choosing "Under 18" shows: "AI fitness and diet plans in this app are for people 18 and over. You can still use the app to track your activity and measurements." Setup becomes two steps (About you, then Review). There are no goals, no context and no AI step. The plan is tracking only, with `profile.ageBand: under_18`, and Today says "Tracking only" without offering to set up a plan. The importer refuses an AI reply for an under-18 profile.

## The plans it creates

- **Basic (no AI):** `buildStarterPlan`, formatVersion 6:
  - `id: my-plan`, one day type ("Every day");
  - a daily weight measurement;
  - no activities, goals, quick logs or nutrition targets;
  - `profile` holding exactly what the user answered and nothing invented;
  - units from the kg/lb choice (lb → kcal and inches; kg → kJ and cm).
- **AI:** the reply is a normal 07 configuration update applied to that starter plan: same fault-tolerant importer (#47), same validation, same preview, applied atomically. The user's answers stay as they are unless the reply changes them, and then the review shows it as assumed.
- **Today without a plan:** the "Do this next" slot shows a quiet card: "No plan yet. Weight tracking is ready…" with **Set up a plan with AI** (opens Configure with AI).

## The AI prompt

`buildSetupPrompt` is the 07 instructions (`buildAiInstructions`) with:

- an introduction listing what the user told the app (only that);
- a request to ask first, not guess about health limits, and suggest a gentle, achievable plan;
- "This is a suggestion, not medical advice. If something I want needs a doctor or other health professional, tell me in the chat."

No provider names. No claim that any AI provider takes legal responsibility. No medical claims.

## Nutrition seed (pending)

Nutrition initialisation is a provider, `NutritionSeed` (`src/onboarding/nutritionSeed.ts`): `apply(plan, profile)`, `prompt(profile)` and `allowsAiNutrition`. Today the only provider is **none**:

- no default diet, meals or energy targets;
- the prompt says to leave nutrition out, and hides the nutrition section and its examples;
- a nutrition section in the reply is dropped, and the review says so.

The nutrition seed specification will register a provider with `setNutritionSeed` without changing the wizard, its prompt builder or its review. Example nutrition values in the code base are never used as defaults.
