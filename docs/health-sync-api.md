# Health data sync API (#134): app-side contract

Body Anvil's health-data client talks to a **Cloudflare Worker + D1 backend hosted in Questspire Studio** (Questspire
Studio #4, owned by Codex). This document is the contract the app implements. The backend should match it, or the
two should be reconciled on #134 before release. Until the backend exists, the app is tested against an in-memory fake
of this contract (`src/healthSync/__tests__/fakeServer.ts`).

No Cloudflare account, domain or credential is in this repository. Nothing here was deployed.

## Base URL

`https://<questspire host>`. The app reads `EXPO_PUBLIC_HEALTH_SYNC_URL` at build time, and the user can set or change
the address in **Health data sync → Server address**. Only `https://` is accepted (plain `http://` only for
localhost while developing). No user, password, query or fragment is allowed in the address.

All paths below are under `/api/body-anvil/v1`. Requests and responses are `application/json`.

## Identity

- **Data ID** (`userId`): a random UUID v4 made by the app once and kept in its local database (`app_meta`), so a
  full backup carries it to a new phone.
- **Owner token**: issued by the server at enrollment; random, at least 128 bits. Sent only as
  `Authorization: Bearer <token>`. It is never put in a URL, logged or included in a shared document.
- **Enrollment secret**: random (256 bits, base64url), made and saved by the app *before* it first enrolls.

## Enrollment key (#136)

The backend accepts a first link only from a client that knows a **shared enrollment key**. The user types it once in
**Health data sync → Enrollment key**. The app keeps it only in secure storage (`pft.healthSync.enrollmentKey`).
It is never stored in SQLite or put in a backup, export, snapshot, share link, log or the APK.

- It is sent **only** as the `X-Enrollment-Key` header on `POST /enroll`, over HTTPS. It is never sent with
  snapshot GET/PUT, the shares endpoints or any other request.
- With no key saved, the first sync stops before any network call and asks for it.
- A `401`/`403` from `/enroll` means the key was rejected. The app says so and offers to edit it and retry. The data ID
  and the saved enrollment secret are kept, so the retry is the same idempotent enroll.
- After linking, the owner token is enough. The key can be removed from the phone; it is needed again only to link
  another phone or data ID.

## Endpoints

| Method and path | Auth | Body | Success |
|---|---|---|---|
| `POST /enroll` | `X-Enrollment-Key` | `{ userId, enrollmentSecret, snapshot }` | `201` (new) or `200` (same `userId` **and** same secret again: idempotent retry) `{ userId, ownerToken, snapshot: Receipt }` |
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
