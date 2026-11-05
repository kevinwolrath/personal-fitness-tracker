/**
 * A string-aware tokenizer for JSON-like text (#47). Pure. It never rewrites anything: it only says where the
 * strings, punctuation, literals and comments are, so later steps can repair structure without ever touching the
 * inside of a string.
 */

export type TokenType = '{' | '}' | '[' | ']' | ':' | ',' | 'string' | 'literal' | 'comment' | 'bad';

export type Token = {
  type: TokenType;
  start: number;
  end: number;
  /** A string that reached the end of the text without its closing quote (cut off). */
  unterminated?: boolean;
};

const PUNCT = new Set(['{', '}', '[', ']', ':', ',']);
const LITERAL = /[A-Za-z0-9+\-.]/;

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
    } else if (PUNCT.has(c)) {
      out.push({ type: c as TokenType, start: i, end: i + 1 });
      i++;
    } else if (c === '"') {
      let j = i + 1;
      let closed = false;
      while (j < src.length) {
        if (src[j] === '\\') j += 2;
        else if (src[j] === '"') {
          closed = true;
          j++;
          break;
        } else j++;
      }
      out.push({ type: 'string', start: i, end: Math.min(j, src.length), unterminated: !closed });
      i = Math.min(j, src.length);
    } else if (c === '/' && src[i + 1] === '/') {
      const j = src.indexOf('\n', i);
      const end = j < 0 ? src.length : j;
      out.push({ type: 'comment', start: i, end });
      i = end;
    } else if (c === '/' && src[i + 1] === '*') {
      const j = src.indexOf('*/', i + 2);
      const end = j < 0 ? src.length : j + 2;
      out.push({ type: 'comment', start: i, end });
      i = end;
    } else if (LITERAL.test(c)) {
      let j = i;
      while (j < src.length && LITERAL.test(src[j])) j++;
      out.push({ type: 'literal', start: i, end: j });
      i = j;
    } else {
      out.push({ type: 'bad', start: i, end: i + 1 });
      i++;
    }
  }
  return out;
}

/** 1-based line and column of an offset, for messages people can find in what they pasted. */
export function lineCol(src: string, offset: number): { line: number; col: number } {
  const before = src.slice(0, offset);
  const line = before.split('\n').length;
  return { line, col: offset - before.lastIndexOf('\n') };
}

/** A short excerpt with a caret under `offset`, for diagnostics. */
export function excerpt(src: string, offset: number, width = 60): string {
  const lineStart = src.lastIndexOf('\n', offset - 1) + 1;
  const lineEndRaw = src.indexOf('\n', offset);
  const lineEnd = lineEndRaw < 0 ? src.length : lineEndRaw;
  const from = Math.max(lineStart, offset - Math.floor(width / 2));
  const to = Math.min(lineEnd, from + width);
  return `${src.slice(from, to)}\n${' '.repeat(Math.max(0, offset - from))}^`;
}
