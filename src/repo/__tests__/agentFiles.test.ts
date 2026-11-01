/**
 * Guard: no installed package ships AI-agent instruction files (CLAUDE.md, AGENTS.md, .claude/ skills, …).
 * Claude Code can load these when it reads files in node_modules; they are third-party data, not instructions.
 * If this fails after adding a dependency, inspect the listed files before going further.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { findAgentFiles } = require('../../../scripts/check-agent-files.cjs');

it('node_modules contains no AI-agent instruction files', () => {
  expect(findAgentFiles('node_modules')).toEqual([]);
});

it('the detector finds the files and directories it looks for', () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-files-'));
  mkdirSync(join(root, 'pkg', '.claude', 'skills', 'x'), { recursive: true });
  mkdirSync(join(root, 'other', 'deep'), { recursive: true });
  writeFileSync(join(root, 'pkg', 'CLAUDE.md'), 'do things');
  writeFileSync(join(root, 'other', 'deep', 'AGENTS.md'), 'do things');
  writeFileSync(join(root, 'other', 'README.md'), 'fine');
  expect(findAgentFiles(root).map((p: string) => p.slice(root.length + 1))).toEqual(['other/deep/AGENTS.md', 'pkg/.claude/', 'pkg/CLAUDE.md']);
});
