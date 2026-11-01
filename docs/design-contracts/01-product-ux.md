# 01 · Product & mobile UX

## Platform

- **Targets:** Android and iOS phones, portrait only. Built with React Native, Expo (managed workflow, Expo Router) and TypeScript in strict mode.
- **Use native behaviour:** use React Native core components and Expo or community wrappers that render native controls and follow platform conventions: back gesture or button, keyboard types, safe areas, haptics and form-sheet presentation. Don't hand-roll a component a platform wrapper already provides.
- **Platform differences are allowed** where each platform expects different behaviour (sheet styling, haptics, date pickers). Layout and information hierarchy stay identical across platforms.
- **Web is a development and test surface, not a product.** It renders the phone app inside a phone-sized frame (see 05). Don't write web-only layouts, hover-dependent UI or desktop breakpoints.
- **Phone only.** No tablet or desktop design work. Wider screens show the same phone column, centred.

## Principles

1. **One continuous Daily Log, opening on today.** The app is a diary through time; Today is the current date in it (02). Ticking off an activity or logging a measurement is at most two taps from launch. Any past date is a jump away and looks and behaves the same.
2. **The plan is data.** Every user-visible plan word, number, time and target comes from the loaded plan package (03). Components contain layout and generic copy only ("Today", "Done", "Skip"). No personal content in source code.
3. **One primary action per surface.** Each screen or sheet has one obvious thing to do: **at most one primary button (`Button` variant `primary`, or `inverse` on an ink card) is shown at a time**. When a flow moves on, the primary moves with it, and earlier actions become secondary. `e2e/surfaces.spec.ts` counts them on every surface. Secondary actions are smaller or one level down. Never more than about 5 tappable controls above the fold on Today, not counting activity rows.
4. **Calm hierarchy.** Use one display size for the screen title, one for section headings and one body size, with muted secondary text. Use colour for state (done, skipped, over target), not decoration. Don't use badges, streak confetti or red numbers for normal progress.
5. **Generous touch targets.** At least 48×48 dp on Android and 44×44 pt on iOS, with rows at least 56 dp tall. Keep at least 8 dp between adjacent targets.
6. **Direct manipulation where it removes steps.** Gestures must save effort over an existing tap path. They are never the only way to do something (see 02).
7. **Honest, forgiving tracking.** You can undo anything, and correct any past day, without confirmation dialogs. Missed items are shown neutrally, not as failure.
8. **Layered layout, content first.** Every screen is built from three layers in a fixed order: the app shell, the screen header, then the content (02, "Layout layers"). Controls belong to exactly one layer. Never place a control wherever it happens to fit. Chrome is kept small, so the content a screen exists for is visible without scrolling. This is held to a measured vertical budget, enforced by tests.
9. **Accessible by default. Every control has an accessibility label and role. Text scales with the system font size up to 200% without clipping essential content. Custom gestures are exposed as `accessibilityActions`. Contrast is at least WCAG AA.

## Visual system

- Use a small set of theme tokens (colours, spacing on a 4 dp scale, radii, type scale) defined in one place. Components never hard-code colour hex values.
- **Light theme only in V1** (decided in issue #3; `userInterfaceStyle: "light"`). Tokens live in `src/ui/theme.ts` and are structured so a dark theme can be added without touching components.
- System font. Show numbers with tabular figures where they change in place, such as counts and weights.

## Out of scope for V1

Accounts, login, a backend, sync, social features, food database or barcode logging, wearables or health-platform API integrations (screenshot import is in scope; see 06), notifications or reminders, in-app plan editor, charts beyond a simple trend, multiple concurrent plans, tablet or desktop layouts, landscape.

Anything here needs a contract change before it's built.
