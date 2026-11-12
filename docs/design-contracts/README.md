# Design contracts

> **Architecture:** the Daily Log is the primary application surface. Today is the current date within that log. Every date uses the same underlying day view, canonical data model and editing behaviour. New capabilities extend the shared model and continuous history rather than creating isolated feature slices.

These documents are **authoritative** for implementation. Code that disagrees with a contract is a bug, unless the contract is changed first. Change a contract in its own commit, and update this index when you add or remove one.

| # | Contract | Covers |
|---|----------|--------|
| 01 | [Product & mobile UX](01-product-ux.md) | Platform targets, visual and interaction principles, what V1 excludes |
| 02 | [Navigation & interactions](02-navigation-interactions.md) | Layout layers (app shell, screen header, content) and vertical budget, the Daily Log, routes, date navigation, tap/swipe/drag rules |
| 03 | [Plan format](03-plan-format.md) + [`plan.schema.json`](plan.schema.json) | The versioned JSON plan package the app renders (formatVersion 1–9; v9 adds exact equipment/station access; v3 adds meal ingredients and preparation, v4 activity reminders, v5 due times, v6 the setup profile) |
| 04 | [Persistence & data ownership](04-persistence.md) | What is stored, where, who owns it, export |
| 05 | [Web & phone-viewport testing](05-web-viewport-testing.md) | Web as a test surface, viewports, Playwright, responsive sweep |
| 06 | [Observations, import & export](06-observations-import-export.md) | Canonical observation model, provenance, full-history export, backup, health data sync (screenshot import removed, #138) |
| 07 | [AI configuration](07-ai-configuration.md) | Sectioned configuration over the plan, partial-update protocol, importer, preview, history/undo, AI instructions |
| 08 | [Daily prescription](08-daily-prescription.md) | Prescription from plan + config, requirements with alternatives, windows, next action, completion log |
| 09 | [Exercise guides](09-exercise-guides.md) | Reusable exercise definitions, bundled illustrations, the read-only guide sheet |
| 10 | [Reminders](10-reminders.md) | Plan-defined local notifications, the device on/off preference, reconcile-based scheduling, permission UX |
| 11 | [Settings & energy display](11-settings-energy-display.md) | The Settings sheet, device preferences, energy shown in kJ, kcal or both, conversion and rounding |
| 12 | [Android Health Connect](12-health-connect.md) | Read-only import of steps, active energy, workouts, weight and sleep; permissions, sync, mapping, precedence, failure modes, Play declaration |
| 13 | [First-run setup](13-first-run-setup.md) | The setup wizard: questions, the offline starter plan from bundled presets (exercise and sample meals), Exercise and Meals review with swaps, optional AI refinement, under-18s, resume, editing setup on an existing plan, the nutrition hook |
| 14 | [Progress](14-progress.md) | The Progress tab: range, this week vs last, measurement and weight-trend charts, calculated vs estimated vs measured values, editable chart order and visibility |
| 15 | [Photo meal logging](15-photo-meal-logging.md) | Log different meal: the photo → share with AI → paste → review wizard, the versioned reply contract and parser, photo storage and privacy, replace semantics, day totals without double counting |
| 16 | [Optional quests & achievements](16-gamification.md) | Opt-in, capped reversible XP, levels, recovery, milestones, gallery, artwork and deterministic journey |
| 17 | [Approved branding & icons](17-branding.md) | Immutable masters, launcher/adaptive/notification/splash/store assets, startup and verification scope |
| 18 | [My Gym](18-my-gym.md) | Grouped equipment access, independent stations, one availability resolver, migration 9, offline images and history preservation |
| 19 | [Recommended Resistance Training](19-recommended-resistance.md) | Optional history-based muscle recommendation, shared recovery/availability, planned workload and canonical logging |

Example fixture: [`fixtures/plans/generic-example.plan.json`](../../fixtures/plans/generic-example.plan.json).

The first-pass proposal (screens, wireframes, gestures, scaffold changes, open questions) is in [`../first-pass-proposal.md`](../first-pass-proposal.md). It is a proposal, not a contract. Once it's agreed, the decisions belong in the contracts above.

Status: agreed in #1, extended by #3, #5, #6, #7, #10, #12, #15, #19, #21, #26, #28, #30, #36, #39, #51, #49, #53, #52, #41 and #97.
