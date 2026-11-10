# Configuration link handoff: proof of concept (#120)

**Question:** can a chat assistant's reply carry a link that opens Body Anvil with a proposed configuration update, without any paid AI API?

**Answer so far:** the app side works and is safe. Whether one tap works from the ChatGPT Android app depends on how ChatGPT renders the link. Until that is confirmed on a device, **Copy, then Paste in Configure with AI** stays the return path. That fallback already exists and needs no automatic clipboard reading.

## What was built (test-only)

- **Link format:** `personalfitnesstracker://configure?v=1&update=<URL-encoded fitnessConfigUpdate JSON>`. The scheme is the one `app.json` already registers, so Android's `VIEW` intent filter exists in every build. No native change was needed.
- **Handler:** `src/config/handoff.ts` (pure) and the Configure screen. It only runs when `__DEV__` is set or the build was exported with `EXPO_PUBLIC_CONFIG_LINK_POC=1` (the Playwright web export sets it). In a production build the link just opens Configure with AI with nothing filled in.
- **Untrusted input:** the link's text goes through the same importer as a paste (contract 07): extract, repair, strict validation, preview, then **Apply N changes**. Nothing is applied, stored or logged when the link arrives. The parameter is cleared from the route once read.
- **Why URL-encoding, not base64:** assistants produce percent-encoding much more reliably than base64, and a person can read it. A link that was percent-encoded twice, which some apps and browsers do, still reads.
- **Generating links:** `node scripts/config-link.cjs fixtures/config/lunch.update.json` prints the link, its length and an `adb` command that opens it.

## Results (automated, in this repository)

| Case | Result | Test |
|---|---|---|
| Valid update | Preview shown, nothing saved until Apply | `e2e/config-link.spec.ts` |
| Same link opened again | Previewed again, "Nothing to apply" | `e2e/config-link.spec.ts` |
| Tampered (unknown field) | "This update can't be used", nothing changed | e2e and `src/config/__tests__/handoff.test.ts` |
| Cut-off link | Importer error with position, nothing changed | e2e and unit |
| Unknown link version (`v=9`) | Plain message, "use Paste instead" | e2e and unit |
| Empty, repeated `update=`, over 4,000 characters | Plain message, nothing changed | unit |
| Double percent-encoding | Read correctly | unit |
| Fallback: copy, then explicit **Paste** | Preview; clipboard is never read without the tap | e2e |

Screenshots (390 px): [preview](design/issue-120-config-link/link-preview.png) · [tampered](design/issue-120-config-link/link-tampered.png) · [unknown version](design/issue-120-config-link/link-unknown-version.png).

### Payload size

| Fixture | JSON (chars) | Link (chars) |
|---|---|---|
| `lunch` (one meal by merge) | 704 | 1,203 |
| `nutrition` | 636 | 1,122 |
| `real-world-exercise` | 1,780 | 2,862 |
| `combined` | 2,373 | 3,875 |
| `daily-prescription` | 3,819 | 6,333 |

URL-encoding costs about 1.6× the JSON. Android intents carry far more than this. The practical limit is the chat app: long links get wrapped, cut or not linkified. The app caps the decoded update at 4,000 characters. Larger updates go through Copy and Paste.

## Manual Android test steps (not yet run on a device)

These need a physical device or emulator. A cloud session can't run them.

1. Build a test APK with the handler: `EXPO_PUBLIC_CONFIG_LINK_POC=1` set when running `scripts/build-apk.ps1`, and install it.
2. **Intent check (app installed):** `node scripts/config-link.cjs fixtures/config/lunch.update.json`, then run the printed `adb shell am start …`. Expected: Body Anvil opens on Configure with AI with the "Opened from a link" note and a preview.
3. **Repeat:** run it again with the app open. Expected: previewed again; after an Apply, "Nothing to apply".
4. **App not installed:** uninstall and run the same command. Expected: `am start` reports no activity found. From a chat app, the tap does nothing or shows an error. Nothing falls back to the Play Store, because custom schemes have no web fallback.
5. **ChatGPT:** in the ChatGPT Android app, share the configuration (#119) and then ask for the update as a Markdown link `[Open in Body Anvil](personalfitnesstracker://configure?v=1&update=…)`. Note whether it renders as a tappable link, what happens on tap (direct, an interstitial, an in-app browser, or nothing), and whether long links get cut.
6. Repeat step 5 in Chrome (chatgpt.com) and with Claude and Gemini for comparison.

Record results in the table below.

| Surface | Renders as link? | Tap opens app? | Notes |
|---|---|---|---|
| adb intent | n/a | to test | |
| ChatGPT Android app | to test | to test | |
| ChatGPT in Chrome | to test | to test | |
| Claude / Gemini app | to test | to test | |

## Platform limits and expectations

- **Custom scheme links in chat apps:** chat apps commonly render only `http(s)` links as tappable and may show other schemes as plain text, or strip them. If ChatGPT does that, one-tap handoff with a custom scheme isn't possible, however well the app handles the link. This is the main thing step 5 has to answer.
- **Verified Android App Links** (`https://<domain>/configure?...`, `autoVerify`, `/.well-known/assetlinks.json`) would be linkified by every chat app, and open the app directly when verified. They need a domain Body Anvil controls with the signing certificate's fingerprint published, so they weren't feasible in this PoC. Without the app, the link would open a web page that could explain the Paste route. In-app browsers (Custom Tabs) may still keep the link inside the browser rather than handing it to the app.
- **Privacy:** a link puts the update in the URL, which may end up in browser history or chat logs. Updates hold only the fields being changed, not the full profile. The app never logs the link.
- **Length:** see above. Merge-by-id updates stay small. Whole-section rewrites may not.

## Recommendation

1. Keep **Copy, then Paste** as the supported return path. It works with every assistant and has no size limit.
2. Run the manual matrix above on a device. If ChatGPT linkifies custom schemes, enable the handler in production behind the same importer and preview, and add one optional line to the AI instructions asking for the link.
3. If it doesn't, one-tap handoff needs verified App Links on an owned domain. That's a separate decision (domain, hosting, signing key), so don't pursue it as part of this PoC.
