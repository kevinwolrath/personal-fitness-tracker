# 15 · Photo meal logging (#97)

Replace a scheduled meal with what was actually eaten: photograph it, ask any AI app for an estimate, paste the reply back, check it and save. The app never calls an AI and never uploads anything itself.

## Entry (content layer)

- **Do this next**, when the due item is a meal: an outlined **📷 Take photo** button under **Done** (#183: the one-flow path below; it replaced "Log different meal" on the card). Done stays the card's one primary action. The card grows by one button; the screen header is unchanged, so the 200 px budget (02) holds.
- **Every meal's sheet** (the row's `›`): **📷 Take photo**, then a quiet **Other ways to log** (the wizard below: gallery, paste, enter), after Mark done (or after Restore when skipped). So any scheduled meal on today or a past day can be replaced. Future days are view-only (04): the route falls back to today for a future date.

## One flow: Take photo → AI → Body Anvil (#183)

The default, minimum-interaction path. No wizard, prompt copying, paste, preview or confirmation.

1. **Take photo** opens the camera at once. Cancelling it returns to where you were, with nothing kept. A denied camera or a phone that can't share says so in a toast on the day.
2. On capture, the photo is kept in app storage (as above) and the slot is remembered: the date, the scheduled meal and a fixed meal id, in `meal-photos/pending-share.json`. Then the Android share chooser opens at once with **the photo and the prompt in one share**: `ACTION_SEND` with `EXTRA_STREAM` (a cache copy through `react-native-share`'s file provider, with a read grant) and `EXTRA_TEXT`, through `createChooser`. The prompt (`QUICK_MEAL_PROMPT`) asks for automatic analysis and a shareable plain-text block in the first reply: a short description, total kJ and protein g, no JSON.
3. The user shares the AI's block to **Body Anvil**. The app is a `text/*` `SEND` target (`expo-share-intent`, Android; the main activity is `singleTask`). Cold start and a running app both land on the return page; the share is cleared once handled.
4. **Return page** (`/meal-return`, full-screen modal): `ModalHeader` "Log meal" (**Cancel**), a context line ("Replaces Fixed lunch · Mon, 2 Nov" or "Extra meal · …"), **Description** and **Energy (kJ)**, prefilled by the existing parser (`applyReply` → the natural-language interpreter, #179, and its rolling corpus; JSON as a fallback) and editable inline, and one primary **Save** in a fixed bottom bar.
   - Protein, when parsed, is kept and stated in one line ("Protein ≈ 45 g from the estimate is kept"). It is never asked for and never blocks Save.
   - An inline error appears only for a field that couldn't be read (with the parser's reason, e.g. a range) or that's invalid on Save. Required: a description (at most 80 characters) and energy from 1 to 30,000 kJ.
   - **Slot:** the remembered one when it's from the last 24 hours and for today or a past day. Otherwise the safe default is an extra meal today, which replaces nothing.
   - **Save once:** the fixed id, a double-tap guard, and a scheduled meal that already has a replacement reuses its id (no double counting). A new replacement marks the scheduled meal done in the same write (Replace semantics, below). The photo is attached and the AI's values as written go in the notes.
   - After Save, the page closes back to the meal's day.
5. What an AI app does with the shared text (whether it analyses at once, and whether its answer has a Share button) is up to that app. Body Anvil can't guarantee it.

## The wizard (`/meal-photo`, layout B)

Reached from the meal sheet's **Other ways to log**, and from Edit meal.

A full-screen modal route (`?date=…&activity=…`, or `?edit=<mealLogId>`), one step per screen:

1. **Add a photo:** Take a photo (camera), Choose from gallery (up to 6), or **Paste an AI estimate** (#179: straight to step 4 with no photo; Back from step 4 then returns here). A denied camera permission explains itself, offers **Open settings** when the system won't ask again, and keeps the gallery available. **No photo? Enter the numbers yourself** skips to the review.
2. **Check the photos:** thumbnails; tap for full screen; delete; retake or add more (up to 6).
3. **Ask an AI:** **Share with AI** copies the prompt to the clipboard, then opens the system share sheet with the photo. Android's share (and `expo-sharing`) can't carry text with an image, so the prompt is never silently dropped: the screen says it is copied, and **Copy prompt only** and **See the prompt** are separate. Further photos are shared one at a time ("Share photo 2 of 3"). If sharing isn't available, the prompt is copied and the screen says to attach the photo in the AI app.
4. **Paste the reply:** a text box and **Paste from clipboard**; **Check reply**. Plain text with the meal's totals is the default input (#179); the JSON reply is the advanced path. One actionable message on failure; the paste is kept. **Enter the numbers myself instead** is always there.
5. **Check the estimate.** For a plain-text estimate (#179) it opens on a readable summary: "<Meal type> — <date>", the description, "Estimated: 2,650 kJ · 45 g protein" ("—" for a value left empty) and "An AI's estimate, not a measurement", with **Edit** (the fields below) and **Confirm**. Values left empty are listed under "Check before saving" with **Enter the missing values**. Otherwise, and on Edit: meal name, the AI's confidence, the caveat, totals tiles (≈, from the foods), totals warnings, the parser's notes, editable foods (name, amount, unit, kJ, protein, carbs, fat), add/remove food, assumptions and uncertainties, photos. **Save meal** (or **Save changes**).

- **Header:** `ModalHeader` with **Cancel** on the left whenever something would be lost (Close otherwise) and the step's title. A step strip and "Step n of 5 · Replaces <meal> · <date>" sit under it. **Back** and the step's primary action are in a fixed bottom bar (02 "Modal vertical budget"); Back is never in the header, so 02's header rule is unchanged.
- **Cancel** asks first ("Discard this meal?"). It deletes only photos taken in this draft; a saved meal's photos are untouched.

## Draft and reliability

- The draft (`src/nutrition/draft.ts`, versioned) is written on every change: natively to `meal-photos/draft.json` in the document directory, on web to `localStorage`. Leaving for the AI app, the OS killing the app, or a restart all return to the same step, photos and paste. Opening the wizard for the same meal resumes it; another meal's unsaved draft is offered (**Continue** / **Discard**), never dropped silently. A damaged or other-version draft is ignored.
- **Duplicate saves:** the meal's id is fixed when the draft starts, so saving twice writes the same record; Save is also guarded against a double tap.
- **No duplicate replacements (#179):** opening Log different meal for a scheduled meal that already has a logged replacement on that day edits that meal log (same id) instead of starting a second one.
- **Missing images:** a photo whose file is gone shows "Photo missing" and can be deleted; it is never shared.

## Photos and privacy

- Copied into **permanent app-private storage** (`<documentDirectory>/meal-photos/`), never the cache. Web (test surface): a data URI per photo in `localStorage`, referenced as `pft-photo:<id>`.
- **Never deleted automatically on save.** Deleted only when the user deletes a photo, removes the meal, or cancels a draft that took it. Removing a saved photo while editing takes effect on Save.
- No upload, no API call: a photo leaves the phone only through the share sheet, to the app the user picks. The screens say so.
- The export (06) lists photos by their on-device location only, never image data.

## Prompt and reply contract (`schemaVersion` 1)

The prompt (`src/nutrition/prompt.ts`) is fixed and names no person or plan. It asks for visible foods, portions, kJ (not kcal), protein, carbohydrate and fat, assumptions and uncertainties, `null` instead of guesses, and exactly one fenced JSON object:

```json
{ "schemaVersion": 1, "mealName": "…",
  "items": [{ "name": "…", "quantity": 150, "unit": "g", "energyKj": 600, "proteinG": 10, "carbsG": 20, "fatG": 5 }],
  "totals": { "energyKj": 600, "proteinG": 10, "carbsG": 20, "fatG": 5 },
  "confidence": "low | medium | high", "assumptions": ["…"], "uncertainties": ["…"] }
```

Any number may be `null` (unknown).

**Minimal JSON (#179).** The canonical minimal form is one meal with its totals and no food list:

```json
{ "schemaVersion": 1, "mealName": "Beef curry and dhal", "energyKj": 2650, "proteinG": 45 }
```

It imports as one entry (the totals may also sit in `"totals"`). `schemaVersion` may be left out: it is read as 1 and the review says so. Key spellings are matched case- and punctuation-insensitively, so documented numbers are never blank: `energyKj`/`energy_kj`/`kj`/`kilojoules`; kcal as `energyKcal`/`kcal`/`calories`/`cal` (converted, and listed); `proteinG`/`protein`/`protein_g`; `carbsG`/`carbs`/`carbohydrates`; `fatG`/`fat`. `"energy": "633 kcal"` or `"2650 kJ"` is read with its unit; a bare `"energy": 2650` has no unit and is left empty with a reason. An object with neither foods nor totals gets one message asking for the meal's total energy and protein.

## Plain-text estimates (#179)

The default input. An AI's answer in words, for example "Dinner: beef curry and dhal — ~2,650 kJ, 45 g protein", is read as **one meal** by `src/input/mealEstimate.ts`, part of the natural-language interpreter (`src/input/interpret.ts`) and tested by its rolling corpus (`fixtures/input/corpus.jsonl`).

- **Reads:** the meal type (breakfast, lunch, dinner or snack), a description (after "Dinner:", else the first line of prose, else what's left of the nutrition line), the date if given (ISO, "13 November 2026", "Nov 13", "13/11/2026"), total energy (kJ, or kcal converted to kJ) and total protein in g. Any order, case and punctuation; "~", "about", "approx", "estimated"; "2,650", "2 650" or "2650kj"; across lines; chatter around it is ignored. An optional per-food breakdown is kept by name only.
- **Never invents a number.** A value that isn't given stays empty. A range ("2,400–2,900 kJ"), two different totals, or kJ and kcal that disagree by more than 3% leave that value empty. So does a breakdown without a total line, which is never summed. Each case gets a message saying why. A total line ("Total: …") wins over a breakdown.
- **Not an estimate:** commands ("add 1000 kJ of rice"), configuration updates, JSON and unrelated text stay with the rest of the interpreter.
- **Stored** as one meal log with one entry: the description as its name, energy and protein, and carbs, fat and amount unknown. `source` is `photo-ai` (an AI's reply, with or without photos; its tag reads "AI estimate" without photos), `schemaVersion` is `null`, and `aiTotals` holds the totals. The values as written and the approximate wording go in the notes ("AI estimate as written: ~2,650 kJ, 45 g protein."), so no storage change was needed. A date in the text that differs from the day being logged is said in the review; the meal stays on that day.

## Reading a reply (pure, three steps)

1. **Extract** (`parse.ts`): with no JSON at all, the text goes to the plain-text reader above instead. Otherwise: a ```json or plain fence, or a bare object, with any prose around it. Exactly one object (the same object repeated counts once; a one-element array is unwrapped). Errors: empty, too long (> 100,000 characters), no JSON, **cut off** (an open fence or unbalanced object), invalid JSON, more than one object, not an object. Curly quotes and trailing commas are repaired and the review says so. Text is only `JSON.parse`d; nothing is ever evaluated.
2. **Validate** (`validate.ts`): a non-integer, unknown or newer `schemaVersion`, no foods and no totals, or more than 30 foods stop with one message (a missing version reads as 1, #179). Field problems never stop it and are never clipped or guessed: a negative, non-numeric, non-finite or out-of-range value is left empty and listed. Limits per food: 15,000 kJ, 300 g protein, 500 g carbs, 300 g fat, amount 5,000. Exact conversions are made and listed: kg → g, l → ml, oz → g, kcal (`energyKcal`/`kcal`/`calories`) → kJ; aliases normalise (`grams` → `g`, `pieces` → `piece`); other units are kept as written and listed. Numeric strings ("1,200", "12 g") are read; confidence 0–1 maps to low/medium/high.
3. **Normalise** into the draft (`draft.ts`): values become editable text; empty means unknown. Save needs a meal name, at least one named food, and every value a non-negative number within the limits, or empty.

## Totals

- **Recalculated from the foods** (`totals.ts`), always. The AI's totals are kept only to compare: a difference over 10% (and over 100 kJ or 3 g) is listed for review.
- A food with an unknown value makes that total "may be low"; nothing is filled in.
- A food whose energy is far from its macros (17/17/37 kJ per g; more than 35% and 200 kJ) gets a "check" note.
- Shown rounded and marked ≈ (energy in the phone's display unit, 11; grams whole). Unknown is "—", never 0.

## Replace semantics and storage

- Saving a meal that replaces a scheduled meal writes the `meal_log` and marks that meal **done** in one transaction (`saveMealLog`), with a completion event and day snapshot (08). Day progress counts it. Its row reads "Replaced: <meal>" with the estimate and its source ("Photo estimate", "AI estimate" or "Entered by you"); a tap on its circle opens the sheet instead of undoing it.
- The sheet shows **What you ate instead**: foods, totals, confidence, assumptions, photos (full screen on tap), **Edit meal** and **Remove meal**. Remove asks first, then deletes the log and its photos and puts the scheduled meal back to not done, atomically (`removeMealLog`).
- A replaced meal's planned values are never counted: the logged meal is what was eaten. This is also how a portion or contents that differed from the plan is corrected (#154).

## Day totals (no double counting)

`dayIntake` (`src/nutrition/intake.ts`):

- Logged meals are summed, each once, from their foods.
- **Ticked planned meals count as eaten (#154).** Ticking a scheduled meal on Today is the confirmation: there is no second "Ate this" action. It counts at the meal's planned energy and protein (`nutrition` in the plan version in effect that day) as an **estimate** (`src/nutrition/plannedMeals.ts`). The tick is the meal's existing `activity_log` (one per plan, date and meal), so ticking again, unticking, restarting, backup and restore can't double count, and nothing new is stored. Unticking removes it.
  - A meal **replaced** by a logged meal counts only as the logged meal. An **extra** logged meal (not replacing one) counts as well: it's a different meal.
  - A ticked meal without a planned value for a nutrient (the flexible meal never has one) adds nothing for it and marks the day **incomplete** ("may be low"). Never zero, never guessed. When no ticked or logged meal states a value, the line reads "Eaten: not known yet".
  - Planned values cover energy and protein only.
- If the day also has a **day total** (`energy_intake` / `protein_intake` entered by hand, read from a screenshot or imported), the day total is that nutrient's value and the meals (logged and ticked) are **not** added on top. The line says so.
- Carbohydrate and fat come from logged meals only.

Today's targets line gains **Eaten ≈ … kJ · … g protein · … g carbs · … g fat**, with where it came from ("from 1 logged meal · 2 ticked meals at plan estimates"). Progress (14) uses the same rule for the energy and protein charts. There are no new charts.

## Rest of today (#99)

After a meal is logged on today, a **Rest of today** card (content layer, under the targets and Eaten line) gives optional suggestions from `restOfDay()` (`src/nutrition/restOfDay.ts`), pure and deterministic, no AI:

- **Eaten** is the day's actual intake (`dayIntake`). Scheduled meals still to come add their planned nutrition; a flexible dinner still to come keeps about 1,500 kJ of room. Meals with no numbers make it approximate, and the card says so.
- **Keep the plan** is always first. Within or under the limit, it's the only food suggestion (with what's left for dinner).
- **Over the limit:** an optional smaller or skipped snack only if protein still reaches its minimum, otherwise keep the snack for its protein. A remaining dinner is never skipped: a smaller, protein-rich one instead.
- **Protein short** (10 g or more): protein first.
- **Activity** only when over by 400+ kJ, before 7:30 pm, not on a rest day, with no injury and a known weight: a planned workout still to do is pointed to; otherwise an optional 30-minute walk as a range for the user's weight (3.5–4.3 MET), an estimate that never "earns" food. Nothing is added to the workout log.
- **Late** (after the eating window or 8 pm): nothing to change today.
- **Missing** energy limit or unknown intake: "Keep the plan" with the reason, no numbers.
