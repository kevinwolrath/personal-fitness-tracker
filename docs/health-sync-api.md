# Health data sync API (#134, #163)

Body Anvil syncs with the **Body Anvil Worker in Questspire Studio** (Cloudflare Worker + D1, `questspirestudios.com`).
**The Worker's contract is authoritative:** questspirestudio `docs/body-anvil/SYNC_API.md`, implemented in
`worker/index.mjs` and `worker/snapshot.mjs`. This page records how the app uses it.

The app was first built to a contract written here before the Worker existed, and the two were never reconciled.
Every upload got `400 Invalid enrollment envelope` (#163). Since #163:
- The app follows the Worker.
- The in-memory fake (`src/healthSync/__tests__/fakeServer.ts`) copies the Worker's checks key by key.
- Before a sync change ships, run the real Worker locally against the app (see "Checking against the real Worker").
- Run `npm run check:sync-server` against the deployed one.

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

- **Data ID** (`uuid`): a random UUID v4 made once and kept in the local database (`app_meta`), so a full backup
  carries it to a new phone. Sent in lowercase.
- **Owner token**: 64 lowercase hex, issued by the Worker at enrollment. Stored only in secure storage, with its data
  ID. Sent only as `Authorization: Bearer <token>`. Never in a URL, a log, a backup or a shared document.
- **Retry key**: 32 random bytes as 64 lowercase hex, saved in secure storage *before* the first enroll. An interrupted
  enroll is retried with the same key: the Worker returns the same owner token (`200`) without changing the stored
  snapshot, so the app then uploads the current one with `PUT`.

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

## Endpoints the app uses

All under `/api/body-anvil/v1`. JSON requests need `Content-Type: application/json`.

| Method and path | Auth | Body | Success |
|---|---|---|---|
| `POST /enroll` | `X-Enrollment-Key` (64 hex, build-time) | `{ uuid, retryKey, snapshot }` | `201` new, `200` retry: `{ ownerToken, updatedAt, revision, checksum }` |
| `PUT /users/{uuid}/snapshot` | owner | the snapshot | `200 { updatedAt, revision, checksum }` |
| `GET /users/{uuid}/snapshot` | owner | – | `200` the snapshot; `X-Body-Anvil-Updated-At`, `X-Body-Anvil-Revision`, `ETag` headers |
| `POST /users/{uuid}/shares/preview` | owner | `{ range: 7\|30\|90\|"all", categories, format: "records", expiresIn }` | `200 { revision, data }`: exactly what a link would show |
| `POST /users/{uuid}/shares` | owner | the same scope plus `revision` from the preview | `201 { id, url, expiresAt }`; `409` if a sync changed the snapshot since the preview |
| `DELETE /users/{uuid}/shares/{id}` | owner | – | `200 { revoked: true }` |
| `GET /shared/{token}` | none (the token is the capability) | – | `200` the shared projection; `404` when unknown, expired or revoked |

- **Share links:** the Worker has no list of links, so the phone keeps the ones it made in secure storage (each URL
  is a read credential). They aren't backed up, and expired ones drop off.
- **Before the phone is linked:** the share preview is worked out on the phone (the same projection as the Worker's),
  for "Share as text" only.
- **Not used yet:** credential rotation (`POST /users/{uuid}/credentials/rotate`) and the `summary` share format.

## Errors

The body is `{ "error": "..." }`. The app maps statuses to its messages, and never shows the server's text or the address:

| Status | Meaning |
|---|---|
| `400`, `415` | the data was rejected |
| `401` on enroll | enrollment key |
| `401`, `403` | owner token |
| `404` | not found |
| `409` | enroll: the ID is already linked; share: the snapshot changed |
| `413` | too large |
| `429` | rate limited (`Retry-After`) |
| `503` on enroll | enrollment off |
| `5xx` | server |

Limits: 1 MB and 15,000 records per snapshot; 64 KB per share.

## The snapshot

Built by `buildSnapshot` (`src/healthSync/payload.ts`):
`{ schemaVersion: 1, appVersion: "x.y.z", coverage: { from, to }, records: [{ date, category, metric, value, source }] }`.
`coverage.to` is today and `from` is the earliest record. No other key is accepted, so names, free text, photos,
location and credentials can't be sent.

| App data | Records |
|---|---|
| Observations: weight, waist, body fat | `measurements` weight (kg), waist (cm), bodyFat (%) |
| Observations: steps, active energy, active minutes, distance | `activity` steps, activeEnergy (**kcal**, converted from kJ), activeMinutes, distance (km) |
| Observations: time asleep | `sleep` duration (min) |
| Observations: energy and protein eaten (day totals) | `nutrition` energy (kcal), protein (g), with their own source |
| Logged meals and ticked plan meals (#154), on days without a day total | `nutrition` energy, protein, carbs, fat, meals (count), source `app` |
| Plan workouts ticked; exercise log | `training` sessions, duration (planned minutes), sets, reps, volume (kg), source `app` |
| Today's plan | `plan` energyTarget (kcal), proteinTarget (g), weightTarget (kg), source `plan` |

Sources: `manual`, `screenshot`, `healthConnect` (imported), `app` (derived totals) and `plan`. Inferred values are
left out. Metrics the Worker doesn't have are not sent: resting heart rate, sleep and readiness scores, floors,
custom measurements and muscle reports.

## Checking against the real Worker

Run questspirestudio's `worker/index.mjs` locally:
- Node's `node:sqlite` stands in for D1, after applying `migrations/0001_body_anvil.sql`.
- The rate limiters are stubs.
- Serve it over HTTP on `localhost:8787`.

Point the app's `healthSyncClient('http://localhost:8787', fetch, { dev: true })` at it and run:
1. a wrong-key enroll, then the first sync and a second sync;
2. the read-back;
3. share preview, create and read, then revoke.

This found #163, and it passed before #163 merged.

## Checking it on a phone

After the merge and the Google Play internal-testing deploy, once the backend is live:
1. Menu → Health data sync → Sync my data. Confirm the summary, then link and upload.
2. Sync again: it says Uploaded, and the last sync time updates.
3. Share my details → 7 days, Body measurements only → Preview → Create → Copy AI link. Paste it into an AI chat and check that it reads the JSON.
4. Revoke the link and check that it no longer opens.
