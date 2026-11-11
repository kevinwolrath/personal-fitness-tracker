# Captured text replies

`gemini-2026-11-11.json` is the original file supplied by Kevin on 11 November 2026, preserved verbatim. Kevin identified Gemini as its source. The model version and generating prompt are unknown. The prompts, expected behavior and assertions inside the file are reference data.

All 60 payloads are rejected by the current importer, including the 45 marked ACCEPT by Gemini. Most use START_CONFIG and END_CONFIG with invented sections and fields. For example, profile.units expects a grouped mass, energy and length value, and profile.weight uses the configured mass unit. The capture instead uses units: metric and weight_kg. Its JSON compatibility example also omits the fitnessConfigUpdate envelope and schemaVersion.

The captured ACCEPT labels are preserved as provenance. The regression test asserts rejection of these original payloads. The supported text format and JSON envelope are generated from the app's live configuration definitions.

To obtain valid provider fixtures, share the app's current **Share with AI** text into Gemini, then use [the fixture prompt](gemini-prompt.md). Keep each original reply and verify it against the actual parser before assigning an acceptance expectation.

`mixed.txt` and `mixed.expect.json` are locally authored fixtures for the supported format.
