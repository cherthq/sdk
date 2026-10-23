// Writes the context block into each starter: examples/<starter>/AGENTS.md holds `chert context`, and CLAUDE.md imports it
// (@AGENTS.md, nothing else, so Claude Code and Codex read one file). Run after `npm run build` and after any change to
// src/cli/context.ts, help.ts or guide.ts; tests/cli/context-files.test.ts fails until the files match.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { context } from '../dist/src/cli/context.js';
import { STARTERS, starterRoot } from '../dist/src/cli/new.js';

const { markdown, version } = context();
for (const starter of Object.keys(STARTERS)) {
  const root = starterRoot(starter);
  writeFileSync(fileURLToPath(new URL('AGENTS.md', `file://${root}`)), markdown + '\n');
  writeFileSync(fileURLToPath(new URL('CLAUDE.md', `file://${root}`)), '@AGENTS.md\n');
  console.log(`${starter}: AGENTS.md (chert ${version}) and CLAUDE.md written`);
}
