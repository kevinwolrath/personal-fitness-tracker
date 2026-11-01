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
- Tests start from a **fresh install**, so the bundled seed plan loads exactly as it does for a user. To test a different plan, `seedPlan()` in `e2e/helpers.ts` writes it into the web store before the app boots. The generic fixture is used this way to cover features the seed doesn't exercise, such as the flexible-meal budget.
- Playwright runs against the **static web export** (`expo export --platform web`, served by `scripts/serve-dist.mjs`), not the dev server, so runs are deterministic.
- **The clock is frozen** (`page.clock.setFixedTime`) to a fixed date per test, with `timezoneId: Australia/Melbourne` and `locale: en-AU`, so the weekday, day type and formatting are deterministic. The reference days are Monday 2026-11-02 (home), Thursday 2026-11-05 (office) and Saturday 2026-11-07 (weekend).
- Visual baselines live in `e2e/__screenshots__/`. Each day gets a first-screen capture and a `-full` capture taken with the viewport grown to the scroll height.
- Gestures are tested through their tap or accessibility equivalents. Any swipe shortcut added later gets one smoke test with touch emulation. V1 has none.
- Every screen gets an automated check: no horizontal overflow at `phone-small`, and touch targets at least 44 px.
- **Responsive sweep** (`e2e/responsive.spec.ts`): Monday, Thursday and Saturday are rendered at 320, 340, 360, 375, 390, 412, 430, 500, 768 and 1280 px. It fails if any element leaves the phone frame, any text is clipped, or content spills out of a clipping parent. That catches card-level overflow (for example a value pushed out of its card), not just page scroll.
- The Claude API is stubbed at the network layer in Playwright (`e2e/claudeStub.ts`), so the real SDK request and parsing path runs with canned model output. No test calls the real API.

## Required test coverage before a screen is "done"

1. Renders the resolved day from plan data: the correct activities for a frozen Monday, Thursday and Saturday.
2. Happy path: complete a check activity, advance a count activity to its target, log weight, quick-log.
3. State survives reload (persistence through the web storage backend).
4. Visual snapshot at `phone`.
5. Type check (`tsc --noEmit`) and plan-fixture validation against `plan.schema.json` pass in CI.

Native code paths are checked without a device by:

- Jest projects `ios` and `android` (`jest-expo/ios`, `jest-expo/android`), which render real screens with native platform files (`*.native.test.tsx`).
- `npm run check:native` (`expo export` for iOS and Android), which bundles and compiles Hermes bytecode for both platforms.

On-device verification stays manual until a device test runner is chosen.
