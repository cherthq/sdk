import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { context } from '../../src/cli/context.js';
import { STARTERS, starterRoot } from '../../src/cli/new.js';

test('starters: each ships the context block as AGENTS.md and a CLAUDE.md that imports it; a changed block fails here', () => {
  const { markdown } = context();
  for (const starter of Object.keys(STARTERS) as (keyof typeof STARTERS)[]) {
    const root = starterRoot(starter);
    assert.equal(readFileSync(`${root}AGENTS.md`, 'utf8'), markdown + '\n', `run node scripts/agent-context.mjs after changing src/cli/context.ts (${starter})`);
    assert.equal(readFileSync(`${root}CLAUDE.md`, 'utf8'), '@AGENTS.md\n', starter);
  }
});
