# Issue 98: guide consistency audit and layout choice

Started from develop `6a6388b` on `codex/issue-98-guide-consistency`. The issue is a current-app acceptance audit; delivered hero poses are reused, not regenerated.

## Findings so far

- Action illustrations and front/rear maps already use the explicit male/female profile and neutral for absent/other/unknown, as required by authoritative contract 09. Historical issue wording asking for female fallback conflicts with that later approved rule; do not silently change existing users.
- Edit setup answers already has a profile-only save path, preserving schedule, meals, activities and targets. Verify the actual journey and hero changes rather than add another selector.
- `ExerciseMuscles` still uses Show/Hide activated muscles and only the bundled inventory. Always-visible activation and shared/custom mappings remain to be addressed.
- Current guide keeps Close fixed and the pager at 4:3, but an expanded full-size body map is tall and appears after instructions.

## 390px options (approval required)

- **A — Compact strip after demonstration (recommended):** retain a readable movement frame and controls, then an always-mounted compact front/rear activation strip with primary/secondary labels before equipment/instructions. Keeps the main task first and removes the extra tap.
- **B — Demonstration and activation together:** a shorter side-by-side visual band. Most information above the fold, but the movement demonstration is smaller on narrow phones.
- **C — Activation summary first:** compact always-mounted activation above the existing movement pager. Muscle information is immediate, while the movement starts lower.

Run `node docs/design/issue-98/build-options.cjs` to regenerate `options.html`; open it with `?option=a`, `b` or `c`. The mock-ups use the existing female push-up pose, approved female front/rear PNGs and the exact existing muscle-region paths. Cyan fills/secondary dashes are activation, not recovery or costume-orange accents. Prescription values are illustrative. No production UI has changed.

All controls remain in exercise-guide sheet content except the existing fixed ModalHeader/Close. No shell/Today header or 200px-budget change. The proposed map sizes are previews for a phone, not tablet/desktop layouts.

Next: after owner choice, update contract 09 in its own commit, implement the agreed layout and shared mappings, test all profile variants/unknown fallback, all 31 movements, relevant regions, profile-only persistence, read-only guide browsing, offline native bundles and phone scrolling. Record actual before/after captures and any remaining physical-device limits in the PR.
