# Real AI replies (#47)

Verbatim replies from AI chat assistants to the app's real **Configure with AI** prompt (seed plan). Every
`<name>.txt` here is imported by `src/config/__tests__/import.test.ts` and checked against `<name>.expect.json`:

```json
{ "imports": true, "sections": ["nutrition", "exercise"] }
```

```json
{ "imports": false, "error": "text the error must contain" }
```

## Captured so far

| File | Assistant | How captured |
|---|---|---|
| `claude-2026-11-05-*.txt` | Claude (model) | A Claude agent given the generated prompt as the first chat message, then the user turns quoted in each `.expect.json` note; replies saved unedited. Not via the claude.ai app. |

## Adding Gemini, ChatGPT and claude.ai replies (manual matrix)

1. In the app: ☰ → **Configure with AI** → copy the AI instructions.
2. Paste them into the assistant (Gemini, ChatGPT, claude.ai…) as the first message.
3. Ask for real changes, for example: *"Lower my daily energy target to a maximum of 7,300 kJ, and hammer curls should be caution because of wrist pain. I'm done, send the update."* Answer any question it asks.
4. Use the assistant's **copy** button on its final reply (the whole reply, not just the JSON) and paste it into a new file here, `<assistant>-<yyyy-mm-dd>-<what>.txt`, unedited.
5. Add `<same name>.expect.json` with what should happen.
6. Also paste the same reply into the app: it should preview (or explain the problem) the way the test expects.

Also worth one round each: a reply copied from the app's rendered view on a phone (curly quotes), and a reply where you stop the assistant mid-answer (cut off: the app should list what was complete and copy details for the AI).
