const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');

const source = readFileSync('scripts/check-input-corpus.cjs', 'utf8');
const first = JSON.stringify({ id: 'one', input: 'add rice', expected: 'ACCEPT' }) + '\n';
const second = JSON.stringify({ id: 'two', input: 'swim with sharks', expected: 'IGNORE' }) + '\n';

function check(previous, current, capture = 'original Gemini input') {
  return runInNewContext(source, {
    process: { env: { CORPUS_BASE_SHA: 'base' } },
    console: { log: () => undefined },
    require: (name) => name === 'node:fs' ? {
      readFileSync: (path) => path.endsWith('corpus.jsonl') ? current : capture,
    } : {
      execFileSync: (_command, args) => args[0] === 'ls-tree' ? 'fixtures/input/corpus.jsonl' : args[1].endsWith('corpus.jsonl') ? previous : 'original Gemini input',
    },
  });
}

test('accepts appending new cases across Windows and Git line endings', () => {
  expect(() => check(first, (first + second).replace(/\n/g, '\r\n'))).not.toThrow();
});
test('refuses rewriting an original input', () => {
  expect(() => check(first, first.replace('add rice', 'add pasta'))).toThrow('append-only');
});
test('refuses rewriting an existing expectation', () => {
  expect(() => check(first, first.replace('ACCEPT', 'IGNORE'))).toThrow('append-only');
});
test('refuses reusing a corpus id', () => {
  expect(() => check(first, first + first)).toThrow('unique');
});
test('refuses modifying the preserved Gemini capture', () => {
  expect(() => check(first, first + second, 'rewritten Gemini input')).toThrow('original Gemini');
});
