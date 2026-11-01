# Design contracts

These documents are **authoritative** for implementation. Code that disagrees with a contract is a bug, unless the contract is changed first. Change a contract in its own commit, and update this index when you add or remove one.

| # | Contract | Covers |
|---|----------|--------|
| 01 | [Product & mobile UX](01-product-ux.md) | Platform targets, visual and interaction principles, what V1 excludes |
| 02 | [Navigation & interactions](02-navigation-interactions.md) | Screens, routes, tap/swipe/drag rules |
| 03 | [Plan format](03-plan-format.md) + [`plan.schema.json`](plan.schema.json) | The versioned JSON plan package the app renders |
| 04 | [Persistence & data ownership](04-persistence.md) | What is stored, where, who owns it, export |
| 05 | [Web & phone-viewport testing](05-web-viewport-testing.md) | Web as a test surface, viewports, Playwright, responsive sweep |
| 06 | [Observations, import & export](06-observations-import-export.md) | Canonical observation model, provenance, screenshot import, full-history export |

Example fixture: [`fixtures/plans/generic-example.plan.json`](../../fixtures/plans/generic-example.plan.json).

The first-pass proposal (screens, wireframes, gestures, scaffold changes, open questions) is in [`../first-pass-proposal.md`](../first-pass-proposal.md). It is a proposal, not a contract. Once it's agreed, the decisions belong in the contracts above.

Status: **draft for review** (issue #1).
