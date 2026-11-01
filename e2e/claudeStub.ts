import type { Page, Route } from '@playwright/test';

/** Canned extractor output per screenshot file name (the app puts the file name in the prompt). */
export const STUB_OUTPUTS: Record<string, unknown> = {
  'fitbit-today.png': {
    sourceApp: 'Fitbit',
    screenDate: '2026-11-02',
    observations: [
      { metric: 'steps', label: 'Steps', value: 13765, unit: 'steps', kind: 'observed', evidence: '13,765', date: null, confidence: 0.98 },
      { metric: 'sleep_duration', label: 'Sleep', value: 465, unit: 'min', kind: 'observed', evidence: '7 hr 45 min', date: null, confidence: 0.95 },
      { metric: 'sleep_score', label: 'Sleep score', value: 84, unit: 'score', kind: 'observed', evidence: '84', date: null, confidence: 0.9 },
      { metric: 'readiness_score', label: 'Daily Readiness', value: 48, unit: '', kind: 'observed', evidence: '48', date: null, confidence: 0.7 },
    ],
  },
  // A screen that says which day it shows: values belong to that day, not the day of import.
  'fitbit-last-week.png': {
    sourceApp: 'Fitbit',
    screenDate: '2026-10-27',
    observations: [
      { metric: 'steps', label: 'Steps', value: 9120, unit: 'steps', kind: 'observed', evidence: '9,120', date: null, confidence: 0.97 },
      { metric: 'readiness_score', label: 'Daily Readiness', value: 71, unit: '', kind: 'observed', evidence: '71', date: null, confidence: 0.95 },
      { metric: 'exercise_session', label: 'Weights', value: 35, unit: 'min', kind: 'observed', evidence: 'Weights 35 min', date: null, confidence: 0.9 },
    ],
  },
  'scale.png': {
    sourceApp: 'Renpho',
    screenDate: null,
    observations: [
      { metric: 'weight', label: 'Weight', value: 97.25, unit: 'kg', kind: 'observed', evidence: '97.25 kg', date: null, confidence: 0.98 },
      { metric: 'weight_change', label: 'Total loss', value: -2.55, unit: 'kg', kind: 'observed', evidence: '-2.55 kg', date: null, confidence: 0.9 },
      { metric: 'weight', label: 'Starting weight', value: 99.8, unit: 'kg', kind: 'inferred', evidence: '97.25 + 2.55', date: null, confidence: 0.8 },
    ],
  },
};

/**
 * Stub the Claude Messages API at the network layer: the real SDK request/response/parse path runs
 * in the browser, only the model is replaced. Records each request body for assertions.
 */
export async function stubClaude(page: Page) {
  const requests: any[] = [];
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
  };
  await page.route('https://api.anthropic.com/**', async (route: Route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = route.request().postDataJSON();
    requests.push({ body, headers: await route.request().allHeaders() });
    const prompt: string = body.messages[0].content.find((b: any) => b.type === 'text').text;
    const file = Object.keys(STUB_OUTPUTS).find((f) => prompt.includes(f));
    const output = file ? STUB_OUTPUTS[file] : { sourceApp: null, screenDate: null, observations: [] };
    return route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify({
        id: `msg_${requests.length}`,
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: [{ type: 'text', text: JSON.stringify(output) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1000, output_tokens: 200 },
      }),
    });
  });
  return requests;
}

export async function presetApiKey(page: Page) {
  await page.addInitScript(() => localStorage.setItem('pft.anthropic.apiKey', 'sk-ant-test-key'));
}
