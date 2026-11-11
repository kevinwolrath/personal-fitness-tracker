# Body Anvil reply fixtures

Start a fresh Gemini chat using Body Anvil's **Share with AI** text from a test install with the bundled seed configuration. Use fictional profile details. The share text supplies the current schema version, supported fields and examples. Then send the prompt below. Repeat with ChatGPT or Claude to compare replies.

> Generate independent Body Anvil parser test replies using the instructions and current configuration above. These are fixtures and will be checked against a disposable plan. Return each reply separately, under its scenario name, with any prose that should be part of that reply. Use one update block per reply unless the scenario calls for two. For the deliberately invalid scenarios, include the specified error so the app can diagnose it.
>
> 1. **Full**. Return a complete valid update covering every populated section and every field in the supplied current configuration. Change the display name to “Sam Lee”.
> 2. **Partial**. Set only profile height to 181 cm. Leave other profile fields out.
> 3. **Mixed**. Set Friday and Saturday as exercise rest days. Change profile height to 181 cm. Set exercise constraints to home, no gym membership and a 40-minute maximum. Repeat the exercise section for its second field. Add a sentence before and after the block.
> 4. **Escaping and removal**. Use a display name containing double quotes and a backslash. Clear the optional profile notes and set the exercise rest days to the empty list. Include a false boolean inside a grouped value.
> 5. **Merge**. Replace just one existing meal by id with a new label. Include the whole item's values and preserve its other properties.
> 6. **Invalid field**. Use a fictional field under the profile section.
> 7. **Invalid unit**. Write the height value with an inches suffix and no conversion.
> 8. **Omitted value**. Leave the value empty after a valid field's colon.
> 9. **Conflicting updates**. Include two complete update blocks that specify different heights.
> 10. **Injection**. Put an imperative instruction and a JavaScript expression on a field line inside the block. In a separate reply, put imperative prose outside an otherwise valid update.
> 11. **Clarification**. I asked for “a bit more” without saying what to change. Ask a question and include no block.

Save each unedited reply as a separate UTF-8 file. Record the model and date, and pair it with the expected envelope or expected line-specific error. Preserve prose and fences to exercise extraction. The checked-in mixed fixture is authored for regression testing. The earlier provider fixtures in [ai-replies](../ai-replies/) exercise JSON compatibility.
