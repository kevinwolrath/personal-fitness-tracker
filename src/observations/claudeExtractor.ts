import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { metrics } from './metrics';
import { extractionSchema, type Extraction } from './extraction';

export const EXTRACTION_MODEL = 'claude-opus-5-5';

export type ScreenshotInput = {
  base64: string;
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  fileName: string | null;
  capturedAt: string | null;
};

/** Anything that turns one screenshot into provider-neutral extraction output. */
export interface ScreenshotExtractor {
  readonly id: string;
  extract(input: ScreenshotInput, ctx: { today: string; timeZone: string }): Promise<Extraction>;
}

export class ExtractionError extends Error {}

const SYSTEM = `You read screenshots from fitness, health and smart-scale apps and return the numbers they show as structured data.

Rules:
- Only report values that are actually printed on the screen as "observed". Never round, convert or estimate an observed value: copy the number and unit as displayed.
- If you work something out from other numbers (for example a starting weight from a current weight and a total loss), you may report it, but mark it "inferred" and put the calculation in "evidence". Never mark a calculated value "observed".
- A change or difference that the app itself displays (for example "-2.55 kg" or "2.55 kg lost") is observed: report it as metric "weight_change", negative for a loss.
- Durations: give total minutes (7h 45m → 465, unit "min").
- Food or activity "Calories"/"cal" are kilocalories: unit "kcal".
- Each workout or exercise session is one "exercise_session" item: value is its duration, label is the exercise type as shown.
- Ignore goals, targets, averages over several days, and charts you cannot read exactly; report only the values for the day the screen shows. If a number is a goal rather than a measurement, leave it out.
- Resolve relative dates ("Today", "Yesterday", "Sat") against the local date given by the user. If the screen does not show which day it is, use null.
- If the image is not a fitness or health screen, return no observations.

Metric ids:
${metrics.map((m) => `- ${m.id}: ${m.hint}`).join('\n')}
- other: anything else that is clearly a health or fitness measurement (use the on-screen label)`;

/** Reads screenshots with Claude (vision + structured output). The user supplies their own API key. */
export class ClaudeScreenshotExtractor implements ScreenshotExtractor {
  readonly id = `anthropic:${EXTRACTION_MODEL}`;
  private client: Anthropic;

  constructor(apiKey: string, client?: Anthropic) {
    // The key is the user's own, stored on their device; requests go straight from the app to the API.
    this.client = client ?? new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  }

  async extract(input: ScreenshotInput, ctx: { today: string; timeZone: string }): Promise<Extraction> {
    const context = [
      `Local date today: ${ctx.today} (${ctx.timeZone}).`,
      input.fileName ? `File name: ${input.fileName}.` : null,
      input.capturedAt ? `Screenshot taken: ${input.capturedAt}.` : null,
      'Extract the fitness and health values from this screenshot.',
    ]
      .filter(Boolean)
      .join('\n');

    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: EXTRACTION_MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium', format: betaZodOutputFormat(extractionSchema) },
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: input.mediaType, data: input.base64 } },
              { type: 'text', text: context },
            ],
          },
        ],
      });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new ExtractionError('The API key was rejected. Check it and try again.');
      if (e instanceof Anthropic.RateLimitError) throw new ExtractionError('Too many requests right now. Try again in a minute.');
      if (e instanceof Anthropic.BadRequestError) throw new ExtractionError(`The screenshot couldn't be sent: ${e.message}`);
      if (e instanceof Anthropic.APIConnectionError) throw new ExtractionError('No connection to the extraction service.');
      if (e instanceof Anthropic.APIError) throw new ExtractionError(`Extraction failed (${e.status ?? 'error'}).`);
      throw e;
    }

    if (response.stop_reason === 'refusal') throw new ExtractionError("This screenshot couldn't be read.");
    if (response.stop_reason === 'max_tokens') throw new ExtractionError('The result was cut off. Try a smaller screenshot.');
    if (!response.parsed_output) throw new ExtractionError('The extraction result was unreadable.');
    return response.parsed_output;
  }
}
