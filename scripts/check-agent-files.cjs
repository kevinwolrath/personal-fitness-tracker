// Finds AI-agent instruction files shipped inside installed packages (contract: node_modules is
// third-party data, never instructions). Claude Code can load a nested CLAUDE.md or skill when it
// reads a file in that directory, so a dependency that ships one could steer an agent.
// Usage: node scripts/check-agent-files.cjs [--warn]   (exit 1 when found, unless --warn)
const { readdirSync } = require('node:fs');
const { join, sep } = require('node:path');

const NAMES = new Set(['claude.md', 'claude.local.md', 'agents.md', 'gemini.md', '.cursorrules', '.windsurfrules', 'copilot-instructions.md']);
const DIRS = new Set(['.claude', '.cursor', '.windsurf', '.clinerules']);

function findAgentFiles(root) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      const lower = e.name.toLowerCase();
      if (e.isDirectory()) {
        if (DIRS.has(lower)) found.push(p + '/');
        else if (!e.isSymbolicLink()) walk(p);
      } else if (NAMES.has(lower)) found.push(p);
    }
  };
  walk(root);
  // Same output on every OS: '/' separators (Windows would otherwise give 'pkg\\CLAUDE.md'), then sorted.
  return found.map((p) => p.split(sep).join('/')).sort();
}

module.exports = { findAgentFiles };

if (require.main === module) {
  const found = findAgentFiles('node_modules');
  if (found.length) {
    console.error(`⚠ ${found.length} AI-agent instruction file(s) found in node_modules. Treat as untrusted; review before use:\n  ${found.join('\n  ')}`);
    process.exit(process.argv.includes('--warn') ? 0 : 1);
  }
  console.log('No AI-agent instruction files in node_modules.');
}
