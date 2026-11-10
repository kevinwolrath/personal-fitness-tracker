# 02 · Navigation & interactions

## The Daily Log

**The Daily Log is the primary application surface. Today is the current date within that log.** Every date (today, yesterday, last year, next week) is rendered by the same day view (`DayLogScreen`), from the same canonical data model, with the same editing behaviour. History has no separate screen or store: a historical day *is* the Daily Log at that date. New capabilities extend the shared model and the continuous history rather than becoming isolated feature screens.

- **Route:** `/` is the Daily Log. The selected date is the `date` search parameter (`/?date=2026-03-11`); no parameter means today. Reloads, links and back/forward keep the date.
- **Today opens on "Do this next"** (contract 08): what to reasonably do now, ready to tick off, when there is something (otherwise no card, #41), then the day grouped Morning / Midday / Afternoon / Evening / Anytime today. Requirements show as one row with their alternatives.
- **What a day shows** (for any date where data exists): measurements against goals, targets, the plan's activities and meals for that date's day type, and a **Recorded** section with every other observation on that date (imported steps, sleep, readiness, workouts, calculated values, and `other` metrics). It also shows activity history that the current plan no longer schedules that day, taken from `labelSnapshot`.
- **Ingestion is not a destination.** Manual entry, screenshot import and future integrations write canonical observations (contract 06). Each appears on its own effective date in the log.
- **Editing:** today and every past date are fully correctable, including imported values (edit or remove from the observation sheet; provenance records the edit). Future dates are view-only planned days (contract 04).

Target structure: three tabs (native bottom tabs), plus sheets. No drawers, no nested settings, no screen deeper than **tab → one sheet**. Two tabs now: **Today** (the Daily Log) and **Progress** (#52, contract 14). The tab bar arrived with the second tab. Sheets are rendered through the `Sheet` platform adapter (`src/ui/Sheet*.tsx`): an iOS page sheet, an Android bottom panel, and an in-frame panel on web. Screenshot import is a route (`/import`), presented modally.

Optional gamification (#73, contract 16) uses content cards on Today (after measurements/targets) and Progress, plus one shared quests/gallery sheet. Its device switch lives in Settings. It adds no shell controls and preserves the vertical budget and existing Plan access.

## Layout layers (#19)

Every main screen stacks three layers, top to bottom. Each control belongs to one layer only.

| Layer | Owned by | Contains | Rules |
|---|---|---|---|
| **App shell** | `app/(main)/_layout.tsx` → `AppShell` (`src/features/shell/`) | The app bar: ☰ (app menu) on the left, then the app name. The bottom tab bar (#52): Today and Progress. | Rendered by the layout, never by a screen. The app bar is fixed at the top, outside any scroll view, and respects the top safe area: 48 dp tall plus the inset. The ☰ is in the same place on every main screen and every date. The tab bar is fixed at the bottom (56 dp plus the bottom inset); sheets cover it. |
| **Screen header** | The screen | For the Daily Log: the date row, then the day line (see below) | Scrolls with the content. Screens never add shell controls (menu, app title) to it. |
| **Content** | The screen | For the Daily Log: **Do this next**, **Today's workout** (#56; #90: counts are the day's prescribed exercises only, "0 of 5", with catalogue extras behind one Extras row in its sheet and never in the count; a day with nothing prescribed says "No workout planned"), **Muscle Growth** (#122: a section after Today's workout, only when set up; no card, no primary button), measurements, targets, the day's parts, Recorded | The reason the screen exists. It starts as high as possible (see the budget). |

**Daily Log header**, at most three compact rows:
1. `‹ date ▾ ›`, then **Share** (#76; contract 06 "Share this day") and **Today** at the right when another date is open. Share shows "⤴ Share" where it fits, the 48 dp ⤴ icon alone where only that fits, and, only where even the icon would crowd the date (a past date on the narrowest phones), it moves to the start of row 2. It is absent on future dates. Its accessible name is always "Share this day".
2. The day title (26 pt) with the day-type chip on the same row. If both don't fit, the chip wraps below, right-aligned. Neither truncates.
3. Progress text and the progress bar on one line.

**Vertical budget.** On a 390 × 844 phone, the **Do this next** card starts within **200 px** of the top of the viewport, app bar included. When there's nothing to recommend the card is absent (#41, contract 08), and the first content block (the measurements) starts within the same budget. `e2e/app-shell.spec.ts` measures it. A change that pushes the card lower has to change this contract first.

**Modal routes** (`/import`, `/configure`, `/meal-photo`, contract 15) are tasks rather than places. They cover the shell and use the modal header below. They don't show the app bar.

**Modal and sheet header (#21).** Every modal screen and every sheet uses one header, `ModalHeader` (`src/ui/ModalHeader.tsx`). There are no hand-built headers.

| Left | Centre | Right |
|---|---|---|
| **Dismiss**, always | Title, one line | **Confirm** (e.g. Save), only if the surface has one |

- **Dismiss wording:** **Cancel** when closing loses something (an unsaved value, a pasted update, picked screenshots); **Close** when nothing is lost (read-only, or already saved).
- **Layout:** both sides have the same width, so the title stays centred with or without a confirm.
- **Primary actions** for the content (Read, Apply) are buttons in the content or a fixed bottom bar, never in the header.
- **Test:** `e2e/surfaces.spec.ts` checks the order, the centring and the wording on every surface.

**Modal vertical budget.** In each modal screen's main state, its primary action is on screen at 390 × 844 without scrolling. The fixed bottom bar holds it when the content runs long: Import's **Save**, Configure's **Apply**.

**Configure layout (#21, "one page").**
- Finished steps collapse to one line with a way back in: "Shared with your AI · Share again" (or "Instructions copied" after Copy instead, #119), "Update checked · Change".
- **Share previews (#76, #119)** use one sheet (`src/ui/SharePreviewSheet`): the exact text scrolls, and **Share** (with **Copy instead** where offered) stays fixed below it. After checking, the pasted JSON isn't shown.
- **What changes** lists only the sections that change, one row each, with the first change and a count; tap a row to see every change in it. The other sections are named in one line ("… stay as they are").
- **Discard** and **Apply N changes** sit in a fixed bottom bar.

**App menu (#15).** The ☰ in the app bar opens the app menu, a sheet rather than a drawer. It holds the application-level operations, which stay off the day so they don't compete with it:

| Item | Does |
|---|---|
| **Import from screenshots** | Opens the platform image picker straight away: images only, several at once, with no in-app step first. Cancel returns to the screen with nothing changed. A selection opens `/import` (review, contract 06), dated from the open Daily Log day (`?date=`, otherwise today). |
| **Health Connect** | Opens the Health Connect sheet: tick what to import, connect (read-only; the only permission requests), and a setup checklist: per type, whether it's allowed and arriving, with a **Fix** for each problem, **Check again** to confirm, and **Manage in Health Connect** (contract 12, #116). Imported values appear in the Daily Log's existing Weight tile and Recorded rows; the Daily Log gains no controls. |
| **Configure with AI** | Opens `/configure` (contract 07). |
| **Edit setup answers** | Opens `/setup`: the setup wizard over the current plan, starting from its saved answers. The plan is replaced only after a confirmation dialog, as a new revision with undo; measurements, workout history and imports are untouched (contract 13). |
| **Reminders** | Opens the Reminders sheet: status, the plan's reminders, and the explicit **Turn on reminders** (the only permission request) or an on/off switch (contract 10). |
| **Settings** | Opens the Settings sheet: **Appearance** (Hero Forge or Classic light) and **Energy units** (kJ, kcal or both). The detail line states the current energy choice, e.g. "Energy in kJ" (contract 11). |
| **Muscle Growth** | Opens the Muscle Growth editor (#122, contract 09): on/off, target muscles, days, time of day, the exercises for those targets, and custom catalogue exercises. Its detail line shows "On · Biceps, Upper back" or "Targeted routine for chosen muscles". Saved as an `exercise` configuration change with Undo (contract 07). |
| **Muscle coverage & exercise log** | Opens the live #56 coverage sheet, including on rest days. It also opens from the expanded workout/checklist flow. No new permanent tab, app-bar control or Today banner (#79). |
| **Export all data** | Asks first (see Feedback), then runs the full export (contract 06). |

The menu closes before its item runs. On iOS, the item runs once the sheet has dismissed, because iOS can't present a picker, an alert or a modal route over a closing sheet. On web it runs inside the tap, so the browser allows the file picker.

| Route (Expo Router) | Surface | Purpose |
|---|---|---|
| `/` (`?date=`) | **Daily Log** tab, the launch screen (opens on today) | One day of the continuous log: resolved plan, measurements, targets, recorded observations. Rendered inside the app shell. |
| `/progress` | **Progress** tab | Measurement and weight-trend charts, read-only (contract 14) |
| `/(tabs)/plan` | **Plan** tab | Read-only week overview of the loaded plan, plus plan-package actions (import, replace, export data) |
| Measure sheet | Sheet | Enter a value for one measurement (numeric keypad) |
| Activity sheet | Sheet | Activity details and secondary actions: done/not done, skip, restore. For a meal it shows **What to prepare** (ingredient, target amount and the plan's everyday measure), **How to make it**, and the meal's energy/protein (#26). Content scrolls inside the sheet (max 92 % of the screen) so the actions stay reachable. It's never required for the happy path |
| Go-to-date sheet | Sheet | Jump to any date: shortcuts (Today, Yesterday, A week ago, First entry) and the platform date picker |
| Observation sheet | Sheet | One recorded observation: value, provenance (source, on-screen evidence, confidence, times), edit or remove |
| `/import` | Modal | Screenshot import (contract 06) |
| `/setup` | Full-screen modal | Edit setup answers (contract 13) |

The log shows **one day at a time**. Its screen header (see Layout layers): `‹ date ▾ ›` steps a day either way, and tapping the date opens the go-to-date sheet. **Today** (a button shown whenever another date is open) returns to the current date. The title reads *Today*, *Yesterday* or *Tomorrow*; within a week either side, the weekday name; otherwise the date, with the year if it isn't this year. The header date and title never truncate (the responsive sweep enforces this).

## Interaction rules

### Scrolling: no visible indicators (#93)

No visible horizontal or vertical scrollbars anywhere in the mobile UI or web preview: screens, sheets, modal routes, nested lists, exercise guides, menus and editable multiline fields. Use `src/ui/ScrollView` instead of importing a native scroller directly. It preserves the native ref, scroll events, touch/keyboard behavior and content layout while suppressing both indicators on Android and iOS. New virtualized lists must extend the shared policy before use; the repository guard rejects raw list imports.

The single root `ScrollIndicators.web` rule also suppresses browser indicators for document overflow, portals and multiline fields. It must not set `overflow: hidden`, disable scrolling, intercept wheel/touch events, or remove keyboard access. Sheet/phone clipping is unchanged; scrolling belongs to content. Keep essential existing headers and fixed action bars outside that content. Preserve safe-area insets, keyboard avoidance, dynamic text and bottom padding/reachability.

Additional content is signalled by the natural partial next item. Do not add instructional arrows, scroll labels or automatic fade overlays. A fade may be proposed only when the content needs it and cannot cover controls or the final item. Indicator suppression alone must not change spacing or the screen's vertical budget.

**Tap is the primary interaction everywhere.** Gestures are shortcuts layered on top, and each one must:

- (a) save a step on a frequent action,
- (b) have a visible tap equivalent,
- (c) be exposed as an accessibility action,
- (d) not conflict with platform system gestures (iOS edge back-swipe, Android back gesture, scrolling).

| Action | Primary (tap) | Gesture shortcut | Why the gesture is (or isn't) justified |
|---|---|---|---|
| Tick off one exercise of a workout | Tap its circle (48 dp) on the **Do this next** card (the next exercise, or any when expanded) or in the item sheet. The exercise's name or ⓘ opens its guide | None | The workout card is a live checklist (#28, contract 08). Ticking the last exercise completes the workout. |
| Complete or uncomplete a `check` activity | Tap the row body. **Meals:** tap the completion circle (48 dp) | None | One tap is already minimal. A swipe would be slower. A meal row holds drill-down information (what to prepare), so completion gets its own explicit control (#26). |
| See what a meal is (ingredients, amounts, preparation, energy/protein) | **Meals:** tap anywhere on the row except the circle; the `›` marks it. Opens the activity sheet. Viewing never completes anything, and closing returns to the same scroll position | Long-press | "What exactly am I eating, and how much?" is one tap from any day: past, today or future. |
| Advance a `count` activity | Tap the next segment of the segmented row (for example ●●○) | None | Tapping segments shows progress and is one tap per unit. |
| Replace a meal with what was actually eaten (#97) | **📷 Log different meal**: outlined, under Done on the due meal's Do this next card, and in every meal's sheet. Opens the `/meal-photo` wizard (contract 15). A replaced meal's circle opens its sheet (Edit / Remove) instead of undoing | None | One tap from the card, no gesture to discover. |
| Skip an activity (record it as deliberately not done) | Open the activity sheet → **Skip** (any activity, required or optional) | None in V1. Also exposed as the row's `skip` accessibility action | Issue #3 asked for no gesture dependencies unless genuinely required. The swipe row needs gesture-handler + reanimated, so it's deferred until skip frequency justifies it. |
| Undo done or skipped | Tap the row again (done → not done; tapping a skipped row marks it done), **Undo** in the skip toast, or **Restore** in the sheet | None | — |
| Open the activity sheet | Tap the row's trailing `›` target (48 dp or larger) | Long-press the row | Long-press is a common native secondary action. The `›` keeps it discoverable. |
| Dismiss a sheet | Close or Save button | Drag the sheet down | Native sheet behaviour. We get it for free; don't disable it. |
| Change today's day type (for example home ↔ office) | Tap the day-type chip → choose in a sheet. Choosing the plan default clears the override | None | Done rarely. A gesture would be undiscoverable. |
| Enter a measurement | Tap the measurement tile → sheet with numeric keypad, prefilled with the last value | None | Typing is faster and more precise than a drag wheel or slider. Explicitly rejected: drag-to-adjust. |
| Change day | Header chevrons | **Not** horizontal paging | Rejected: it conflicts with row swipe and the iOS back gesture. |
| Jump to a date | Tap the header date → shortcut or platform date picker (iOS inline calendar; Android system calendar dialog; web `<input type=date>`) | None | Months or years of history must never need hundreds of chevron taps. The native pickers already handle fast month and year jumps. |
| Return to Today | **Today** button in the header (or the Today shortcut) | None | Always one tap from anywhere in the log. |
| Correct a recorded value | Tap the row in **Recorded** → edit or **Remove** | None | Same correction model for manual, imported and future integration data. |
| Reorder activities | n/a | **Not** drag-to-reorder | Rejected: order comes from the plan (time, then plan order). |
| Pull to refresh | n/a | **Not used** | Rejected: the app is local-first, so there's nothing to refresh. |

## Feedback

- State changes are optimistic and immediate, with no spinners for local writes.
- Light haptic on complete and skip (native only, no-op on web).
- Undo is offered by a transient toast or snackbar after any skip. Completing a row needs no toast, because tapping again undoes it.
- No confirmation dialogs, with two exceptions:
  - replacing the loaded plan package;
  - **Export all data**: "Export all fitness data?" with **Cancel** and **Export JSON**. It uses the `ConfirmDialog` adapter: the system alert on iOS and Android, and an in-frame dialog on web. Cancel, Escape or tapping outside exports nothing.

## Empty and first-run states

- With no plan loaded: one screen with **Use example plan** and **Import plan file**. Nothing else.
- A day with no activities shows "Nothing planned for this day" plus the measurement tiles and recorded observations.

## Recorded content (#104)

Within the existing content layer, Health Connect steps, active energy and sleep use a compact grid. Walking is collapsed into one expandable summary with explicit min/hr duration and available m/km distance. Expanded records show source, time, duration, available distance and the existing read-only detail sheet. No new header or shell controls; the Today header budget is unchanged. Targets remain at least 48dp and essential values wrap. See contract 12 for overlap and optional Distance rules.
