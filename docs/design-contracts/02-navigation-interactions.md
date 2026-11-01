# 02 · Navigation & interactions

## Information architecture

Three tabs (native bottom tabs), plus modal sheets. No drawers, no nested settings, no screen deeper than **tab → one sheet**.

| Route (Expo Router) | Surface | Purpose |
|---|---|---|
| `/(tabs)/index` | **Today** tab, the launch screen | The day's resolved plan: activities, meals, targets, today's measurements, quick log |
| `/(tabs)/progress` | **Progress** tab | Goal progress, measurement trend, recent days (read-mostly) |
| `/(tabs)/plan` | **Plan** tab | Read-only week overview of the loaded plan, plus plan-package actions (import, replace, export data) |
| `/measure/[id]` | Form sheet | Enter a value for one measurement (numeric keypad) |
| `/activity/[id]` | Form sheet | Activity details and secondary actions: skip, undo, notes. It's never required for the happy path |
| `/day/[date]` | Push from Progress | Read-only or back-fillable view of a past day, using the same component as Today |

Today shows **one day at a time**. Chevrons in the header (and a tap on the date) move to the previous or next day. You can edit the current day and the previous day. Older days are read-only (see 04).

## Interaction rules

**Tap is the primary interaction everywhere.** Gestures are shortcuts layered on top, and each one must:

- (a) save a step on a frequent action,
- (b) have a visible tap equivalent,
- (c) be exposed as an accessibility action,
- (d) not conflict with platform system gestures (iOS edge back-swipe, Android back gesture, scrolling).

| Action | Primary (tap) | Gesture shortcut | Why the gesture is (or isn't) justified |
|---|---|---|---|
| Complete or uncomplete a `check` activity | Tap the row body | None | One tap is already minimal. A swipe would be slower. |
| Advance a `count` activity | Tap the next segment of the segmented row (for example ●●○) | None | Tapping segments shows progress and is one tap per unit. |
| Skip an activity (record it as deliberately not done) | Open the activity sheet → **Skip** | **Swipe the row left** → "Skip" action revealed, full swipe commits | Skipping optional items happens most days. The swipe-to-reveal row is a familiar native list pattern and keeps a button out of every row. |
| Undo done or skipped | Tap the row again (done → not done), or use **Undo** in the sheet | Swipe left on a skipped row → "Restore" | Same affordance as skip, so the gesture is symmetric. |
| Open the activity sheet | Tap the row's trailing `›` target (48 dp or larger) | Long-press the row | Long-press is a common native secondary action. The `›` keeps it discoverable. |
| Dismiss a sheet | Close or Save button | Drag the sheet down | Native sheet behaviour. We get it for free; don't disable it. |
| Change today's day type (for example home ↔ office) | Tap the day-type chip → choose from a native menu or action sheet | None | Done rarely. A gesture would be undiscoverable. |
| Log a quick event ("I'm hungry") | Tap the button. A haptic and a toast with **Undo** confirm it | None | It must be instant and unmistakable. |
| Enter a measurement | Tap the measurement tile → sheet with numeric keypad, prefilled with the last value | None | Typing is faster and more precise than a drag wheel or slider. Explicitly rejected: drag-to-adjust. |
| Change day | Header chevrons | **Not** horizontal paging | Rejected: it conflicts with row swipe and the iOS back gesture, and changing day is infrequent. |
| Reorder activities | n/a | **Not** drag-to-reorder | Rejected: order comes from the plan (time, then plan order). |
| Pull to refresh | n/a | **Not used** | Rejected: the app is local-first, so there's nothing to refresh. |

## Feedback

- State changes are optimistic and immediate, with no spinners for local writes.
- Light haptic on complete, skip and quick-log (native only, no-op on web).
- Undo is offered by a transient toast or snackbar after any skip or quick-log. Completing a row needs no toast, because tapping again undoes it.
- No confirmation dialogs, except when replacing the loaded plan package.

## Empty and first-run states

- With no plan loaded: one screen with **Use example plan** and **Import plan file**. Nothing else.
- A day with no activities shows "Nothing planned today" plus the measurement tiles and quick log.
