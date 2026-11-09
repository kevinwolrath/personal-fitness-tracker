# 16 · Optional quests & achievements (#73)

Gamification starts **off**. Settings → Quests & achievements is a device switch. Off hides all quests, XP, gallery cards and celebrations and does not alter tracking. Re-enabling projects existing records quietly. Today, Progress and the existing Plan access retain their navigation. No new tab, shell control, permission or notification.

## Surfaces and artwork

Today adds a compact content card **after** the existing workout, measurements and targets. It never moves the main recommendation or first measurement below its existing vertical budget. Progress adds the same summary with gallery access before charts. Both open one shared scrollable sheet listing plan quests and locked/unlocked achievements. Controls use shared tokens, touch targets, ModalHeader and ScrollView. The off state adds no Today spacing. Celebrations are inline, politely announced, dismissible, without animation, sound, timers or notification pressure. They support reduced motion by construction. Multiple rewards from one action produce one panel, prioritizing milestone, level, achievement, then quest.

The reusable generated fitness emblem uses an industrial hexagon, charcoal metal, orange trim, cyan highlights and comic illustration. Locked badges have muted artwork plus explicit **Locked** text. No fantasy styling, new characters or gender variants. `assets/hero-forge/achievements/forge-emblem.png` is production art generated from the owner's approved written direction. The original approved reference PNG was absent and is not misrepresented as this new asset.

## Scoring and correctness

All numbers live in `src/gamification/model.ts` → `scoring`: 20 XP per purpose/day, 20 recovery, maximum 80 daily XP; 40 XP for 3 separate days of quests in a calendar Monday–Sunday week; 200 XP per level. No consecutive-day requirement. There is no deadline notification or penalty for missing a day. Weekly progression repeats indefinitely, even after weight goals.

XP is a pure projection of the **current canonical records**, not an append-only credit ledger. One semantic key per plan + local date + purpose combines alternatives, duplicate imports, edits, repeated taps and meals. Conditioning intensities share one purpose cap. Daily steps meet an existing walking quest at 3,000; more steps never add XP. Imported workout minutes, calories, calorie deficits, weight loss speed, workout volume and extra exercise sets never grant XP. Actual meal records qualify for one planned nutrition quest irrespective of calorie amount. We reward recording food, never restriction.

Historical saved prescription membership is used when available, then the applicable configuration revision. Current log status determines completion, so undo, delete, corrected and backdated entries immediately reproject XP, levels and locked states. Future records do not count. A successful store mutation invalidates the projection after persistence, across imports, observations, exercises, meals and undo. Storage failures never trigger a reward. Older plan histories remain scoped to their own plan. User-owned observations continue to span plans as in existing tracking.

Scheduled rest and recorded injury suppress strength/conditioning quests. A recovery quest uses a canonical quick-log record (`gamification-recovery`); an explicit Log recovery / Undo recovery control acknowledges rest without requiring a workout. No automatic XP for simply opening the app. Recovery has equal XP. Injury conservatively suppresses training rewards until cleared; tracking itself is unaffected.

Achievements recognize 1/30/90 separate days, 12 strength days and 4 recovery days. Repetition thresholds are not streaks. A performance milestone compares the same movement's recorded reps on separate dates at least 28 days apart, with a 20% improvement. Goal milestones use the plan's own measurements, units, targets and direction, including custom strength capability measurements. Halfway and goal recognition require at least 28 days of observations; weight recognition is suppressed if any observed interval exceeds 1% loss/week. Under-18 profiles have no body/goal milestone badges. No milestone grants additional XP. These are recognition rules, not medical targets.

## Persistence and migration

No tracking schema changes or migration required: canonical quick logs, activities, meals and observations already support the feature. Existing SQLite migrations and web documents remain unchanged. Device preference `pft.gamification.v1` contains `{version:1, enabled, seen}`. Missing, malformed or unknown versions default off. Seen semantic reward ids suppress celebration replay after reload, off/on, corrected records or duplicate sync; only committed live changes celebrate. Imported history and initial opt-in catch up quietly. Preference writes are serialized and expose a retry message on failure. They are device preferences, outside tracking export, like theme/reminders.

## Validation

Pure projection and persistence integration tests cover deduplication, reversals, future/backdated records, reward caps, long-term goals, unsafe loss, injuries, legacy document reads and storage failures. Playwright uses isolated storage, a fictional adult, controllable clock and browser Health Connect fixtures at 360/390/430 px. Screenshots and per-width pass/fail reports live in `docs/design/issue-73-gamification/`. Native export checks module compatibility; real Health Connect permission/provider behavior requires Android hardware.
