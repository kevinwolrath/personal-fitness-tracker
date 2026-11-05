# AI reply samples (#47)

The same update as three chat assistants typically return it, for the import tests in
`src/config/__tests__/import.test.ts`. They are **representative of each assistant's usual output style**
(prose around the update, code fences, an upper-case fence label, trailing commas, a comment), written by hand,
not live captures. The manual test matrix in contract 07 covers trying the real assistants.

- `claude.txt`: prose, a ```json block, prose after.
- `gemini.txt`: a heading, a ```JSON block with trailing commas, a bulleted explanation.
- `chatgpt.txt`: a lead-in sentence, the bare object with a `//` comment, a closing sentence.
