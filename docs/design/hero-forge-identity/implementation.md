# Proposed implementation contract · pending visual approval

No steps in this file have been applied to production for #96. It specifies how the chosen visuals would fit the existing application.

## Theme architecture

Keep `src/ui/theme.ts` registry, `ThemeProvider`, IDs `hero-forge` / `classic`, device preference and failure/retry behavior. Add semantic component recipes to the theme: panel edge/corner, primary/secondary/quiet buttons, selection/check shape, tabs/segments, status/tag, divider and input/empty-state surface. Classic’s current appearance is its own recipe; it must not inherit Hero Forge bevels. Replace heuristic “rounded surface implies border” where recipes explicitly own edges, avoiding doubled borders.

Add a typed shared `Icon` component with theme-owned path selection, `react-native-svg` (already installed), standard size/stroke and accessibility hidden when an adjacent label names the control. Pressable owns role, label, selected/checked/disabled state and ≥48 px target. Keep visible Today/Progress labels. Status glyphs always accompany status words; existing colour/pattern semantics remain. Do not turn the preview’s HTML/CSS into a web-only production view.

Use the existing system font and 4 dp spacing tokens. Titles 32/800, section labels 12–13/700+, body 16–17, secondary 14; use tabular numerals for changing measures. Metallic gradients in proposals express tonal hierarchy; production may use layered solid surfaces where native rendering warrants it, subject to visual comparison. No new font, gradient or icon package is assumed.

## Controls, layers and budget

| Layer | Controls | Budget / behavior |
|---|---|---|
| App shell | Menu, compact anvil/name, Today/Progress tabs | Existing 48 dp app bar + top safe area; 56 dp tab area + bottom safe area. No extra brand strip or third tab. |
| Screen header | Date navigation/jump/share/return Today, title/day type/progress; Progress title/Edit charts/range | Keep current responsive share-label strategy and Today content start ≤200 px including app bar. Do not place additional controls above it. |
| Content | Next action, compact workout, measurement/target/day sections; real charts; coverage and exercises | One primary action; compact workout ≤200 px; longer rows wrap in full sheet. Preserve plan/model words, doses, status and action names. |
| Sheets | Existing fixed Close/Cancel/title/Confirm, scrollable body, required fixed Save/Apply actions | Preserve nested sheet ownership, 92% panel, native dismissal/back, insets and keyboard avoiding. Sheet Close is outside scroller and remains reachable. |

No controls move between shell/header/content to fit the new artwork. The preview shows profile-selected female front/back in workout and the existing male kettlebell exercise pose in guide; production selection rules remain exactly as today. Existing maps render at their current anatomical coordinate system, never via CSS transforms or newly traced regions.

## Shared rollout sequence after approval

1. Implement chosen theme recipes, original Icon wrapper and shared Button/check/radio/status primitives; verify Classic is unchanged.
2. Integrate shell/header/navigation and five approved surfaces. Retain current row click/check/info targets, loading/empty/error/disabled states and below-fold secondary actions.
3. Apply those shared recipes throughout the audit matrix: log/measurement/meal/share/date sheets; charts/edit charts; coverage and guide; Settings/Health Connect/reminders; import/configure/setup and shared confirmation/toasts.
4. Preserve shared `src/ui/ScrollView` and root web indicator suppression from #93. Never replace scrolling with clipping or hidden overflow. Test touch/wheel/keyboard, long text, sheet bottom reachability and multiline input.
5. Compare real 390 px screenshots against the approved option and original references. Review every changed surface, not just token snapshots.

## Verification required for the implementation PR

- Typecheck, Jest, full production E2E, development smoke, native export, and relevant existing targeted suites for theme/preferences/shell/logging/workout/coverage/guide/progress/import/configuration/setup/Health Connect/reminders/sharing.
- Intentional production screenshot baseline changes only after whole-screen inspection. Add focused tests for theme recipe selection and meaningful accessibility/state contracts; avoid tests that merely repeat SVG path strings.
- Sweep 360/390/430 px, 200% system text, native Android and iOS safe-area/keyboard/back behavior. Check no hidden final action, no horizontal overflow, meaningful disabled/selected states and real 48 px targets. Verify status/icon contrast against actual composited surfaces.
- All bundled hero/step assets load offline; overlays and inventory retain all 14 groups. Guides remain read-only; no model/plan/persistence mutations from opening visual surfaces.
- Show before/after screenshots for all modified surface groups; report failures candidly rather than refreshing unrelated baselines. Open implementation PR into develop only after approval. No auto-merge or release.
