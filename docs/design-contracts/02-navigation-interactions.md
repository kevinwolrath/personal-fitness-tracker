# 02 · Navigation & interactions

## The Daily Log

**The Daily Log is the primary application surface. Today is the current date within that log.** Every date (today, yesterday, last year, next week) is rendered by the same day view (`DayLogScreen`), from the same canonical data model, with the same editing behaviour. History has no separate screen or store: a historical day *is* the Daily Log at that date. New capabilities extend the shared model and the continuous history rather than becoming isolated feature screens.

- **Route:** `/` is the Daily Log. The selected date is the `date` search parameter (`/?date=2026-03-11`); no parameter means today. Reloads, links and back/forward keep the date.
- **What a day shows** (for any date where data exists): measurements against goals, targets, the plan's activities and meals for that date's day type, quick logs, and a **Recorded** section with every other observation on that date (imported steps, sleep, readiness, workouts, calculated values, and `other` metrics). It also shows activity history that the current plan no longer schedules that day, taken from `labelSnapshot`.
- **Ingestion is not a destination.** Manual entry, screenshot import and future integrations write canonical observations (contract 06). Each appears on its own effective date in the log.
- **Editing:** today and every past date are fully correctable, including imported values (edit or remove from the observation sheet; provenance records the edit). Future dates are view-only planned days (contract 04).

Target structure: three tabs (native bottom tabs), plus sheets. No drawers, no nested settings, no screen deeper than **tab → one sheet**. The Daily Log is currently the only tab. The tab bar arrives with the second one, because a one-tab bar is clutter. Sheets are rendered through the `Sheet` platform adapter (`src/ui/Sheet*.tsx`): an iOS page sheet, an Android bottom panel, and an in-frame panel on web. Screenshot import is a route (`/import`), presented modally.

| Route (Expo Router) | Surface | Purpose |
|---|---|---|
| `/` (`?date=`) | **Daily Log** tab, the launch screen (opens on today) | One day of the continuous log: resolved plan, measurements, targets, quick log, recorded observations |
| `/(tabs)/progress` | **Progress** tab | Goal progress, measurement trend, recent days (read-mostly) |
| `/(tabs)/plan` | **Plan** tab | Read-only week overview of the loaded plan, plus plan-package actions (import, replace, export data) |
| Measure sheet | Sheet | Enter a value for one measurement (numeric keypad) |
| Activity sheet | Sheet | Activity details and secondary actions: done/not done, skip, restore. It's never required for the happy path |
| Go-to-date sheet | Sheet | Jump to any date: shortcuts (Today, Yesterday, A week ago, First entry) and the platform date picker |
| Observation sheet | Sheet | One recorded observation: value, provenance (source, on-screen evidence, confidence, times), edit or remove |
| `/import` | Modal | Screenshot import (contract 06) |

The log shows **one day at a time**. Header: `‹ date ▾ ›` steps a day either way, and tapping the date opens the go-to-date sheet. **Today** (a button shown whenever another date is open) returns to the current date. The title reads *Today*, *Yesterday* or *Tomorrow*; within a week either side, the weekday name; otherwise the date, with the year if it isn't this year. The header date and title never truncate (the responsive sweep enforces this).

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
| Skip an activity (record it as deliberately not done) | Open the activity sheet → **Skip** (any activity, required or optional) | None in V1. Also exposed as the row's `skip` accessibility action | Issue #3 asked for no gesture dependencies unless genuinely required. The swipe row needs gesture-handler + reanimated, so it's deferred until skip frequency justifies it. |
| Undo done or skipped | Tap the row again (done → not done; tapping a skipped row marks it done), **Undo** in the skip toast, or **Restore** in the sheet | None | — |
| Open the activity sheet | Tap the row's trailing `›` target (48 dp or larger) | Long-press the row | Long-press is a common native secondary action. The `›` keeps it discoverable. |
| Dismiss a sheet | Close or Save button | Drag the sheet down | Native sheet behaviour. We get it for free; don't disable it. |
| Change today's day type (for example home ↔ office) | Tap the day-type chip → choose in a sheet. Choosing the plan default clears the override | None | Done rarely. A gesture would be undiscoverable. |
| Log a quick event ("I'm hungry") | Tap the button. A haptic and a toast with **Undo** confirm it | None | It must be instant and unmistakable. |
| Enter a measurement | Tap the measurement tile → sheet with numeric keypad, prefilled with the last value | None | Typing is faster and more precise than a drag wheel or slider. Explicitly rejected: drag-to-adjust. |
| Change day | Header chevrons | **Not** horizontal paging | Rejected: it conflicts with row swipe and the iOS back gesture. |
| Jump to a date | Tap the header date → shortcut or platform date picker (iOS inline calendar; Android system calendar dialog; web `<input type=date>`) | None | Months or years of history must never need hundreds of chevron taps. The native pickers already handle fast month and year jumps. |
| Return to Today | **Today** button in the header (or the Today shortcut) | None | Always one tap from anywhere in the log. |
| Correct a recorded value | Tap the row in **Recorded** → edit or **Remove** | None | Same correction model for manual, imported and future integration data. |
| Reorder activities | n/a | **Not** drag-to-reorder | Rejected: order comes from the plan (time, then plan order). |
| Pull to refresh | n/a | **Not used** | Rejected: the app is local-first, so there's nothing to refresh. |

## Feedback

- State changes are optimistic and immediate, with no spinners for local writes.
- Light haptic on complete, skip and quick-log (native only, no-op on web).
- Undo is offered by a transient toast or snackbar after any skip or quick-log. Completing a row needs no toast, because tapping again undoes it.
- No confirmation dialogs, except when replacing the loaded plan package.

## Empty and first-run states

- With no plan loaded: one screen with **Use example plan** and **Import plan file**. Nothing else.
- A day with no activities shows "Nothing planned for this day" plus the measurement tiles, recorded observations and quick log.
