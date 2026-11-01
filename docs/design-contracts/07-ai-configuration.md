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
| `schedule` | `dayTypes`, `week`, `activities` | `dayTypes`, `schedule`, activities that aren't meals |
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
3. **Clearing:** `null` clears a field marked clearable (profile and exercise fields, `nutrition.eatingWindow`, …). Required fields can't be null.
4. **Strict:**
   - Unknown sections, fields or enum values are errors.
   - `schemaVersion` is required and must equal the app's version. A different version asks the user to copy fresh instructions.
   - Only `fitnessConfigUpdate` is allowed at the top level.

## Importer (deterministic, `src/config/update.ts`)

1. **Parse:** the pasted text is the JSON itself, or **exactly one** fenced code block (chat apps wrap code). Prose is never interpreted.
2. **Version:** check `schemaVersion`.
3. **Sections:** detect which sections are supplied.
4. **Validate sections:** each is checked strictly against its patch schema, and every error is reported at once with its path (for example `fitnessConfigUpdate.exercise.equipment[0].type: …`).
5. **Merge and validate:** the update is merged onto a **copy** of the stored raw plan JSON, then the whole result is validated, including cross-section rules (for example a meal's nutrition keys must be existing targets, or modalities must exist).
6. **Preview:** a human-readable change list per section (`src/config/diff.ts`). Supplied sections list their changes, or "No changes". Other sections say "Not in this update · unchanged".
7. **Apply:** only on **Apply update**. The new plan revision (origin `config`) and a history entry are written atomically.
8. **No partial state:** any failure means nothing is written. Omitted sections are preserved exactly, because patches act on the raw JSON, not on the parsed plan.

## History, undo, seed and export

- Every applied update is recorded (`config_change`): the payload, sections, from/to revision and the **exact previous plan JSON**.
- **Undo last change** restores that JSON as a new revision. History only grows, and only the most recent change can be undone.
- Once a plan has origin `config`, a newer bundled seed **never** replaces it. Only an untouched seed upgrades (04).
- The full export includes `configChanges` and each plan's `origin`. This is additive within exportVersion 1, and older exports still restore.

## AI session instructions (`src/config/instructions.ts`)

**Copy AI instructions** puts plain text on the clipboard: the role, the current configuration (every section), the schema version, the update format, the rules above, every field with its shape, the allowed values (generated from the schema enums so they can't drift), and three examples (exercise-only, nutrition-only, combined).

The text is provider-neutral, with no tool calls or model-specific features, so it works the same in ChatGPT and Claude. A test asserts that every example in the instructions is accepted by the importer.

## UI

Daily Log → **Configure with AI** (`/configure`, modal):

1. Copy instructions.
2. Paste the update (or tap **Paste**), then **Check update**.
3. Errors appear, or the preview, then **Apply update** or **Discard**.

The screen also shows the last change with **Undo**, and a read-only summary of the current configuration (`src/config/summary.ts`) so it can be inspected without editing anything.
