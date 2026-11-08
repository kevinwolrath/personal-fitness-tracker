import { limits } from './contract';

/**
 * Step 1 of reading a pasted AI reply (#97): find exactly one JSON object in the text. Pure.
 *
 * Accepts a ```json fenced block, a plain fence or a bare object, with any prose around it. The text is only
 * `JSON.parse`d: nothing pasted is ever evaluated or run. Validation of the object is a separate step.
 */

export type ExtractErrorCode = 'empty' | 'too-long' | 'no-json' | 'truncated' | 'invalid-json' | 'multiple' | 'not-object';

export type ExtractResult =
  | { ok: true; value: Record<string, unknown>; /** Repairs made before it parsed, e.g. curly quotes. */ repaired: string[] }
  | { ok: false; code: ExtractErrorCode; message: string };

const messages: Record<ExtractErrorCode, string> = {
  empty: 'Paste the AI’s reply first.',
  'too-long': 'This is much longer than one meal reply. Paste only the AI’s answer.',
  'no-json': 'No JSON found in the reply. Ask the AI to “reply with the JSON block from the prompt”, then paste its answer.',
  truncated: 'The reply is cut off: the JSON stops part-way through. Ask the AI to “send the whole JSON again”, then paste the new reply.',
  'invalid-json': 'The JSON in the reply has a mistake and can’t be read. Ask the AI to “send valid JSON only”, then paste the new reply.',
  multiple: 'The reply has more than one JSON object. Paste one meal’s reply at a time, or ask the AI for one combined object.',
  'not-object': 'The JSON in the reply isn’t a meal object. Ask the AI to use the format from the prompt.',
};

const fail = (code: ExtractErrorCode): ExtractResult => ({ ok: false, code, message: messages[code] });

type Candidate = { text: string; closed: boolean };

/** Contents of ``` fences. An opened fence that never closes is a truncated candidate. */
function fenced(text: string): Candidate[] {
  const out: Candidate[] = [];
  const re = /```[ \t]*([A-Za-z0-9_-]*)[^\n]*\n?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + m[0].length;
    const end = text.indexOf('```', start);
    if (end === -1) {
      out.push({ text: text.slice(start), closed: false });
      break;
    }
    out.push({ text: text.slice(start, end), closed: true });
    re.lastIndex = end + 3;
  }
  return out.filter((c) => c.text.trim().startsWith('{') || c.text.trim().startsWith('['));
}

/** Top-level balanced {…} spans, string-aware. An object still open at the end of the text is truncated. */
function objects(text: string): Candidate[] {
  const out: Candidate[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"' || ch === '“' || ch === '”') inString = false;
      continue;
    }
    if (ch === '"' || ch === '“' || ch === '”') {
      if (depth > 0) inString = true;
    } else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}' && depth > 0) {
      depth--;
      if (depth === 0) out.push({ text: text.slice(start, i + 1), closed: true });
    }
  }
  if (depth > 0 && start >= 0) out.push({ text: text.slice(start), closed: false });
  return out;
}

/** Common chat-app damage: curly quotes and trailing commas. Only applied when the text doesn't parse as is. */
function repair(text: string): { text: string; repaired: string[] } {
  const repaired: string[] = [];
  let t = text;
  if (/[“”]/.test(t)) {
    t = t.replace(/[“”]/g, '"');
    repaired.push('curly quotes');
  }
  const noTrailing = t.replace(/,(\s*[}\]])/g, '$1');
  if (noTrailing !== t) {
    t = noTrailing;
    repaired.push('trailing commas');
  }
  return { text: t, repaired };
}

function tryParse(text: string): { value: unknown; repaired: string[] } | null {
  try {
    return { value: JSON.parse(text), repaired: [] };
  } catch {
    const r = repair(text);
    if (!r.repaired.length) return null;
    try {
      return { value: JSON.parse(r.text), repaired: r.repaired };
    } catch {
      return null;
    }
  }
}

/** Looks like an unfinished JSON value (unbalanced braces/brackets or an open string). */
function looksTruncated(text: string): boolean {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
  }
  return inString || depth > 0;
}

const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

export function extractReply(raw: string): ExtractResult {
  const text = (raw ?? '').replace(/^﻿/, '');
  if (!text.trim()) return fail('empty');
  if (text.length > limits.pasteChars) return fail('too-long');

  const fences = fenced(text);
  const candidates = fences.length ? fences : objects(text);
  if (!candidates.length) return fail(text.includes('{') ? 'truncated' : 'no-json');

  const parsed: { value: unknown; repaired: string[] }[] = [];
  let truncated = false;
  let invalid = false;
  for (const c of candidates) {
    const p = tryParse(c.text.trim());
    if (p) parsed.push(p);
    else if (!c.closed || looksTruncated(c.text)) truncated = true;
    else invalid = true;
  }
  if (!parsed.length) return fail(truncated ? 'truncated' : invalid ? 'invalid-json' : 'no-json');

  // The same object repeated (an AI that echoes its answer) counts once.
  const distinct = [...new Map(parsed.map((p) => [stable(p.value), p])).values()];
  if (distinct.length > 1) return fail('multiple');
  const only = distinct[0];
  if (Array.isArray(only.value)) {
    if (only.value.length === 1 && only.value[0] && typeof only.value[0] === 'object' && !Array.isArray(only.value[0])) {
      return { ok: true, value: only.value[0] as Record<string, unknown>, repaired: only.repaired };
    }
    return fail(only.value.length > 1 ? 'multiple' : 'not-object');
  }
  if (!only.value || typeof only.value !== 'object') return fail('not-object');
  return { ok: true, value: only.value as Record<string, unknown>, repaired: only.repaired };
}
