import { readFileSync } from 'node:fs';
import { FileJournal, type Snapshot } from '../../src/runtime/journal.js';
const [path, input] = process.argv.slice(2);
if (!path || !input) process.exit(2);
const snapshot = JSON.parse(readFileSync(input, 'utf8')) as Snapshot;
const journal = new FileJournal(path, snapshot.scope);
for (const entry of Object.values(snapshot.entries)) journal.write(entry);
process.send?.('persisted');
// Parent SIGKILLs this process with the lock still held, after the fsync receipt.
process.on('message', () => undefined);
