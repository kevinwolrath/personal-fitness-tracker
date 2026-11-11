# Health data sync API (#134): app-side contract

Body Anvil's health-data client talks to a **Cloudflare Worker + D1 backend hosted in Questspire Studio** (Questspire
Studio #4, owned by Codex). This document is the contract the app implements. The backend should match it, or the
two should be reconciled on #134 before release. Automated tests use an in-memory fake of this contract
(`src/healthSync/__tests__/fakeServer.ts`); the deployed Worker is checked with `npm run check:sync-server` (below).

No Cloudflare account, domain or credential is in this repository. Nothing here was deployed.

## Base URL

The API base URL is a **build setting**, `EXPO_PUBLIC_BODY_ANVIL_API_URL` (#146), read only in
`src/healthSync/config.ts`. It's inlined into the JS bundle when the app is built, and users never enter or see it.

**Rules:**
- There is no default. Without a valid value, syncing and sharing are off and the sheet says so. The app never falls
  back to another address.
- Release builds (Play AAB, test APK, web export) accept `https://` only.
- Dev builds (`__DEV__`) also accept `http://` to a development host: `localhost`, `10.0.2.2` (the Android emulator's
  address for your PC), or a private LAN address (`10.x`, `192.168.x`, `172.16–31.x`) for a physical phone on the
  same Wi-Fi.
- No user, password, query or fragment is allowed in the address. A trailing slash is ignored.
- **The value is the site only.** Production is `https://questspirestudios.com`. The app adds `/api/body-anvil/v1`
  itself (#155). A value that already ends in it is tolerated by the app (the duplicate is dropped), but release builds
  (Play workflow, `google-play-release.sh`, `build-apk.ps1`) refuse it, so the setting stays correct.

All paths below are under `/api/body-anvil/v1`. Requests and responses are `application/json`.

## CORS (web build) (#155)

Browsers only let the web app read the API's replies if the Worker allows the page's origin. Android isn't affected.
The app sends `Content-Type: application/json`, `Authorization` and `X-Enrollment-Key`, so the browser sends a
preflight (`OPTIONS`) before every request. The Worker must:

1. Answer `OPTIONS` on every `/api/body-anvil/v1/*` path before routing, auth, the enrollment-key check or rate
   limiting, with `204` and, for an allowed origin:
   - `Access-Control-Allow-Origin: <the request's Origin>`
   - `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`
   - `Access-Control-Allow-Headers: Content-Type, Authorization, X-Enrollment-Key`
   - `Access-Control-Max-Age: 86400`
   - `Vary: Origin`
2. Add `Access-Control-Allow-Origin` (allowed origins), `Vary: Origin` and `Access-Control-Expose-Headers: Retry-After`
   to **every** response, errors included. Without them the browser hides the error and the app can only say it
   couldn't reach the server.
3. Take the allowed origins from a Worker setting. Include `http://localhost:8081` (`npx expo start --web`) and wherever
   the web build is hosted.
4. Not send `Access-Control-Allow-Credentials`: the app uses bearer tokens, not cookies.

## Checking the real server

```bash
npm run check:sync-server -- https://questspirestudios.com
```

`scripts/check-sync-server.cjs` checks the live API against this contract: it's reachable, unauthenticated and keyless
requests get JSON `401`s, unknown routes a JSON `404`, and CORS works for the web origin (`--origin`, default
`http://localhost:8081`), on error responses too. It sends no enrollment key or owner token, so nothing is created. With
no argument it reads `EXPO_PUBLIC_BODY_ANVIL_API_URL` from the environment or `.env.local`. Behind an HTTPS proxy, run
it with `NODE_USE_ENV_PROXY=1`. Run it after any Worker deploy and before a release that changes sync. The e2e tests
can't catch server problems: they use the in-memory fake, and Playwright answers CORS preflights itself for
intercepted requests.

## Identity

- **Data ID** (`userId`): a random UUID v4 made by the app once and kept in its local database (`app_meta`), so a
  full backup carries it to a new phone.
- **Owner token**: issued by the server at enrollment; random, at least 128 bits. Sent only as
  `Authorization: Bearer <token>`. It is never put in a URL, logged or included in a shared document.
- **Enrollment secret**: random (256 bits, base64url), made and saved by the app *before* it first enrolls.

## Enrollment key (#136)

The Worker accepts a first link (enroll) only with the shared **enrollment key** in `X-Enrollment-Key`. The key is
**built into the app**; users never type or see it. It deters casual enrollment against the public API, but anything
bundled into an app can be extracted. No Play Integrity, user codes or extra auth are involved.

- **Source:** `EXPO_PUBLIC_BODY_ANVIL_ENROLLMENT_KEY`, inlined into the JS bundle at build time
  (`src/healthSync/config.ts`).
- **Sent:** only as `X-Enrollment-Key` on `POST /enroll` and its retries, over HTTPS. Never on snapshot GET/PUT, the
  shares endpoints or anything else, and never in a URL, a body, a snapshot, a share, secure storage or a log.
- **Missing from a build:** the first link stops before any request, with "This version of the app isn't set up to
  link to the server yet". Phones that are already linked keep syncing with their owner token.
- **Rejected (`401`/`403` on enroll):** "The server didn't accept this app's enrollment key". Nothing is linked or
  changed. The data ID and the saved enrollment secret are kept, so a later retry is the same idempotent enroll.

### Production (Google Play)

Set two values under GitHub → Settings → Secrets and variables → Actions:
- **Variables** → **`BODY_ANVIL_API_URL`**: the site the Body Anvil API runs on, `https://questspirestudios.com`
  (without `/api/body-anvil/v1`). It's not a secret.
- **Secrets** → **`BODY_ANVIL_ENROLLMENT_KEY`**: the same value as the Worker's production secret of that name.

The build then:
1. **Workflow** (`.github/workflows/google-play-internal.yml`): refuses to start unless both are set and the URL is an
   `https://` base URL.
2. **Container:** both are passed by name, as `EXPO_PUBLIC_BODY_ANVIL_API_URL` and
   `EXPO_PUBLIC_BODY_ANVIL_ENROLLMENT_KEY`.
3. **`scripts/google-play-release.sh`:** refuses to build without either, or with a non-https URL.
4. **After `bundleRelease`,** `scripts/check-build-config.py` checks that the AAB's JS bundle contains both. It prints
   the URL but only present or absent for the key, and blocks the upload when either is missing.

To rotate the key, change both secrets and ship a new build. Older builds then get `401` on enroll; already-linked
phones are unaffected.

### Local development (both repositories)

**Body Anvil (this repo):** copy `.env.example` to `.env.local` (git-ignored) and set:

```bash
EXPO_PUBLIC_BODY_ANVIL_API_URL=http://localhost:8787   # see below for emulator and phone addresses
EXPO_PUBLIC_BODY_ANVIL_ENROLLMENT_KEY=<same value as the Worker's .dev.vars>
```

**Questspire Studio Worker:** in the Worker's directory, put the same value in `.dev.vars` (git-ignored there) and run
it locally:

```bash
BODY_ANVIL_ENROLLMENT_KEY=<a local-only value, not the production key>
```

```bash
npx wrangler dev                 # web and emulator: http://localhost:8787
npx wrangler dev --ip 0.0.0.0    # also reachable from a phone on the same Wi-Fi
```

Then:

| Target | `EXPO_PUBLIC_BODY_ANVIL_API_URL` | Start |
|---|---|---|
| Web | `http://localhost:8787` | `npx expo start --web --clear` |
| Android emulator (dev build) | `http://10.0.2.2:8787` (on Android, `localhost` is the phone, not your PC) | `npx expo run:android` |
| Physical phone (dev build) | `http://<your PC's LAN IP>:8787` (Worker with `--ip 0.0.0.0`) | `npx expo run:android` |
| Sideloadable test APK (release) | an `https://` address only | `./scripts/build-apk.ps1` |

- **Dev builds:** debug builds allow `http://` to these hosts.
- **Test APK:** this is a release build, so `build-apk.ps1` refuses `http://`. It reads both values from the
  environment or `.env.local`. The URL goes in as a build arg; the key goes in as a BuildKit secret, so it's in the APK
  but never in a Docker image layer.

**Always start with `--clear` after changing `.env.local`.** Metro's transform cache keeps inlined `EXPO_PUBLIC_`
values, so without it an old key can survive. The e2e builds always clear, and use a placeholder key, never a real one.

`.env`, `.env.local` and `.env.*` are excluded from Docker build contexts (`.dockerignore`); `.env*.local` is git-ignored.

## Endpoints

| Method and path | Auth | Body | Success |
|---|---|---|---|
| `POST /enroll` | `X-Enrollment-Key` (build-time key) | `{ userId, enrollmentSecret, snapshot }` | `201` (new) or `200` (same `userId` **and** same secret again: idempotent retry) `{ userId, ownerToken, snapshot: Receipt }` |
| `PUT /users/{userId}/snapshot` | owner | the snapshot document | `200 Receipt` (replaces the latest; repeating the same body is harmless) |
| `GET /users/{userId}/snapshot` | owner | – | `200 { snapshot, etag, uploadedAt, bytes }`; `404` when none |
| `POST /users/{userId}/shares` | owner | `{ scope: { days: 7\|30\|90\|null, categories: string[] }, expiresInHours: 1\|24, document }` | `201 ShareLink` |
| `GET /users/{userId}/shares` | owner | – | `200 { shares: ShareLink without url[] }` |
| `DELETE /users/{userId}/shares/{shareId}` | owner | – | `204` |
| `GET /s/{shareToken}` (public, outside `/api`) | none (the token is the capability) | – | `200` the shared `document` as plain `application/json`; `404` when unknown, expired or revoked |

- `Receipt` = `{ etag, uploadedAt (UTC ISO), bytes }`.
- `ShareLink` = `{ shareId, url, createdAt, expiresAt, revokedAt|null, scope, bytes? }`. `url` is
  `https://<host>/s/<shareToken>` and is returned only by `POST`.
- **Shares store the exact `document` the app sent**, which is what the user previewed. A share token can read only its
  own document. It can never upload, change, delete or list anything, or reach other snapshots. Store the token as a
  hash. Public reads: no redirect, no cookies, no JS, `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`.

## Errors

The body is `{ "error": { "code": "...", "message": "..." } }`, never echoing a token or health data. The app maps statuses:
`400`/`422` invalid, `401`/`403` auth, `404` not found, `409` conflict (enroll: this `userId` is already enrolled
with a different secret), `413` too large, `429` rate limited (`Retry-After` seconds honoured), `5xx` server.
The app sends at most 5 MB per document.

## The document (`body-anvil-health`, schemaVersion 1)

Built by `buildHealthPayload` (`src/healthSync/payload.ts`) from the records the app actually stores:
`schema`, `schemaVersion`, `generatedAt`, `app`, `coverage { from, to, requestedFrom, requestedTo }`,
`scope { days, categories }`, `counts`, `readMe`, `omitted`, and the chosen sections:

- `plan`: the plan, without the display name;
- `body`, `activity`, `sleep`: values with `date`, `metric`, `label`, `value`, `unit`, `kind` and `source { type, app, confidence, edited }`;
- `nutrition { dailyTotals, meals }`;
- `training { checklist, exercises, muscleReports }`.

**Never included:** the display name, meal photos and screenshots (and text read from them), location (none
recorded), credentials.

## Open questions for the backend

0. (#136) The issue names `POST /api/body-anvil/v1/enroll`, so all paths moved to the `/api/body-anvil/v1` prefix.
   Is the enroll body's retry field named `retryKey` on the server? The app sends `enrollmentSecret`.

1. **Moving to a new phone:** a restored backup brings the data ID but not the owner token (a secret, never backed up),
   so the new phone's enroll gets `409`. The app explains this and changes nothing. A recovery step is needed, such as
   a one-time recovery code shown at enrollment, or re-linking from the old phone. Its shape is the backend's call;
   the app will add the UI once it's agreed.
2. Token rotation and revocation by the owner (the app already handles `401` by explaining and changing nothing).
3. Rate limits and the maximum body size (the app assumes 5 MB).

## curl (placeholders)

```bash
curl -sS -X PUT "https://<host>/api/body-anvil/v1/users/<userId>/snapshot" \
  -H "Authorization: Bearer <owner token>" -H "Content-Type: application/json" --data @snapshot.json
curl -sS "https://<host>/api/body-anvil/v1/users/<userId>/snapshot" -H "Authorization: Bearer <owner token>"
curl -sS "https://<host>/s/<share token>"
```

## Checking it on a phone

After the merge and the Google Play internal-testing deploy, once the backend is live:
1. Menu → Health data sync → set the address → Sync my data. Confirm the summary, then link and upload.
2. Sync again: it says Uploaded, and the last sync time updates.
3. Share my details → 7 days, Body only → Preview → Create → Copy AI link. Paste it into an AI chat and check that it reads the JSON.
4. Revoke the link and check that it no longer opens.
