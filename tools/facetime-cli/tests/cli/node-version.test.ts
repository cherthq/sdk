import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { supportedNode, SUPPORTED_NODE } from '../../src/cli/node-version.js';

test('any Node 22 from 22.12, any Node 24 and any Node 26 is supported', () => {
  for (const version of ['22.12.0', '22.14.1', '22.23.2', '22.23.3', '22.99.0', '24.0.0', '24.14.0', '24.21.0', '24.99.9', '26.0.0', '26.8.2', '26.11.0', '26.99.9'])
    assert.equal(supportedNode(version), true, version);
});

test('other major versions, older Node 22 and malformed versions are not supported', () => {
  for (const version of ['18.20.0', '20.19.6', '21.7.3', '22.0.0', '22.11.0', '23.11.0', '25.0.0', '27.0.0', '28.1.0', '', 'v24.1.0', 'v26.11.0', '24', '26', 'latest', '24.x.0'])
    assert.equal(supportedNode(version), false, version);
});

test('package.json engines says the same thing as the startup check', () => {
  const engines = (JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { engines: { node: string } }).engines.node;
  assert.equal(engines, SUPPORTED_NODE.range);
});

const executable = fileURLToPath(new URL('../../src/cli/main.js', import.meta.url));
function startAs(version: string) {
  return spawnSync(process.execPath, ['--input-type=module', '--eval',
    `Object.defineProperty(process.versions, 'node', { value: ${JSON.stringify(version)} }); process.argv = ['node', 'chert', '--version']; await import(${JSON.stringify(executable)});`],
    { env: { PATH: process.env.PATH }, encoding: 'utf8' });
}
for (const version of ['22.12.0', '22.23.3', '24.0.0', '24.21.0', '26.0.0', '26.11.0']) {
  test(`the CLI starts when Node reports ${version}`, () => {
    const p = startAs(version); assert.equal(p.status, 0, p.stderr); assert.match(p.stdout, /^chert \d/);
  });
}
for (const version of ['20.19.6', '23.11.0', '25.3.0', '27.0.0']) {
  test(`the CLI refuses Node ${version} and names the supported versions`, () => {
    const p = startAs(version); assert.equal(p.status, 5);
    assert.match(p.stderr, /unsupported_runtime/); assert.match(p.stderr, /Node 22 \(22\.12 or later\), Node 24 or Node 26/);
    assert.match(p.stderr, new RegExp(`You have Node ${version.replaceAll('.', '\\.')}`), 'and says which one was found');
  });
}
