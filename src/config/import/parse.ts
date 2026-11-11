import { lineCol } from './scan';

/**
 * Step 3 (#47): a strict JSON parser that, unlike JSON.parse, reports duplicate keys instead of silently keeping
 * the last one, and bounds nesting and size. Never evaluates anything. Keys are set with defineProperty, so a key
 * like "__proto__" is just data.
 */

export const MAX_DEPTH = 40;
export const MAX_VALUES = 20_000;

export type Parsed = { ok: true; value: unknown; notes: string[] } | { ok: false; error: string; offset: number };

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual((a as any)[k], (b as any)[k]));
}

export const setKey = (o: Record<string, unknown>, k: string, v: unknown) =>
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });

class Fail extends Error {
  constructor(
    message: string,
    public offset: number,
  ) {
    super(message);
  }
}

const bareText = /^[A-Za-z_][A-Za-z0-9_-]*/;
const numberText = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
export const isBareKey = (text: string) => bareText.exec(text)?.[0] === text;
export const isBareValue = (text: string) => isBareKey(text) || /^(?:\d+_[A-Za-z0-9_-]+|\d{2}:\d{2})$/.test(text);

export function parseJson(src: string): Parsed {
  return parseValue(src, false);
}

export function parseClause(src: string): Parsed {
  return parseValue(src, true);
}

function parseValue(src: string, clause: boolean): Parsed {
  let i = 0;
  let values = 0;
  const notes = new Set<string>();
  const where = (at: number) => {
    const { line, col } = lineCol(src, at);
    return `line ${line}, column ${col}`;
  };
  const ws = () => {
    while (i < src.length && ' \t\n\r'.includes(src[i])) i++;
  };
  const string = (): string => {
    const start = i;
    i++; // opening quote
    let out = '';
    while (i < src.length) {
      const c = src[i];
      if (c === '"') {
        i++;
        return out;
      }
      if (c === '\\') {
        const e = src[i + 1];
        const map: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (e in map) {
          out += map[e];
          i += 2;
        } else if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(src.slice(i + 2, i + 6))) {
          out += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16));
          i += 6;
        } else throw new Fail(`Invalid escape "\\${e ?? ''}" in text at ${where(i)}.`, i);
      } else if (clause && c.charCodeAt(0) < 32) {
        throw new Fail('Escape control characters inside quoted text.', i);
      } else if (c === '\n') {
        // A raw line break inside a string: models do this for long text. Keep it as a newline.
        notes.add('Kept line breaks inside text as they were written.');
        out += c;
        i++;
      } else {
        out += c;
        i++;
      }
    }
    throw new Fail(`The text starting at ${where(start)} is never closed.`, start);
  };
  const value = (depth: number): unknown => {
    if (depth > MAX_DEPTH) throw new Fail(`The update is nested too deeply (over ${MAX_DEPTH} levels).`, i);
    if (++values > MAX_VALUES) throw new Fail(`The update has too many values (over ${MAX_VALUES.toLocaleString('en-AU')}).`, i);
    ws();
    const c = src[i];
    if (c === '{') {
      i++;
      const obj: Record<string, unknown> = {};
      ws();
      if (src[i] === '}') {
        i++;
        return obj;
      }
      for (;;) {
        ws();
        const keyAt = i;
        let key: string;
        if (src[i] === '"') key = string();
        else {
          const bare = clause ? bareText.exec(src.slice(i))?.[0] : undefined;
          if (!bare) throw new Fail(`Expected ${clause ? 'a key' : 'a quoted key'} at ${where(i)}.`, i);
          key = bare;
          i += key.length;
        }
        if (clause && key === '__proto__') throw new Fail('Unexpected key "__proto__".', keyAt);
        ws();
        if (src[i] !== ':') throw new Fail(`Expected ":" after "${key}" at ${where(i)}.`, i);
        i++;
        const v = value(depth + 1);
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          if (clause) throw new Fail(`"${key}" appears twice. Include each key once.`, keyAt);
          if (!deepEqual(obj[key], v)) throw new Fail(`"${key}" appears twice in the same place with different values (${where(keyAt)}). Ask the AI to send it once.`, keyAt);
          notes.add(`"${key}" was sent twice with the same value; kept it once.`);
        } else setKey(obj, key, v);
        ws();
        if (src[i] === ',') {
          i++;
          continue;
        }
        if (src[i] === '}') {
          i++;
          return obj;
        }
        throw new Fail(`Expected "," or "}" at ${where(i)}.`, i);
      }
    }
    if (c === '[') {
      i++;
      const arr: unknown[] = [];
      ws();
      if (src[i] === ']') {
        i++;
        return arr;
      }
      for (;;) {
        arr.push(value(depth + 1));
        ws();
        if (src[i] === ',') {
          i++;
          continue;
        }
        if (src[i] === ']') {
          i++;
          return arr;
        }
        throw new Fail(`Expected "," or "]" at ${where(i)}.`, i);
      }
    }
    if (c === '"') return string();
    if (clause) {
      const token = /^[^\s,\[\]{}"]+/.exec(src.slice(i))?.[0];
      if (!token) throw new Fail('Expected a value.', i);
      const at = i;
      i += token.length;
      if (token.toLowerCase() === 'true') return true;
      if (token.toLowerCase() === 'false') return false;
      if (token === 'null') throw new Fail('Use CLEAR as the whole field value to remove an optional field.', at);
      if (numberText.test(token) && Number.isFinite(Number(token))) return Number(token);
      if (isBareValue(token)) return token;
      throw new Fail('Expected a number, true, false, or text in double quotes.', at);
    }
    const m = /^[A-Za-z0-9+\-.]+/.exec(src.slice(i));
    if (!m) throw new Fail(`Unexpected "${c ?? 'end of text'}" at ${where(i)}.`, i);
    const word = m[0];
    const at = i;
    i += word.length;
    const lower = word.toLowerCase();
    if (lower === 'true' || lower === 'false' || lower === 'null') {
      if (word !== lower) notes.add(`Read ${word} as ${lower}.`);
      return lower === 'null' ? null : lower === 'true';
    }
    if (numberText.test(word)) return Number(word);
    throw new Fail(`"${word}" at ${where(at)} isn't a number, true, false or null. Text needs double quotes.`, at);
  };
  try {
    const v = value(0);
    ws();
    if (i < src.length) throw new Fail(`Unexpected text after the update at ${where(i)}.`, i);
    return { ok: true, value: v, notes: [...notes] };
  } catch (e) {
    if (e instanceof Fail) return { ok: false, error: e.message, offset: e.offset };
    throw e;
  }
}
