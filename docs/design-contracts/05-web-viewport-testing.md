# 05 · Web & phone-viewport testing

## Web's role

Web (`expo start --web`, react-native-web) exists for **fast iteration, Playwright and visual regression**. It must behave like a phone:

- The root layout constrains the app to a **phone column**: full width up to 430 px, then centred at 430 px wide on a neutral backdrop. There are no responsive breakpoints above that.
- Safe-area insets are zero on web. Layouts must still look correct with real insets (verify on device or simulator).
- Native-only features (haptics, share sheet, document picker) sit behind a tiny platform adapter with a web fallback (no-op, download, `<input type=file>`). Screens never branch on `Platform.OS` directly.
- Never rely on hover, right-click, keyboard shortcuts or desktop scroll behaviour.

## Reference viewports

| Name | CSS px | Represents |
|---|---|---|
| `phone-small` | 360 × 780 | Common Android baseline |
| `phone` | 390 × 844 | iPhone 13/14/15 class (default) |
| `phone-large` | 430 × 932 | iPhone Pro Max class |

All three run with `isMobile: true`, `hasTouch: true` and `deviceScaleFactor: 3`. Visual baselines are stored for `phone` only. The other two viewports run functional and overflow checks.

## Playwright conventions

- Tests target **accessibility roles and labels first** (`getByRole`, `getByLabel`). Use `testID` (rendered as `data-testid`) only where no accessible name fits.
- Tests load the plan through a seed hook. The default fixture is `fixtures/plans/generic-example.plan.json`, so assertions are about that generic data and never personal data.
- **The clock is frozen** (`page.clock`) to a fixed date per test, so the weekday and day type are deterministic. Example: Monday 2026-11-02 resolves to `home`, and its strength session is present.
- Gestures are tested through their tap or accessibility equivalents. Swipe shortcuts get one smoke test each, with touch emulation.
- Every screen gets an automated check: no horizontal overflow at `phone-small`, and touch targets at least 44 px.

## Required test coverage before a screen is "done"

1. Renders the resolved day from the fixture: the correct activities for a frozen Monday and a frozen Saturday.
2. Happy path: complete a check activity, advance a count activity to its target, log weight, quick-log.
3. State survives reload (persistence through the web storage backend).
4. Visual snapshot at `phone`.
5. Type check (`tsc --noEmit`) and plan-fixture validation against `plan.schema.json` pass in CI.

Native (Android and iOS) is verified manually on device or simulator for each screen until a device test runner is chosen (out of scope here).
