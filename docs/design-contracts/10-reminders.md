# 10 · Reminders (plan-driven local notifications)

> A nudge before lunch, from the plan, on this phone only.

## What is plan data and what isn't

| | Owner | Where |
|---|---|---|
| **What** to remind about, **when**, and the **wording** | The plan (03, formatVersion 4) | `activities[].notifications` |
| **Whether** reminders are on | This device (a preference) | `src/platform/preferences.ts`. Never in the plan, never changed by Configure with AI |
| Whether the OS lets the app notify | The OS | Permission |

Switching reminders off never touches the plan's reminder definitions. Switching them back on rebuilds the schedule from the current plan.

## Plan format

`notifications` is optional per activity, with at most 3 entries. A missing or empty list means no reminder. Each entry is `{ offsetMinutes | at, title, body }`:
- `offsetMinutes` is minutes from the activity's start, either its `time` or the start of its day part (08's windows: morning 06:00, lunch 11:00, afternoon 14:00, evening 17:30). Negative means before. An "anytime" activity has no start, so it must use `at`; validation enforces this.
- `at` is a fixed `"HH:MM"`.

The application has no reminder rules of its own: no activity ids, kinds or times are special-cased. The seed reminds about lunch (11:55), the snack (16:00) and dinner (18:15), and nothing about the strength workout or VR boxing. Activity scheduling (`time`/`when`) and reminder timing stay separate.

## Scheduling (`src/reminders/schedule.ts`, pure)

1. **Desired set:**
   - Built from the active plan, the next **7 days** resolved like the Daily Log (day types and overrides), and those days' records.
   - Each activity reminder is kept only if the item is still pending (done, skipped, or a requirement already met by another alternative don't remind) and its time is still in the future.
2. **Identity:** every reminder has a deterministic id: plan, date, activity, index, and a hash of its time and wording. Any change to a reminder gives it a new id.
3. **Reconcile:** the system's pending list is made equal to the desired set. Ours (by id prefix) that aren't wanted are cancelled, and missing ones are scheduled. Nothing else is touched.

   This gives no duplicates, nothing stale from an old plan revision, and safety across restarts.
4. **When it runs** (`RemindersProvider`, serialized):
   - app start;
   - back in the foreground (which also tops up the 7 days);
   - plan change, including Configure with AI and undo;
   - any change to a day's records: completion, skip, day type.

   With reminders off, or permission not granted, the desired set is empty.

## Delivery

- Local notifications via `expo-notifications`, on an Android "Reminders" channel. No backend, no network once scheduled.
- **Inexact by design:** no exact-alarm permission is requested. A reminder may arrive a few minutes late.
- **Tapping a reminder** opens the Daily Log on its date with that activity's details sheet (`/?date=…&focus=<activityId>`). This works whether the app was running or not.
- The web test surface uses an in-memory stand-in (`notifications.web.ts`) with the same interface, so E2E tests drive the real logic.

## Permission and settings UI (#30)

- The ☰ menu has **Reminders**, with its status in the row: "Off · reminders from your plan", "On · next: Fixed lunch at 11:55 am", or "Blocked in system settings".
- **Reminders sheet (off):** what reminders are, the plan's reminders for today, and one primary action, **Turn on reminders**. That tap is the **only** place the app asks the OS for permission. It never asks on launch and never re-asks by itself.
- **Reminders sheet (on):** a switch with the next reminder, and today's list. Already-done items show "won't remind".
- **Blocked:** the sheet says so, with "Open settings". The rest of the app works normally.
- No reminder prompt appears on the Daily Log; reminders live in the menu.
