# Personal Fitness Tracker

A deliberately simple, local-first fitness tracker for Android and iOS, built with Expo, React Native and TypeScript. The app renders a **plan package**, a versioned JSON file, rather than hard-coding a plan. Today shows what the plan says for this day, and you tick it off.

Design contracts (authoritative): [`docs/design-contracts/`](docs/design-contracts/README.md).

## How it fits together

```
plans/seed.plan.json ──▶ validatePlan ──▶ TrackingStore (active plan) ──▶ resolveDay(plan, date, override)
                         (zod + rules)     SQLite on native, localStorage      │
                                           on web                              ▼
                                                    tracking records ──▶ Today screen
```

| Path | What |
|---|---|
| `plans/seed.plan.json` | Bundled seed plan, installed on first run. Edit it, bump `revision`, and ship. |
| `fixtures/plans/` | Generic plans for tests. |
| `src/plan/` | Schema (zod mirror of `plan.schema.json`), validation, date helpers, `resolveDay`. Pure and unit-tested. |
| `src/storage/` | `TrackingStore` interface: `sqliteStore` (native), `keyValueStore` (web), `openStore[.web].ts` selects one. |
| `src/features/today/` | The Today screen and its sheets. |
| `src/ui/` | Theme tokens and platform adapters (`Sheet`, `PhoneFrame`, `haptics`). |
| `app/` | Expo Router routes. Kept thin. |

## Run

```bash
npm install
```

```bash
npm start
```

Press `a` for Android, `i` for iOS, or `w` for web. Web renders inside a phone-width frame.

## Check

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run test:e2e
```

```bash
npm run check:native
```

- `npm test` runs unit tests, plus Today rendered under the iOS and Android presets.
- `npm run test:e2e` runs Playwright on the web export at 360, 390 and 430 px. Run `npx playwright test --update-snapshots` after an intended visual change.
- `npm run check:native` bundles iOS and Android and compiles Hermes bytecode.

## Changing the plan

Edit `plans/seed.plan.json`, keeping it valid against `docs/design-contracts/plan.schema.json`. `npm test` checks this. Then bump `revision`. Installed apps pick up a higher revision of the same plan `id` on next launch, and tracking history is kept.
