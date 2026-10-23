import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');
/** Every package a built file pulls in the moment it is imported: static imports only, followed through our own files. */
function loadedWith(entry: string): Set<string> {
  const packages = new Set<string>(), seen = new Set<string>(), queue = [resolve(dist, entry)];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file); assert.ok(existsSync(file), file);
    // A static import or re-export has `from` before its specifier, or is a bare `import '...'`; import('...') is not matched.
    for (const match of readFileSync(file, 'utf8').matchAll(/^\s*(?:import|export)\s[^;]*?from\s+'([^']+)'|^\s*import\s+'([^']+)'/gm)) {
      const specifier = (match[1] ?? match[2])!;
      if (specifier.startsWith('.')) queue.push(resolve(dirname(file), specifier));
      else if (!specifier.startsWith('node:')) packages.add(specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/'));
    }
  }
  return packages;
}

test('startup: --help, --version and a mistyped command load no package at all', () => {
  assert.deepEqual([...loadedWith('cli/main.js')], []);
  assert.deepEqual([...loadedWith('cli/commands.js')], [], 'the router imports only names, errors, the version and signal handling');
});

test('startup: login, whoami and logout never load LiveKit or the socket library', () => {
  const packages = loadedWith('dev/command.js');
  assert.ok(!packages.has('livekit-server-sdk'), 'LiveKit is loaded by dev and doctor when they reach it');
  assert.ok(!packages.has('ws'), 'the socket library is loaded when chert dev connects');
  assert.deepEqual([...packages], ['zod'], 'schema checks are all a sign-in command needs');
});

test('startup: the commands that need LiveKit still reach it', () => {
  assert.ok(loadedWith('dev/dispatch-handler.js').has('livekit-server-sdk'));
  assert.ok(loadedWith('byor/run.js').has('ws'));
  assert.ok(loadedWith('cli/operator.js').has('zod'));
});
