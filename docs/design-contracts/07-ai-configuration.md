# 07 · AI configuration

**AI is the configuration editor; the application is the configuration owner.** There's no large settings screen. Nuanced configuration (diet changes, equipment, injuries, schedule, goals) is worked out in conversation with any chat assistant (ChatGPT, Claude, …). The assistant returns a strict, documented update. The app validates it, previews it and applies it only after the user confirms.

## Configuration = sections over the plan package

The configuration is not a second store. It's a sectioned view over the active plan package (03), which gains two optional sections at **formatVersion 2**: `profile` and `exercise`. formatVersion 1 plans stay valid. A plan is written at 2 the first time a configuration update is applied.

| Section | Fields | Stored in the plan as |
|---|---|---|
| `profile` | `units`, `displayName`, `heightCm`, `notes` | `units`, `profile.*` |
| `goals` | `targets` | `goals` |
| `nutrition` | `targets`, `eatingWindow`, `meals` | `nutrition.targets`, `nutrition.eatingWindow`, activities with `kind: "meal"` |
| `exercise` | `goals`, `equipment`, `limitations`, `substitutions`, `activityTypes`, `strength`, `conditioning`, `constraints` | `exercise.*` |
| `schedule` | `dayTypes`, `week`, `requirements`, `activities`, `timing` | `dayTypes`, `schedule`, `requirements` (08), activities that aren't meals, `timing` (due times, 08) |
| `tracking` | `measurements`, `quickLogs` | `measurements`, `quickLogs` |

Field shapes and enums are in `plan.schema.json` (`$defs.exercise`, `$defs.profile`) and `src/plan/schema.ts`. Section/field mapping is in `src/config/sections.ts`. New areas extend this table: add a field or section, and the same protocol, importer, preview and instructions pick it up. No separate import system is needed.

### Exercise (first-class)

- `equipment`: `[{ type, label?, brand?, weightsKg?, notes? }]`, where `type` is one of a fixed enum (kettlebell, home_gym, heavy_bag, battle_ropes, vr_headset, …).
- `limitations`: `[{ movement, status: avoid|caution|allowed, reason? }]`.
- `substitutions`: `[{ instead, use: [...], reason? }]`. A suggested replacement can't itself be `avoid`.
- `activityTypes`: `[{ id, label, kind, intensity?, equipment?, notes? }]`.
- `strength` and `conditioning`: `{ sessionsPerWeek?, sessionMinutes?, intensity?, modalities?, … }`. `modalities` must reference `activityTypes` ids.
- `constraints`: `{ location?, gymMembership?, maxSessionMinutes?, notes? }`, for work, family and time limits.
- `goals`: enum list (weight_loss, muscle_preservation, strength, fitness, …).

Movement and activity-type ids are `snake_case` (`biceps_curl`, `hammer_curl`). Plan item ids stay `lower-case-hyphen`. The real-world profile from #7 is `fixtures/config/real-world-exercise.update.json`.

## Update protocol (schemaVersion 1)

```json
{ "fitnessConfigUpdate": { "schemaVersion": 1, "exercise": { "equipment": [ … ] } } }
```

1. **Section presence:** a section that is present is updated, and a section that is absent is untouched (byte-identical).
2. **Field presence:** inside a present section, each field that is present **replaces** that field, and absent fields are kept. Lists are replaced whole, so adding an item means sending the full list.
   - **Merge by id (#26).** Id-keyed lists also accept `{ "merge": [items] }`: `nutrition.meals`, `schedule.activities`, `nutrition.targets`, `goals.targets` and `tracking.measurements`, marked "merge by id" in the AI instructions.
   - Each item **replaces the item with the same id in place**, or is **added** if the id is new. Every other item stays byte-identical and in its position.
   - A meal can only replace a meal (and an activity an activity). An id clash with the other kind is a duplicate-id error.
   - Merged items are validated like any other.
   - This is how one meal is changed without resending, or resetting, the rest: `fixtures/config/lunch.update.json` adds the #26 lunch to an already-configured plan.
3. **Clearing:** `null` clears a field marked clearable (profile and exercise fields, `nutrition.eatingWindow`, …). Required fields can't be null.
4. **Strict:**
   - Unknown sections, fields or enum values are errors.
   - `schemaVersion` is required and must equal the app's version. A different version asks the user to copy fresh instructions.
   - Only `fitnessConfigUpdate` is allowed at the top level.

## Importer (deterministic, `src/config/update.ts`)

1. **Read the paste (#47, `src/config/import/`).** People paste a whole chat reply and need to know nothing about JSON. Four pure, deterministic steps, each reporting what it changed. Model output is never evaluated or executed, and input is bounded: 200,000 characters, 40 levels of nesting, 20,000 values.
   1. **Extract:**
      - strip a byte-order mark;
      - take the code block (```, ``` ```json ```, `~~~`, or one left open by a cut-off reply) that contains `fitnessConfigUpdate`, or the bare object, ignoring prose before and after it;
      - add a missing opening `{`.

      Two updates, or two update blocks, is an error.
   2. **Curly quotes:** “ ” used as JSON delimiters become `"`, but only where their role is unambiguous.
      - Outside text, a curly quote opens a string. Inside a curly-quoted string, it closes only before `:` `,` `}` `]` or the end, and after a comma only if a key or value follows.
      - Curly quotes inside text, apostrophes and single quotes are kept. A straight quote inside curly-quoted text is escaped.
      - Mixed straight and curly quotes work.
      - If the result still doesn't read, the error says the quotes were ambiguous and asks for straight quotes.
   3. **Repair**, with a string-aware tokenizer, so text inside strings is never changed: comments, trailing commas, extra closers at the very end, and missing closers at the end **only** when the text ends right after a complete value.
      - **Never guessed:** a cut-off string, an entry that stops after `:` or `,`, single quotes, unquoted keys, missing commas and mismatched brackets are errors with line and column.
      - **Truncation:** sections that were complete before a cut are listed as "complete in what you pasted, not applied".
   4. **Parse and canonicalise:**
      - **Parse strictly:** duplicate keys are kept once if equal and are an error if they differ. `True`/`False`/`None` read as JSON literals. Keys are plain data, so `__proto__` does nothing.
      - **Letter case:** schema property names and enum/literal values are matched case-insensitively and rewritten canonically, from the real zod schemas. Ids and free text are never re-cased. Two keys differing only in case are kept once if equal and are an error if they differ.

   Prose is never interpreted as configuration: a reply with no update ("No update found") changes nothing. What was repaired is shown with the preview (see UI), and every failure offers copyable diagnostics.
2. **Version:** check `schemaVersion`.
3. **Sections:** detect which sections are supplied.
4. **Validate sections:** each is checked strictly against its patch schema, and every error is reported at once with its path (for example `fitnessConfigUpdate.exercise.equipment[0].type: …`).
5. **Merge and validate:** the update is merged onto a **copy** of the stored raw plan JSON, then the whole result is validated, including cross-section rules (for example a meal's nutrition keys must be existing targets, or modalities must exist).
6. **Preview:** a human-readable change list per section (`src/config/diff.ts`), in plain language:
   - amounts use the app's own formatting (thousands separators, energy in the device's energy display, `g`; contract 11);
   - fields have plain names ("time of day", "sessions a week");
   - activity ids show their configured labels;
   - removed fields read "cleared: …", never "→ —".

   Only sections that change are listed (see 02, "Configure layout"); the others are named in one line as staying as they are.
7. **Apply:** only on **Apply N changes**. The result is always the current plan format (formatVersion 5), so items can carry `leadMinutes`, the plan can carry `timing` (08), meals can carry `ingredients` and `preparation` and any activity can carry `notifications` (03, 10). The AI can add, change or remove reminders, and a merge by id changes one activity's reminders without touching the others. **Turning reminders on or off is not configuration:** it's a device preference the update protocol can't express, so an update never enables or disables them. The new plan revision (origin `config`) and a history entry are written atomically.
8. **No partial state:** any failure means nothing is written. Omitted sections are preserved exactly, because patches act on the raw JSON, not on the parsed plan.

## History, undo, seed and export

- Every applied update is recorded (`config_change`): the payload, sections, from/to revision and the **exact previous plan JSON**.
- **Undo last change** restores that JSON as a new revision. History only grows, and only the most recent change can be undone.
- Once a plan has origin `config`, a newer bundled seed **never** replaces it. Only an untouched seed upgrades (04).
- The full export includes `configChanges` and each plan's `origin`. This is additive within exportVersion 1, and older exports still restore.

## AI session instructions (`src/config/instructions.ts`)

**Copy AI instructions** puts plain text on the clipboard. It contains:
- the role;
- the current configuration (every section) and the schema version;
- the update format: the **whole reply is the bare JSON object**, with no code block, no Markdown and no words around it;
- the list of sections and the rule to include every agreed change and nothing else;
- the rules above, including the same letter case, plain JSON and each field once;
- every field with its shape;
- the allowed values, generated from the schema enums so they can't drift;
- four examples, each a complete one-line reply: exercise-only, nutrition-only, one meal by merge, and combined.

The importer doesn't depend on the AI following the format (see Importer, step 1).

The text is provider-neutral, with no tool calls or model-specific features, so it works the same in Claude, Gemini and ChatGPT. Tests assert that every example is accepted by the importer. Real replies are kept in `fixtures/config/ai-replies/real/` with expectations, and imported by the tests. Its README is the manual test matrix for capturing more, from Gemini, ChatGPT and claude.ai.

## UI

App menu (☰) → **Configure with AI** (`/configure`, modal; layout in 02, "Configure layout"):

1. Copy instructions.
2. Paste the update (or tap **Paste**), then **Check update**.
3. Errors appear, or the preview, then **Apply N changes** or **Discard** in the bottom bar.
   - **Repairs (option A, #47):** if the import fixed anything, the preview starts with one quiet line, "Fixed automatically: N formatting problems in what the AI sent.", and **Details** lists exactly what was repaired. A clean update shows nothing extra.
   - **Errors:** the error panel lists what is wrong, any sections that were complete but not applied, and a secondary **Copy details for the AI** button, which copies the diagnostics (errors with line and column and an excerpt, plus what was already fixed). It changes to "Copied: paste it to the AI".

Before an update is checked, the screen also shows the last change with **Undo**, and a read-only summary of the current configuration (`src/config/summary.ts`) so it can be inspected without editing anything.
