# 01 · Product & mobile UX

## Platform

- **Targets:** Android and iOS phones, portrait only. Built with React Native, Expo (managed workflow, Expo Router) and TypeScript in strict mode.
- **Use native behaviour:** use React Native core components and Expo or community wrappers that render native controls and follow platform conventions: back gesture or button, keyboard types, safe areas, haptics and form-sheet presentation. Don't hand-roll a component a platform wrapper already provides.
- **Platform differences are allowed** where each platform expects different behaviour (sheet styling, haptics, date pickers). Layout and information hierarchy stay identical across platforms.
- **Web is a development and test surface, not a product.** It renders the phone app inside a phone-sized frame (see 05). Don't write web-only layouts, hover-dependent UI or desktop breakpoints.
- **Phone only.** No tablet or desktop design work. Wider screens show the same phone column, centred.

## Principles

1. **Today first.** The app opens on today. Ticking off an activity or logging a measurement is at most two taps from launch.
2. **The plan is data.** Every user-visible plan word, number, time and target comes from the loaded plan package (03). Components contain layout and generic copy only ("Today", "Done", "Skip"). No personal content in source code.
3. **One primary action per surface.** Each screen or sheet has one obvious thing to do. Secondary actions are smaller or one level down. Never more than about 5 tappable controls above the fold on Today, not counting activity rows.
4. **Calm hierarchy.** Use one display size for the screen title, one for section headings and one body size, with muted secondary text. Use colour for state (done, skipped, over target), not decoration. Don't use badges, streak confetti or red numbers for normal progress.
5. **Generous touch targets.** At least 48×48 dp on Android and 44×44 pt on iOS, with rows at least 56 dp tall. Keep at least 8 dp between adjacent targets.
6. **Direct manipulation where it removes steps.** Gestures must save effort over an existing tap path. They are never the only way to do something (see 02).
7. **Honest, forgiving tracking.** You can undo anything for the current and previous day without confirmation dialogs. Missed items are shown neutrally, not as failure.
8. **Accessible by default.** Every control has an accessibility label and role. Text scales with the system font size up to 200% without clipping essential content. Custom gestures are exposed as `accessibilityActions`. Contrast is at least WCAG AA.

## Visual system

- Use a small set of theme tokens (colours, spacing on a 4 dp scale, radii, type scale) defined in one place. Components never hard-code colour hex values.
- Light theme in V1. Tokens are structured so a dark theme can be added without touching components. (Open question: see proposal §7.)
- System font. Show numbers with tabular figures where they change in place, such as counts and weights.

## Out of scope for V1

Accounts, login, a backend, sync, social features, food database or barcode logging, wearables or health-platform import, notifications or reminders, in-app plan editor, charts beyond a simple trend, multiple concurrent plans, tablet or desktop layouts, landscape.

Anything here needs a contract change before it's built.
