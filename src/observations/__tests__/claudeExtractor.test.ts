import Anthropic from '@anthropic-ai/sdk';
import { ClaudeScreenshotExtractor, EXTRACTION_MODEL, ExtractionError } from '../claudeExtractor';

const output = { sourceApp: 'Fitbit', screenDate: '2026-11-01', observations: [] };

function fakeClient(result: unknown | Error) {
  const parse = jest.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  return { client: { beta: { messages: { parse } } } as unknown as Anthropic, parse };
}

const input = { base64: 'AAAA', mediaType: 'image/png' as const, fileName: 'fitbit.png', capturedAt: '2026-11-01T16:39:00+11:00' };
const ctx = { today: '2026-11-01', timeZone: 'Australia/Melbourne' };

it('sends one image with context and returns the parsed structured output', async () => {
  const { client, parse } = fakeClient({ stop_reason: 'end_turn', parsed_output: output });
  const ex = new ClaudeScreenshotExtractor('key', client);
  await expect(ex.extract(input, ctx)).resolves.toEqual(output);

  const req = (parse.mock.calls[0] as unknown[])[0] as any;
  expect(req.model).toBe(EXTRACTION_MODEL);
  expect(req.fallbacks).toBe('default');
  expect(req.betas).toEqual(['server-side-fallback-2026-07-01']);
  expect(req.messages[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } });
  expect(req.messages[0].content[1].text).toContain('Local date today: 2026-11-01 (Australia/Melbourne).');
  expect(req.messages[0].content[1].text).toContain('fitbit.png');
  expect(req.system).toMatch(/mark it "inferred"/);
  expect(ex.id).toBe(`anthropic:${EXTRACTION_MODEL}`);
});

it.each([
  [{ stop_reason: 'refusal', parsed_output: null }, /couldn't be read/],
  [{ stop_reason: 'max_tokens', parsed_output: null }, /cut off/],
  [{ stop_reason: 'end_turn', parsed_output: null }, /unreadable/],
])('turns %j into a user-facing error', async (response, message) => {
  const { client } = fakeClient(response);
  await expect(new ClaudeScreenshotExtractor('key', client).extract(input, ctx)).rejects.toThrow(message);
});

it('maps an authentication failure to a clear message', async () => {
  const err = new Anthropic.AuthenticationError(401, { type: 'error' }, 'invalid x-api-key', new Headers());
  const { client } = fakeClient(err);
  const p = new ClaudeScreenshotExtractor('bad', client).extract(input, ctx);
  await expect(p).rejects.toBeInstanceOf(ExtractionError);
  await expect(p).rejects.toThrow(/API key was rejected/);
});
