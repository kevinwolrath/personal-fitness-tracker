# Issue #100 · local verification

8 November 2026, Windows local workspace. No live Play operation or workflow dispatch was performed. No signing key or package identity changed. Google credentials were not retrieved; only GitHub secret names and environment metadata were inspected.

| Check | Final result |
|---|---|
| `npm run store:prepare` | Passed: production web export, four actual app captures, feature graphic/icon, manifest and offline validation. All six images visually inspected. |
| `npm run store:validate` | Passed, zero API calls; six assets, en-AU, correct package. |
| `npm run typecheck` | Passed. |
| `npm test -- --ci --runInBand --watch=false` | **754 passed**, 55 suites, across scripts/unit/iOS/Android. Initial contended run had one native timeout; isolated rerun and complete final rerun passed. |
| Release automation coverage within Jest | **25 tests** across new listing validation/transactions and existing resumable upload integration tests. Includes wrong AAB version/existing draft refusal and edit cleanup. |
| Production `npm run test:e2e -- --workers=4` on port 8098 | **432 passed, 108 skipped, 21 failed**. Final run used a fixed export without concurrent regeneration/Metro. |
| Dev smoke, port 8099, 120s cold-start budget | **1 passed**. Earlier attempts hit a 30s cold navigation timeout and a Metro watcher race during concurrent production-test cleanup; the isolated final run passed in 25.6s. |
| `npm run check:native` | Passed Android and iOS exports with the configured branded icon. No signed release AAB was built in this task. |
| Workflow checks | Three modified/new YAML workflows parsed; seven extracted PowerShell blocks parsed; `bash -n scripts/google-play-release.sh` passed; `git diff --check` passed. No workflow execution claimed. |

The 21 browser failures are **17 visual baseline comparisons**, **3 browser clipboard/share cases** (one per width), and **1 small-phone meal interaction**. No production screen code was changed for this ticket, and these unrelated baselines were not refreshed. This is not a claim that the full browser suite is green or that a separate clean-develop baseline run was performed. Existing browser tests rewrite some documentation captures as a side effect; those changes were restored and are excluded from this PR.

GitHub metadata confirmed all existing signing/service-account secret names, and **zero configured deployment environments**. The two protected environments and their account-specific settings must be configured before enabling listing commits. Play locale/API permissions, policy/privacy/health declarations, account testing eligibility, signed-AAB upload and live commit behavior remain unverified; see the [exact owner setup checklist](google-play-listing.md#one-time-manual-setup--owner-must-confirm).

Screenshots are actual production-web phone captures (1170×2340), not native Android screenshots or proposed UI. Confirm native parity before Play publication. They use the repository seed plan with empty tracking history; no fabricated measurements, completions or achievements. The shipped package remains reviewable without Play credentials.
