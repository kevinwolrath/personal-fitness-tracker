# Design contracts

> **Architecture:** the Daily Log is the primary application surface. Today is the current date within that log. Every date uses the same underlying day view, canonical data model and editing behaviour. New capabilities extend the shared model and continuous history rather than creating isolated feature slices.

These documents are **authoritative** for implementation. Code that disagrees with a contract is a bug, unless the contract is changed first. Change a contract in its own commit, and update this index when you add or remove one.

| # | Contract | Covers |
|---|----------|--------|
| 01 | [Product & mobile UX](01-product-ux.md) | Platform targets, visual and interaction principles, what V1 excludes |
| 02 | [Navigation & interactions](02-navigation-interactions.md) | Layout layers (app shell, screen header, content) and vertical budget, the Daily Log, routes, date navigation, tap/swipe/drag rules |
| 03 | [Plan format](03-plan-format.md) + [`plan.schema.json`](plan.schema.json) | The versioned JSON plan package the app renders (formatVersion 1–3; v3 adds meal ingredients and preparation) |
| 04 | [Persistence & data ownership](04-persistence.md) | What is stored, where, who owns it, export |
| 05 | [Web & phone-viewport testing](05-web-viewport-testing.md) | Web as a test surface, viewports, Playwright, responsive sweep |
| 06 | [Observations, import & export](06-observations-import-export.md) | Canonical observation model, provenance, screenshot import, full-history export |
| 07 | [AI configuration](07-ai-configuration.md) | Sectioned configuration over the plan, partial-update protocol, importer, preview, history/undo, AI instructions |
| 08 | [Daily prescription](08-daily-prescription.md) | Prescription from plan + config, requirements with alternatives, windows, next action, completion log |
| 09 | [Exercise guides](09-exercise-guides.md) | Reusable exercise definitions, bundled illustrations, the read-only guide sheet |

Example fixture: [`fixtures/plans/generic-example.plan.json`](../../fixtures/plans/generic-example.plan.json).

The first-pass proposal (screens, wireframes, gestures, scaffold changes, open questions) is in [`../first-pass-proposal.md`](../first-pass-proposal.md). It is a proposal, not a contract. Once it's agreed, the decisions belong in the contracts above.

Status: agreed in #1, extended by #3, #5, #6, #7, #10, #12, #15, #19, #21 and #26.
