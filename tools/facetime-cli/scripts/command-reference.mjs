// Writes COMMANDS.md from the help entries. Run after `npm run build`: node scripts/command-reference.mjs
import { writeFileSync } from 'node:fs';
import { commandReference } from '../dist/src/cli/help.js';

writeFileSync(new URL('../COMMANDS.md', import.meta.url), commandReference());
