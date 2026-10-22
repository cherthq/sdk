import { describe, expect, test } from 'bun:test';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { main } from '../src/main';
import { PROVIDERS } from '../src/providers';
import { scan, type Finding } from '../src/scan';

const fixtures = resolve(import.meta.dir, '../fixtures');
const SECRETS = ['sb_live_SECRET_VALUE_XYZ', 'sb_example_value_DO_NOT_PRINT', 'sb_hardcoded_SECRET_123', 'tb_live_abc123SECRET', 'brk_test_SECRETxyz'];

function git(dir: string, ...args: string[]) {
  const child = Bun.spawnSync(['git', '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: dir });
  if (child.exitCode !== 0) throw new Error(child.stderr.toString());
  return child.stdout.toString();
}
function project(name: string, extra?: (dir: string) => void): string {
  const dir = mkdtempSync(join(tmpdir(), `chert-adopt-${name}-`));
  cpSync(join(fixtures, name), dir, { recursive: true });
  writeFileSync(join(dir, '.gitignore'), '.env\n');
  extra?.(dir);
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'fixture');
  return dir;
}
function run(dir: string, ...args: string[]) {
  const out: string[] = [], err: string[] = [];
  const code = main([dir, ...args], s => out.push(s), s => err.push(s));
  return { code, out: out.join('\n'), err: err.join('\n') };
}
const brief = (f: Finding[]) => f.filter(x => x.class).map(x => `${x.file}:${x.line} ${x.kind} ${x.op ?? x.name ?? `${x.method} ${x.url}`} ${x.class}`);
const snapshot = (dir: string) => Object.fromEntries(git(dir, 'ls-files').trim().split('\n').map(f => [f, readFileSync(join(dir, f), 'utf8')]));

describe('detection and classification', () => {
  test('sendblue TypeScript project', () => {
    const result = scan(join(fixtures, 'sendblue-ts'));
    expect(brief(result.findings)).toEqual([
      'src/reaction.ts:1 http POST https://api.sendblue.com/api/send-reaction drop_in',
      'src/send.ts:1 import sendblue -> @cherthq/sendblue-adapter drop_in',
      'src/send.ts:3 constructor new SendblueAPI drop_in',
      'src/send.ts:6 call messages.send drop_in',
      'src/send.ts:7 call messages.getStatus drop_in',
      'src/webhook.ts:4 webhook POST /webhooks/sendblue native',
      'src/webhook.ts:5 webhook payload.message_handle drop_in',
      'src/webhook.ts:5 webhook payload.from_number drop_in',
      'src/webhook.ts:5 webhook payload.date_sent unsupported',
    ]);
    expect(result.findings.filter(f => f.kind === 'env').map(f => f.name)).toEqual(['SENDBLUE_API_API_KEY', 'SENDBLUE_API_API_SECRET', 'SENDBLUE_API_API_SECRET']);
    expect(result.findings.find(f => f.kind === 'dependency')).toMatchObject({ file: 'package.json', name: 'sendblue' });
  });

  test('linq JavaScript project keeps imports with native and unsupported usages', () => {
    const result = scan(join(fixtures, 'linq-js'));
    expect(brief(result.findings)).toEqual([
      'src/index.mjs:1 import @linqapp/sdk unsupported',
      'src/index.mjs:3 constructor new Linq drop_in',
      'src/index.mjs:6 call chats.messages.send drop_in',
      'src/index.mjs:7 call chats.typing.start drop_in',
      'src/index.mjs:8 call chats.create native',
      'src/index.mjs:9 call chats.participants.add unsupported',
      'src/named.js:1 import @linqapp/sdk unsupported',
      'src/named.js:3 constructor new LinqAPIV3 unsupported',
      'src/named.js:4 call messages.retrieve drop_in',
    ]);
    expect(result.edits.map(e => e.ok)).toEqual([false, false]);
    expect(result.findings.find(f => f.op === 'chats.create')!.note).toContain('sendText');
  });

  test('legacy blooio: class-property client, subpath type import, CommonJS require', () => {
    const result = scan(join(fixtures, 'blooio-ts'));
    expect(brief(result.findings)).toEqual([
      'src/legacy.cjs:1 import @blooio/sdk unsupported',
      'src/legacy.cjs:3 constructor new Blooio unsupported',
      'src/legacy.cjs:4 call messages.cancel unsupported',
      'src/notifier.ts:1 import @blooio/sdk -> @cherthq/blooio-adapter drop_in',
      'src/notifier.ts:5 constructor new Blooio drop_in',
      'src/notifier.ts:8 call messages.send drop_in',
      'src/notifier.ts:12 call me.retrieve drop_in',
    ]);
    expect(result.findings.find(f => f.name === '@blooio/sdk/resources/messages')!.note).toContain('Subpath import');
  });

  test('raw HTTP providers resolve constants, templates and HTTP methods', () => {
    expect(brief(scan(join(fixtures, 'blooio-v4-ts')).findings)).toEqual([
      'src/api.ts:4 http POST https://api.blooio.com/v4/messages drop_in',
      'src/api.ts:5 http GET https://api.blooio.com/v4/chats/{}/messages/{}/status drop_in',
      'src/api.ts:6 http POST https://api.blooio.com/v4/chats/{}/messages/{}/reactions unsupported',
      'src/api.ts:7 http POST https://api.blooio.com/v4/groups unsupported',
    ]);
    expect(brief(scan(join(fixtures, 'loopmessage-js')).findings)).toEqual([
      'client.js:3 http POST https://a.loopmessage.com/api/v1/message/send/ drop_in',
      'client.js:6 http GET https://a.loopmessage.com/api/v1/message/status/{}/ drop_in',
      'client.js:7 http POST https://server.loopmessage.com/api/v1/message/send/ unsupported',
    ]);
    expect(brief(scan(join(fixtures, 'missblue-ts')).findings)).toEqual([
      'index.ts:3 http POST https://api.missblue.dev/v1/messages drop_in',
      'index.ts:6 http GET https://api.missblue.dev/v1/numbers drop_in',
      'index.ts:7 http GET https://api.missblue.dev/v1/conversations unsupported',
    ]);
  });

  test('fetch-style providers added after the scope rename', () => {
    expect(brief(scan(join(fixtures, 'texting-blue-ts')).findings)).toEqual([
      'index.ts:4 http POST https://api.texting.blue/v1/messages/send drop_in',
      'index.ts:5 http GET https://api.texting.blue/v1/messages unsupported',
    ]);
    expect(brief(scan(join(fixtures, 'contiguity-js')).findings)).toEqual([
      'client.mjs:4 http POST https://api.contiguity.com/send/imessage drop_in',
      'client.mjs:5 http POST https://api.contiguity.com/send/imessage/typing drop_in',
      'client.mjs:6 http POST https://api.contiguity.com/send/imessage/reactions unsupported',
    ]);
    const bluereacher = scan(join(fixtures, 'bluereacher-ts')).findings;
    expect(brief(bluereacher)).toEqual([
      'index.ts:4 http POST https://api.bluereacher.com/v1/messages drop_in',
      'index.ts:5 http POST https://api.bluereacher.com/v1/typing unsupported',
    ]);
    expect(bluereacher.find(f => f.kind === 'credential')).toMatchObject({ file: 'config.yaml', line: 2, name: 'brk_test_…' });
    const jared = scan(join(fixtures, 'jared-js')).findings;
    expect(brief(jared)).toEqual(['bot.js:1 http POST http://localhost:3005/message drop_in']);
    expect(jared[0]!.note).toContain("createJaredFetch({origin: 'http://localhost:3005', chert})");
  });

  test('Python is detection-only', () => {
    const result = scan(join(fixtures, 'python-sendblue'));
    expect(result.findings.every(f => !f.class)).toBe(true);
    expect(result.findings.map(f => `${f.file}:${f.line} ${f.kind} ${f.name ?? f.url}`)).toEqual([
      'app.py:4 base_url https://api.sendblue.co/api/send-message',
      'app.py:9 env SENDBLUE_API_KEY_ID',
      'app.py:10 env SENDBLUE_API_SECRET_KEY',
      'requirements.txt:2 dependency sendblue',
    ]);
    expect(result.edits).toEqual([]);
  });

  test('Photon/Spectrum and BlueBubbles are reported as unsupported for drop-in', () => {
    const result = scan(join(fixtures, 'unsupported-providers'));
    expect(brief(result.findings)).toEqual([
      'index.ts:1 import spectrum-ts unsupported',
      'index.ts:4 http POST /api/v1/message/text unsupported',
      'index.ts:5 http POST https://api.messageblue.ai/sendIndividualMessage unsupported',
    ]);
    expect(result.findings.find(f => f.provider === 'messageblue')!.note).toStartWith('Unsupported for drop-in:');
    expect(result.findings.filter(f => f.kind === 'dependency').map(f => f.provider)).toEqual(['photon', 'photon']);
    expect(result.findings.find(f => f.kind === 'env')).toMatchObject({ provider: 'bluebubbles', name: 'BLUEBUBBLES_PASSWORD' });
    expect(JSON.stringify(result.findings)).not.toContain('password=');
  });

  test('--from narrows findings to one provider', () => {
    const dir = project('sendblue-ts');
    const json = JSON.parse(run(dir, '--json', '--from', 'linq').out);
    expect(json.findings).toEqual([]);
    expect(run(dir, '--from', 'nope').code).toBe(2);
  });
});

describe('dry run, write and safety', () => {
  test('dry run changes nothing', () => {
    const dir = project('sendblue-ts');
    const before = snapshot(dir);
    const result = run(dir);
    expect(result.code).toBe(0);
    expect(result.out).toContain('Dry run: no files changed.');
    expect(git(dir, 'status', '--porcelain')).toBe('');
    expect(snapshot(dir)).toEqual(before);
    expect(existsSync(join(dir, 'ADOPTION_REPORT.md'))).toBe(false);
  });

  test('--write applies exactly the drop-in rewrites and is idempotent', () => {
    const dir = project('sendblue-ts');
    const result = run(dir, '--write');
    expect(result.code).toBe(0);
    expect(git(dir, 'status', '--porcelain').split('\n').filter(Boolean).sort()).toEqual([' M .env.example', ' M package.json', ' M src/send.ts', '?? ADOPTION_REPORT.md']);
    expect(readFileSync(join(dir, 'src/send.ts'), 'utf8')).toBe(readFileSync(join(fixtures, 'sendblue-ts/src/send.ts'), 'utf8').replace("from 'sendblue'", "from '@cherthq/sendblue-adapter'"));
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(`{
  "name": "sendblue-fixture",
  "private": true,
  "type": "module",
  "dependencies": {
    "@cherthq/sendblue-adapter": "0.0.0",
    "express": "4.21.2"
  }
}
`);
    expect(readFileSync(join(dir, '.env.example'), 'utf8')).toBe('SENDBLUE_API_API_KEY=sb_example_value_DO_NOT_PRINT\nSENDBLUE_API_API_SECRET=\nCHERT_BASE_URL=\nCHERT_API_KEY=\nCHERT_WEBHOOK_SECRET=\n');
    const report = readFileSync(join(dir, 'ADOPTION_REPORT.md'), 'utf8');
    for (const heading of ['## Summary', '## Unsupported blockers (1)', '## Findings', '## Webhook payload mapping', '## Manual steps']) expect(report).toContain(heading);
    expect(report).toContain('`src/send.ts:3`: Add `chert:');
    expect(report).toContain('not full parity');
    expect(report).toContain('Reported as unsupported for drop-in when detected: Photon / Spectrum, BlueBubbles, MessageBlue,');

    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'adopt');
    const again = run(dir, '--write');
    expect(again.code).toBe(0);
    expect(again.out).toContain('No changes needed.');
    expect(git(dir, 'status', '--porcelain')).toBe('');
  });

  test('mixed imports keep the vendor dependency and only rewrite safe files', () => {
    const dir = project('blooio-ts');
    expect(run(dir, '--write').code).toBe(0);
    expect(readFileSync(join(dir, 'src/notifier.ts'), 'utf8')).toStartWith('import Blooio from "@cherthq/blooio-adapter";\nimport type { MessageSendResponse } from "@blooio/sdk/resources/messages";');
    expect(readFileSync(join(dir, 'src/legacy.cjs'), 'utf8')).toBe(readFileSync(join(fixtures, 'blooio-ts/src/legacy.cjs'), 'utf8'));
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).dependencies).toEqual({ '@blooio/sdk': '0.0.2', '@cherthq/blooio-adapter': '0.1.0' });
    expect(readFileSync(join(dir, 'ADOPTION_REPORT.md'), 'utf8')).toContain('`src/legacy.cjs:4` Blooio SDK 0.0.2 `messages.cancel`: Message cancellation is rejected');
  });

  test('blocked imports are not rewritten; fetch adapters are added as dependencies only', () => {
    const linq = project('linq-js');
    expect(run(linq, '--write').code).toBe(0);
    expect(git(linq, 'status', '--porcelain').trim().split('\n').sort()).toEqual(['?? .env.example', '?? ADOPTION_REPORT.md']);
    const report = readFileSync(join(linq, 'ADOPTION_REPORT.md'), 'utf8');
    expect(report).toContain('`src/index.mjs:9` Linq 0.78 `chats.participants.add`');
    expect(report).toContain('`src/named.js:1`');

    const v4 = project('blooio-v4-ts');
    expect(run(v4, '--write').code).toBe(0);
    expect(JSON.parse(readFileSync(join(v4, 'package.json'), 'utf8')).dependencies).toEqual({ '@cherthq/blooio-v4-adapter': '0.1.0' });
    expect(readFileSync(join(v4, 'src/api.ts'), 'utf8')).toBe(readFileSync(join(fixtures, 'blooio-v4-ts/src/api.ts'), 'utf8'));
  });

  test('destructured CommonJS SDK imports stay on the vendor package', () => {
    const dir = project('sendblue-ts', d => {
      for (const file of ['send.ts', 'reaction.ts', 'webhook.ts']) writeFileSync(join(d, 'src', file), '');
      writeFileSync(join(d, 'src/legacy.cjs'), [
        "const { SendblueAPI } = require('sendblue');",
        'const client = new SendblueAPI({ apiServiceKey: process.env.SENDBLUE_API_KEY });',
        "client.messages.send({ from_number: '+15550000001', body: 'hello' });",
      ].join('\n') + '\n');
      writeFileSync(join(d, 'src/unused.cjs'), "const sdk = require('sendblue');\nvoid sdk;\n");
    });
    const result = scan(dir);
    expect(result.edits.map(edit => [edit.file, edit.ok])).toEqual([['src/legacy.cjs', false], ['src/unused.cjs', false]]);
    expect(result.findings.find(finding => finding.file === 'src/legacy.cjs' && finding.kind === 'constructor')).toMatchObject({ class: 'unsupported' });
    const original = readFileSync(join(dir, 'src/legacy.cjs'), 'utf8');
    const unused = readFileSync(join(dir, 'src/unused.cjs'), 'utf8');

    expect(run(dir, '--write').code).toBe(0);
    expect(readFileSync(join(dir, 'src/legacy.cjs'), 'utf8')).toBe(original);
    expect(readFileSync(join(dir, 'src/unused.cjs'), 'utf8')).toBe(unused);
    const dependencies = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).dependencies;
    expect(dependencies.sendblue).toBe('3.20.1');
    expect(dependencies).not.toHaveProperty('@cherthq/sendblue-adapter');
  });

  test('unresolved namespace constructors block an SDK import rewrite', () => {
    const dir = project('linq-js', d => {
      writeFileSync(join(d, 'src/index.mjs'), '');
      writeFileSync(join(d, 'src/named.js'), '');
      writeFileSync(join(d, 'src/unresolved.mjs'), [
        "import * as Sdk from '@linqapp/sdk';",
        'const client = new Sdk.Linq({ key: process.env.LINQ_API_KEY });',
        'client.chats.messages.send({});',
      ].join('\n') + '\n');
      writeFileSync(join(d, 'src/nested.mjs'), [
        "import * as Sdk from '@linqapp/sdk';",
        'const client = new Sdk.Linq.Client({ key: process.env.LINQ_API_KEY });',
        'client.chats.messages.send({});',
      ].join('\n') + '\n');
    });
    const result = scan(dir);
    expect(result.edits.map(edit => [edit.file, edit.ok])).toEqual([['src/nested.mjs', false], ['src/unresolved.mjs', false]]);
    expect(result.findings.find(finding => finding.file === 'src/unresolved.mjs' && finding.kind === 'import')).toMatchObject({ class: 'unsupported' });
    const original = readFileSync(join(dir, 'src/unresolved.mjs'), 'utf8');
    const nested = readFileSync(join(dir, 'src/nested.mjs'), 'utf8');

    expect(run(dir, '--write').code).toBe(0);
    expect(readFileSync(join(dir, 'src/unresolved.mjs'), 'utf8')).toBe(original);
    expect(readFileSync(join(dir, 'src/nested.mjs'), 'utf8')).toBe(nested);
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).dependencies).toEqual({ '@linqapp/sdk': '0.78.0' });
  });

  test('refuses to write into a dirty tree unless --allow-dirty', () => {
    const dir = project('sendblue-ts');
    writeFileSync(join(dir, 'src/send.ts'), readFileSync(join(dir, 'src/send.ts'), 'utf8') + '\n// local edit\n');
    const refused = run(dir, '--write');
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('uncommitted changes');
    expect(readFileSync(join(dir, 'src/send.ts'), 'utf8')).toContain("from 'sendblue'");
    expect(existsSync(join(dir, 'ADOPTION_REPORT.md'))).toBe(false);
    expect(run(dir, '--write', '--allow-dirty').code).toBe(0);
    expect(readFileSync(join(dir, 'src/send.ts'), 'utf8')).toContain("from '@cherthq/sendblue-adapter'");
  });

  test('refuses --write outside git and --install without --write', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chert-adopt-nogit-'));
    cpSync(join(fixtures, 'missblue-ts'), dir, { recursive: true });
    expect(run(dir, '--write').err).toContain('not inside a git working tree');
    expect(run(dir, '--install').code).toBe(2);
    const nolock = project('sendblue-ts');
    expect(run(nolock, '--write', '--install').err).toContain('no lockfile found');
  });

  test('secret values never appear in output, JSON or the report', () => {
    for (const name of readdirSync(fixtures)) {
      const dir = project(name, d => writeFileSync(join(d, '.env'), 'SENDBLUE_API_API_SECRET=sb_live_SECRET_VALUE_XYZ\nCHERT_API_KEY=sb_live_SECRET_VALUE_XYZ\n'));
      const outputs = [run(dir).out, run(dir, '--json').out, run(dir, '--write').out, run(dir, '--json', '--write', '--allow-dirty').out, readFileSync(join(dir, 'ADOPTION_REPORT.md'), 'utf8')];
      for (const output of outputs) for (const secret of SECRETS) expect(output).not.toContain(secret);
      expect(readFileSync(join(dir, '.env'), 'utf8')).toBe('SENDBLUE_API_API_SECRET=sb_live_SECRET_VALUE_XYZ\nCHERT_API_KEY=sb_live_SECRET_VALUE_XYZ\n');
    }
  });
});

test('adapter versions in the provider table match the workspace packages', () => {
  for (const provider of PROVIDERS.filter(p => p.adapter)) {
    const dir = provider.adapter!.package.replace('@cherthq/', '');
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dir, '../..', dir, 'package.json'), 'utf8'));
    expect([pkg.name, pkg.version]).toEqual([provider.adapter!.package, provider.adapter!.version]);
  }
});
