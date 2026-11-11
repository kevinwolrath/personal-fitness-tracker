import { lineCol, tokenize, type Token } from './scan';

/**
 * Steps 1 and 2 of the import (#47): find the update in what was pasted, then repair only defects whose fix is
 * unambiguous. Pure and deterministic. Every change is reported as a note; anything that would need a guess is
 * reported as an error instead. Text inside strings is never changed.
 */

export const MAX_INPUT_CHARS = 200_000;
const KEY = /["\u201C\u201D]fitnessConfigUpdate["\u201C\u201D]/i;

export type Problem = { message: string; offset?: number };
export type Recovered =
  | { ok: true; text: string; notes: string[]; curlyQuotes?: boolean }
  | { ok: false; errors: Problem[]; notes: string[]; text?: string; recoverableText?: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Code fences (``` or ~~~), including one left open at the end when a reply was cut off. */
function fencedBlocks(text: string): { body: string; start: number; end: number }[] {
  const out: { body: string; start: number; end: number }[] = [];
  const re = /(^|\n)[ \t]*(```|~~~)[^\n]*\n([\s\S]*?)(?:\n[ \t]*\2[ \t]*(?=\n|$)|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push({ body: m[3], start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

const CURLY = new Set(['\u201C', '\u201D', '\u201E', '\u201F']); // “ ” „ ‟ (never the apostrophes ‘ ’)
const VALUE_START = /["\u201C\u201D\u201E\u201F{\[\-0-9tfnTFN}\]]/;

/**
 * Curly double quotes used as JSON delimiters (some chat apps "smarten" quotes), #47. Walks the update with the
 * roles of quotes in mind:
 * - outside a string, a curly quote opens a string (→ ");
 * - inside a string opened by a curly quote, a curly quote closes it only where a JSON delimiter follows (: , } ]
 *   or the end, and after a comma the next thing must be a key or a value); anywhere else it is text and kept;
 * - inside a string opened by a straight quote, curly quotes are text and kept; a straight quote inside a curly
 *   string is text and escaped.
 * Apostrophes and single curly quotes are never touched. Stops when the update's outermost bracket closes, so
 * prose after it is left alone. Mixed straight and curly quotes are fine. If the result still doesn't parse, the
 * import says the quotes were ambiguous instead of guessing further.
 */
export function normalizeQuotes(src: string, depth0: number): { text: string; converted: number } {
  let out = '';
  let converted = 0;
  let depth = depth0;
  let started = depth0 > 0;
  let mode: 'out' | 'straight' | 'curly' = 'out';
  const closesHere = (i: number) => {
    let j = i + 1;
    while (j < src.length && /\s/.test(src[j])) j++;
    if (j >= src.length) return true;
    const c = src[j];
    if (c === ':' || c === '}' || c === ']') return true;
    if (c !== ',') return false;
    j++;
    while (j < src.length && /\s/.test(src[j])) j++;
    return j >= src.length || VALUE_START.test(src[j]);
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (mode === 'out') {
      if (started && depth === 0) return { text: out + src.slice(i), converted };
      if (c === '{' || c === '[') {
        depth++;
        started = true;
      } else if (c === '}' || c === ']') depth--;
      if (c === '"') mode = 'straight';
      else if (CURLY.has(c)) {
        mode = 'curly';
        converted++;
        out += '"';
        continue;
      }
      out += c;
    } else if (mode === 'straight') {
      if (c === '\\') {
        out += c + (src[i + 1] ?? '');
        i++;
        continue;
      }
      if (c === '"') mode = 'out';
      out += c;
    } else {
      if (c === '\\') {
        out += c + (src[i + 1] ?? '');
        i++;
        continue;
      }
      if (c === '"') {
        out += '\\"'; // a straight quote inside a curly-quoted string is text
        continue;
      }
      if (CURLY.has(c) && closesHere(i)) {
        mode = 'out';
        converted++;
        out += '"';
        continue;
      }
      out += c;
    }
  }
  return { text: out, converted };
}

/** Step 1: the one candidate update in the pasted text. */
export function extract(raw: string): Recovered {
  const notes: string[] = [];
  let text = raw.replace(/^﻿/, '');
  if (!text.trim()) return { ok: false, errors: [{ message: 'Paste the update the AI gave you.' }], notes };
  if (text.length > MAX_INPUT_CHARS) {
    return { ok: false, errors: [{ message: `This is too long to be one update (${text.length.toLocaleString('en-AU')} characters; the limit is ${MAX_INPUT_CHARS.toLocaleString('en-AU')}). Paste only the update.` }], notes };
  }

  const blocks = fencedBlocks(text);
  if (blocks.length) {
    const withKey = blocks.filter((b) => KEY.test(b.body));
    if (withKey.length > 1) return { ok: false, errors: [{ message: 'Found more than one code block with an update. Paste only the one update block.' }], notes };
    const chosen = withKey[0] ?? (blocks.length === 1 ? blocks[0] : null);
    if (!chosen) return { ok: false, errors: [{ message: 'Found more than one code block. Paste only the one update block.' }], notes };
    if ((text.slice(0, chosen.start) + text.slice(chosen.end)).trim()) notes.push('Took the update from its code block and ignored the text around it.');
    else notes.push('Removed the code-block markers around the update.');
    text = chosen.body;
  }

  // Find where the object starts: the first "{" before the envelope key, or the key itself when its "{" is missing.
  const keyAt = text.search(KEY);
  const braceAt = text.indexOf('{');
  if (keyAt < 0 && braceAt < 0) {
    return { ok: false, errors: [{ message: 'No update found. Ask the AI to send a complete configuration update.' }], notes };
  }
  let start: number;
  let missingOpen = false;
  if (keyAt >= 0 && (braceAt < 0 || braceAt > keyAt)) {
    start = keyAt;
    missingOpen = true;
  } else start = braceAt;
  if (text.slice(0, start).trim() && !blocks.length) notes.push('Ignored the text before the update.');
  const quotes = normalizeQuotes(text.slice(start), missingOpen ? 1 : 0);
  if (quotes.converted) {
    text = text.slice(0, start) + quotes.text;
    notes.push(`Converted ${plural(quotes.converted, 'curly quote')} (“ ”) to straight quotes; quotes inside text were kept.`);
  }

  // Find where it ends: the matching close of the first "{", string-aware. A cut-off update runs to the end.
  const tokens = tokenize(text.slice(start));
  let depth = missingOpen ? 1 : 0;
  let end = text.length;
  for (const t of tokens) {
    if (t.type === '{' || t.type === '[') depth++;
    else if (t.type === '}' || t.type === ']') {
      depth--;
      if (depth === 0) {
        end = start + t.end;
        break;
      }
    }
  }
  let rest = text.slice(end);
  // Extra closers right after the object belong to it (repair drops them); anything else after it is prose.
  const closers = /^[\s}\]]*/.exec(rest)![0];
  const tail = rest.slice(closers.length);
  if (KEY.test(tail)) return { ok: false, errors: [{ message: 'Found more than one update. Paste only one.' }], notes };
  if (tail.trim() && !blocks.length) notes.push('Ignored the text after the update.');
  rest = closers;

  if (missingOpen) notes.push('Added the missing opening { at the start.');
  return { ok: true, text: (missingOpen ? '{' : '') + text.slice(start, end) + rest, notes, curlyQuotes: quotes.converted > 0 };
}

type Frame = { open: '{' | '['; state: 'key' | 'colon' | 'value' | 'after' };

/**
 * Step 2: repair what is safe to repair: comments, trailing commas, extra closers at the very end, and missing
 * closers at the end when the text ends right after a complete value. Everything else is an error with a position.
 */
export function repair(src: string): Recovered {
  const notes: string[] = [];
  const errors: Problem[] = [];
  const tokens = tokenize(src);
  const out: string[] = [];
  const stack: Frame[] = [];
  let comments = 0;
  let trailingCommas = 0;
  let extraClosers = 0;
  /** Output length and stack depth after each complete member of the update body: where a cut-off text can be ended. */
  let lastBodyCut: { outLen: number } | null = null;
  const sig = tokens.filter((t) => t.type !== 'comment');
  comments = tokens.length - sig.length;

  const top = () => stack[stack.length - 1];
  const at = (t: Token) => {
    const { line, col } = lineCol(src, t.start);
    return `line ${line}, column ${col}`;
  };
  const valueDone = () => {
    const f = top();
    if (f) f.state = 'after';
    // A complete member of the update body (depth 2: { "fitnessConfigUpdate": { … } }) is a safe cut point.
    if (stack.length === 2) lastBodyCut = { outLen: out.length };
  };

  for (let i = 0; i < sig.length; i++) {
    const t = sig[i];
    const s = src.slice(t.start, t.end);
    const f = top();
    if (t.type === 'bad') {
      const hint = s === "'" ? ' Use double quotes " for keys and text.' : '';
      errors.push({ message: `Unexpected "${s}" at ${at(t)}.${hint}`, offset: t.start });
      break;
    }
    if (t.type === 'string' && t.unterminated) {
      errors.push({ message: `The update is cut off: a quote opened at ${at(t)} is never closed. Ask the AI to resend the whole update.`, offset: t.start });
      break;
    }
    if (t.type === ',') {
      const next = sig[i + 1];
      if (next && (next.type === '}' || next.type === ']')) {
        trailingCommas++;
        continue;
      }
      if (!f || f.state !== 'after') {
        errors.push({ message: `Unexpected "," at ${at(t)}.`, offset: t.start });
        break;
      }
      f.state = f.open === '{' ? 'key' : 'value';
      out.push(',');
      continue;
    }
    if (t.type === '}' || t.type === ']') {
      if (!f) {
        // Closers after the whole object has closed: drop them only if nothing else follows.
        if (sig.slice(i).every((x) => x.type === '}' || x.type === ']')) {
          extraClosers += sig.length - i;
          break;
        }
        errors.push({ message: `Unexpected "${s}" at ${at(t)}: the update had already ended.`, offset: t.start });
        break;
      }
      const matches = (t.type === '}' && f.open === '{') || (t.type === ']' && f.open === '[');
      if (!matches) {
        errors.push({ message: `"${s}" at ${at(t)} closes a "${f.open}". Ask the AI to resend the update.`, offset: t.start });
        break;
      }
      if (f.state !== 'after' && !(f.state === 'key' && out[out.length - 1] === '{') && !(f.state === 'value' && out[out.length - 1] === '[')) {
        errors.push({ message: `Something is missing before "${s}" at ${at(t)}.`, offset: t.start });
        break;
      }
      stack.pop();
      out.push(s);
      valueDone();
      continue;
    }
    if (t.type === ':') {
      if (!f || f.state !== 'colon') {
        errors.push({ message: `Unexpected ":" at ${at(t)}.`, offset: t.start });
        break;
      }
      f.state = 'value';
      out.push(':');
      continue;
    }
    // A value or a key.
    if (f && f.open === '{' && f.state === 'key') {
      if (t.type !== 'string') {
        errors.push({ message: `Expected a quoted key at ${at(t)}, found ${s}. Keys need double quotes.`, offset: t.start });
        break;
      }
      f.state = 'colon';
      out.push(s);
      continue;
    }
    if (f && f.state !== 'value') {
      errors.push({ message: `Missing "," before ${s.length > 20 ? s.slice(0, 20) + '…' : s} at ${at(t)}.`, offset: t.start });
      break;
    }
    if (!f && out.length) {
      errors.push({ message: `Unexpected ${s} at ${at(t)}: the update had already ended.`, offset: t.start });
      break;
    }
    if (t.type === '{' || t.type === '[') {
      stack.push({ open: t.type, state: t.type === '{' ? 'key' : 'value' });
      out.push(t.type);
      continue;
    }
    out.push(s);
    valueDone();
  }

  if (comments) notes.push(`Removed ${plural(comments, 'comment')}.`);
  if (trailingCommas) notes.push(`Removed ${plural(trailingCommas, 'trailing comma')}.`);
  if (extraClosers) notes.push(`Removed ${plural(extraClosers, 'extra closing bracket')} at the end.`);

  // The end of the text with things still open.
  if (!errors.length && stack.length) {
    const f = top()!;
    if (f.state === 'after' || (f.state === 'key' && out[out.length - 1] === '{') || (f.state === 'value' && out[out.length - 1] === '[')) {
      const closing = [...stack].reverse().map((x) => (x.open === '{' ? '}' : ']'));
      notes.push(`Added ${plural(closing.length, 'missing closing bracket')} at the end (${closing.join('')}).`);
      out.push(...closing);
      stack.length = 0;
    } else {
      errors.push({ message: 'The update is cut off: it ends in the middle of an entry. Ask the AI to resend the whole update.', offset: src.length });
    }
  }
  if (!errors.length) return { ok: true, text: out.join(''), notes };

  // Cut off or broken: what was complete before the problem can be shown (never applied).
  const cut = lastBodyCut as { outLen: number } | null;
  const recoverableText = cut ? out.slice(0, cut.outLen).join('') + '}}' : undefined;
  return { ok: false, errors, notes, text: src, recoverableText };
}
