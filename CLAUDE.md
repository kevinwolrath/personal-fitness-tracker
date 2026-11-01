# Working on this repo

## Ticket workflow (always)

For every GitHub issue:

1. **Branch:** create a new branch from the latest `develop`, named `claude/issue-<number>-<short-slug>` (for example `claude/issue-10-daily-prescription`). One branch per ticket. Never reuse a branch whose PR has been merged.
2. **Document the start:** comment on the issue that work has started, with the planned approach and any questions or decisions that need the owner.
3. **Implement** in small, logical commits that reference the issue (`(#<number>)`).
4. **PR:** open a pull request into `develop` with `Closes #<number>`. The description covers what was built, design decisions, how each acceptance criterion is covered, the checks run, and anything not done.
5. **Document the result:** comment on the issue with a summary, decisions to review, follow-ups, and a link to the PR.

`develop` is the default branch. `main` is not used for day-to-day work.

## Before opening a PR

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
npm run test:e2e:dev
```

```bash
npm run check:native
```

After an intended visual change, refresh the baselines with `npx playwright test --project=phone --update-snapshots=all`, and look at the images before committing them.

## Ground rules

- `docs/design-contracts/` is authoritative. Change the contract in the same PR as the behaviour it describes.
- The Daily Log is the primary surface. Extend the shared model; don't build isolated feature slices (contract 02).
- The plan is data. No plan content or personal data in UI code (contract 01).
- Business rules live in pure modules (`src/plan`, `src/prescription`, `src/config`, `src/observations`), not in components.
- Storage changes are additive, numbered migrations, tested against the previous schema (contract 04).
- No CI build runs in GitHub Actions. The APK is built locally with `scripts/build-apk.ps1`.
