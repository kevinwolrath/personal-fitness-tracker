# Rolling input corpus

Append new cases to corpus.jsonl. Keep each existing id and original input unchanged. Each record specifies the expected intent, outcome, extracted fields and proposed state changes. ACCEPT means a proposal can enter an existing review workflow. Saving still requires the workflow's confirmation.

The Jest harness runs every case and the original 60 Gemini replies on each run. It writes artifacts/input-corpus-report.json with original inputs, expected and actual results, state changes and PASS or FAIL status. GitHub CI uploads that report even when tests fail. Every discovered parser failure gets a new corpus record before its fix.

Corrections to demonstrably incorrect expectations belong in expectation-corrections.json, with an id and reasoning. Keep the original record. The CI check enforces the existing corpus as an unchanged prefix of the new file.

The original Gemini capture from PR #145 stays in config/text-replies/gemini-2026-11-11.json. Its invented START_CONFIG protocol and JSON without the app envelope are rejected. Provider clarification and rejection replies without an update are ignored as text. Their captured model expectations remain provenance, with the audit in config/text-replies/README.md.

The corpus uses the bundled seed plan. The imperial context has independent lb, kcal and in units and a fictional 220.46226218487757 lb profile weight. The chest contexts replace seed chest-press entries with one or two explicit test prescriptions. Food entries use the existing meal draft validator with unknown amounts and nutrients left empty. Expected fields are the facts asserted for an intent. The report also includes the complete actual proposal, including context-preserving fields.

The older web test for “Sure, I updated your nutrition!” expected an import error. The new task explicitly requests ignoring unrelated conversational text, so that original input is now intent-053 with IGNORE and no state changes. The importer compatibility tests retain their strict expectations.
