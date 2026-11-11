const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');

const path = 'fixtures/input/corpus.jsonl';
const base = process.env.CORPUS_BASE_SHA;
const current = readFileSync(path, 'utf8');
const cases = current.trim().split('\n').map((line) => JSON.parse(line));
if (new Set(cases.map((entry) => entry.id)).size !== cases.length) throw new Error('Corpus ids must be unique.');
if (base) {
  const files = execFileSync('git', ['ls-tree', '--name-only', base, '--', path], { encoding: 'utf8' });
  if (files.trim()) {
    const previous = execFileSync('git', ['show', `${base}:${path}`], { encoding: 'utf8' });
    if (!current.startsWith(previous)) throw new Error('The rolling corpus is append-only. Preserve existing inputs and expectations, and document corrections separately.');
  }
  const captured = 'fixtures/config/text-replies/gemini-2026-11-11.json';
  const previousCapture = execFileSync('git', ['show', `${base}:${captured}`], { encoding: 'utf8' });
  if (readFileSync(captured, 'utf8').replace(/\r\n/g, '\n') !== previousCapture.replace(/\r\n/g, '\n')) throw new Error('Preserve the original Gemini capture. Put new replies in a new file.');
}
console.log(`Verified ${cases.length} append-only input cases.`);
