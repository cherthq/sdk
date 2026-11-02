import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectProject, e164, maskNumber, parseMessagesAliases, runOnboard, type OnboardDeps } from './onboard';

const A = '+15555550100', B = '+15555550199', LINE = '+15555550123', FOREIGN = '+15555550142';
const TOKEN = `ftu_${'t'.repeat(43)}`, PROJECT = '11111111-1111-4111-8111-111111111111', SESSION = '22222222-2222-4222-8222-222222222222';
const DEVICE = `fpl_${'d'.repeat(43)}`, CALL = '33333333-3333-4333-8333-333333333333';
const CODE = '482913';
const message = (number: string) => `CHERT-LOGIN-${number.slice(-4)}SECRET`;

interface World {
  aliases: unknown[]; home: string; cwd: string; out: string[]; err: string[]; sent: string[][]; calls: { path: string; body: unknown; headers: Headers; method: string }[];
  execFail: Record<string, { stderr?: string }>; prompts: string[]; answers: string[]; ignored: boolean; chertInstalled: boolean; npmPublished: boolean; installs: string[][];
  verified: string[]; unlinked: string[]; finishOnly: boolean; tokenPolls: number; session: Record<string, unknown>; responses: Record<string, { status: number; body: unknown }>;
  platform: string; interactive: boolean; now: number;
}
let world: World;
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'chert-onboard-'));
  mkdirSync(join(root, 'home'));
  mkdirSync(join(root, 'cwd'));
  world = { aliases: [A], home: join(root, 'home'), cwd: join(root, 'cwd'), out: [], err: [], sent: [], calls: [], execFail: {}, prompts: [], answers: [], ignored: true, chertInstalled: true, npmPublished: true, installs: [],
    verified: [A], unlinked: [], finishOnly: false, tokenPolls: 0, session: { status: 'awaiting_verification' }, responses: {}, platform: 'darwin', interactive: false, now: 1_000_000 };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function deps(): OnboardDeps {
  return {
    async exec(file, args) {
      const fail = world.execFail[file];
      if (fail) throw Object.assign(new Error('failed'), fail);
      if (file === 'plutil') return { stdout: JSON.stringify({ allAliases: world.aliases, selectedAliases: [] }) };
      if (file === 'osascript') { world.sent.push(args); return { stdout: '' }; }
      if (file === 'git') { if (!world.ignored) throw new Error('not ignored'); return { stdout: '' }; }
      if (file === 'chert') { if (!world.chertInstalled) throw new Error('missing'); return { stdout: '1' }; }
      if (file === 'npm') {
        if (args[0] === 'view') { if (!world.npmPublished) throw new Error('missing'); return { stdout: '1' }; }
        world.installs.push(args); return { stdout: '' };
      }
      throw new Error(`unexpected ${file}`);
    },
    fetch: (async (input: URL, init: RequestInit) => {
      const path = new URL(input).pathname, body = init.body ? JSON.parse(String(init.body)) : undefined;
      world.calls.push({ path, body, headers: new Headers(init.headers), method: init.method ?? 'GET' });
      const canned = world.responses[path];
      if (canned) return Response.json(canned.body, { status: canned.status });
      const data = route(path, init.method ?? 'GET', body);
      return Response.json({ data }, { status: 200 });
    }) as unknown as typeof fetch,
    async prompt(question) { world.prompts.push(question); return world.answers.shift() ?? ''; },
    now: () => world.now,
    async sleep(ms) { world.now += ms; },
    out: line => world.out.push(line),
    err: line => world.err.push(line),
    platform: world.platform,
    interactive: world.interactive,
    home: world.home,
    cwd: world.cwd,
    env: {},
    deviceName: 'Test Mac',
  };
}

function route(path: string, method: string, body: { numbers?: string[]; finish?: boolean; recipient?: string }): unknown {
  const view = () => ({ id: SESSION, line: { id: PROJECT, receiving_number: LINE }, ...world.session });
  if (path === '/api/v1/phone-logins') return { device_code: DEVICE, receiving_number: LINE, expires_in: 600, interval: 2, challenges: body.numbers!.map(number => ({ number, message: message(number) })) };
  if (path === '/api/v1/phone-logins/token') {
    world.tokenPolls++;
    if (world.finishOnly && !body.finish) return { status: 'pending', verified_count: world.verified.length };
    if (!world.verified.length) return { status: 'pending', verified_count: 0 };
    return { status: 'approved', access_token: TOKEN, project_id: PROJECT, verified_numbers: world.verified, unlinked_numbers: world.unlinked, device_name: 'Test Mac', expires_in: 86400 };
  }
  if (path === '/api/v1/allowance') return { plan: 'trial', minutes_left: 10, nested: { secret: 'no' } };
  if (path === '/api/v1/onboarding') return view();
  if (path.endsWith('/verify')) { world.session = { status: 'ready' }; return { code: CODE, recipient: body.recipient }; }
  if (path.endsWith('/demo')) { world.session = { status: 'demo_running', demo_call_id: CALL }; return view(); }
  if (method === 'GET') return view();
  throw new Error(`unexpected ${path}`);
}

const records = () => world.out.map(line => JSON.parse(line) as { code: string; [key: string]: unknown });
const failure = () => JSON.parse(world.err.at(-1)!) as { code: string; [key: string]: unknown };
const run = (...args: string[]) => runOnboard(['--json', ...args], deps());
const everything = () => [...world.out, ...world.err].join('\n');
const credentials = () => join(world.home, '.chert', 'credentials.json');

test('masks numbers to their last four digits', () => {
  expect(maskNumber(A)).toBe('•••0100');
});

test('parses Messages aliases: numbers only, each once', () => {
  expect(parseMessagesAliases(JSON.stringify({ allAliases: [A, ' ' + B, 'person@example.com', A, '+0123456', '15555550100', 7, null] }))).toEqual([A, B]);
  expect(parseMessagesAliases('not json')).toEqual([]);
  expect(parseMessagesAliases('{}')).toEqual([]);
  expect(e164(' +15555550100 ')).toBe(A);
  expect(e164('tel:+15555550100')).toBeNull();
});

test('refuses to run off a Mac', async () => {
  world.platform = 'linux';
  expect(await run('--yes')).toBe(1);
  expect(failure().code).toBe('macos_required');
  expect(world.calls).toEqual([]);
});

test('reports no numbers when Messages has none or cannot be read', async () => {
  world.aliases = ['person@example.com'];
  expect(await run('--yes')).toBe(1);
  expect(failure().code).toBe('no_phone_numbers');
  world.execFail.plutil = {};
  expect(await run('--yes')).toBe(1);
  expect(failure().code).toBe('no_phone_numbers');
  expect(world.calls).toEqual([]);
});

test('a machine caller without a choice gets masked numbers and nothing is sent', async () => {
  world.aliases = [A, B];
  expect(await run()).toBe(1);
  expect(failure()).toMatchObject({ code: 'numbers_required', numbers: [{ index: 1, number: '•••0100' }, { index: 2, number: '•••0199' }] });
  expect(world.calls).toEqual([]);
  expect(world.sent).toEqual([]);
  expect(everything()).not.toContain(A);
});

test('a terminal without json still stops without a real terminal', async () => {
  expect(await runOnboard([], deps())).toBe(1);
  expect(world.err.at(-1)).toContain('--numbers');
  expect(world.calls).toEqual([]);
});

test('a number not on this Mac is refused before any request', async () => {
  expect(await run('--numbers', FOREIGN)).toBe(1);
  expect(failure().code).toBe('number_not_on_this_mac');
  expect(await run('--numbers', '9')).toBe(1);
  expect(failure().code).toBe('number_not_on_this_mac');
  expect(await run('--numbers', 'nonsense')).toBe(1);
  expect(failure().code).toBe('invalid_numbers');
  expect(world.calls).toEqual([]);
  expect(everything()).not.toContain(FOREIGN);
});

test('the concierge asks which number, then confirms before sending', async () => {
  world.aliases = [A, B];
  world.interactive = true;
  world.answers = ['2', 'y'];
  expect(await runOnboard(['--skip-demo', '--no-wire'], deps())).toBe(1);
  expect(world.out.join('\n')).toContain(B);
  expect(world.prompts[1]).toContain('from your Messages app');
  const login = world.calls.find(call => call.path === '/api/v1/phone-logins')!;
  expect(login.body).toEqual({ device_name: 'Test Mac', numbers: [B] });
});

test('choosing all sends one code per number, and declining sends nothing', async () => {
  world.aliases = [A, B];
  world.interactive = true;
  world.answers = ['n', 'n'];
  world.answers = ['both', 'n'];
  expect(await runOnboard([], deps())).toBe(1);
  expect(world.err.at(-1)).toBe('Nothing was sent.');
  expect(world.calls).toEqual([]);
  world.answers = ['all', 'yes'];
  world.verified = [A, B];
  expect(await runOnboard(['--no-wire'], deps())).toBe(0);
  const loginMessages = world.sent.map(args => args.at(-2));
  expect(loginMessages.slice(0, 2)).toEqual([message(A), message(B)]);
});

test('sends values as argv so metacharacters stay data', async () => {
  const hostile = 'x" & (do shell script "id") & "`$(id)`;\'';
  world.responses['/api/v1/phone-logins'] = { status: 200, body: { data: { device_code: DEVICE, receiving_number: LINE, expires_in: 600, interval: 2, challenges: [{ number: A, message: hostile }] } } };
  expect(await run('--yes', '--no-wire', '--skip-demo')).toBe(0);
  const args = world.sent[0]!;
  expect(args.at(-2)).toBe(hostile);
  expect(args.at(-1)).toBe(LINE);
  const script = args.slice(0, -2).join('\n');
  expect(script).not.toContain('do shell script');
  expect(script).toContain('send (item 1 of argv) to participant (item 2 of argv)');
});

test('refuses server values that could be read as options or point at other numbers', async () => {
  world.responses['/api/v1/phone-logins'] = { status: 200, body: { data: { device_code: DEVICE, receiving_number: LINE, expires_in: 600, interval: 2, challenges: [{ number: A, message: '-e do shell script' }] } } };
  expect(await run('--yes')).toBe(1);
  expect(failure().code).toBe('backend_response_invalid');
  world.responses['/api/v1/phone-logins'] = { status: 200, body: { data: { device_code: DEVICE, receiving_number: LINE, expires_in: 600, interval: 2, challenges: [{ number: FOREIGN, message: 'CODE' }] } } };
  expect(await run('--yes')).toBe(1);
  expect(failure().code).toBe('backend_response_invalid');
  expect(world.sent).toEqual([]);
});

test('automation denial names the setting and no sign-in is left behind', async () => {
  world.execFail.osascript = { stderr: 'execution error: Not authorized to send Apple events to Messages. (-1743)' };
  expect(await run('--yes')).toBe(1);
  expect(failure().code).toBe('messages_permission_denied');
  expect(failure().error).toContain('Privacy & Security > Automation');
  expect(existsSync(credentials())).toBe(false);
  expect(existsSync(join(world.home, '.chert', 'onboarding'))).toBe(false);
});

test('other send failures do not repeat what Messages said', async () => {
  world.execFail.osascript = { stderr: `some error mentioning ${A}` };
  expect(await run('--yes')).toBe(1);
  expect(failure().code).toBe('messages_send_failed');
  expect(everything()).not.toContain(A);
});

test('runs the whole flow: code, sign-in, trial, verification, demo', async () => {
  expect(await run('--yes', '--no-wire')).toBe(0);
  expect(records().map(r => r.code)).toEqual(['numbers_detected', 'login_code_sent', 'signed_in', 'trial_status', 'verification_sent', 'demo_requested']);
  expect(world.sent.map(args => args.slice(-2))).toEqual([[message(A), LINE], [CODE, LINE]]);
  const onboarding = world.calls.find(call => call.path === '/api/v1/onboarding')!;
  expect(onboarding.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
  expect(onboarding.headers.get('x-chert-project-id')).toBe(PROJECT);
  expect(onboarding.headers.get('idempotency-key')).toBeTruthy();
  const demo = world.calls.find(call => call.path.endsWith('/demo'))!;
  expect(demo.body).toEqual({ when_busy: 'queue' });
  const verify = world.calls.find(call => call.path.endsWith('/verify'))!;
  expect(verify.body).toEqual({ recipient: A });
  const requested = records().find(r => r.code === 'demo_requested')!;
  expect(requested.message).toContain('does not confirm that audio or video worked');
  expect(records().find(r => r.code === 'trial_status')!.allowance).toEqual({ plan: 'trial', minutes_left: 10 });
});

test('never prints a code, token, device code or full number', async () => {
  mkdirSync(join(world.cwd, '.git'));
  expect(await run('--yes')).toBe(0);
  const text = everything();
  for (const secret of [TOKEN, DEVICE, CODE, message(A), A, LINE]) expect(text).not.toContain(secret);
});

test('saves the sign-in in the format and place the chert CLI reads', async () => {
  expect(await run('--yes', '--no-wire', '--skip-demo')).toBe(0);
  const saved = JSON.parse(readFileSync(credentials(), 'utf8'));
  expect(saved).toEqual({ access_token: TOKEN, expires_at: 1_000_000 + 86400_000, kind: 'cli', project_id: PROJECT, device_name: 'Test Mac', origin: 'https://facetime.trychert.com' });
  expect(statSync(credentials()).mode & 0o777).toBe(0o600);
  expect(statSync(join(world.home, '.chert')).mode & 0o777).toBe(0o700);
  const resumeFile = join(world.home, '.chert', 'onboarding', `${createHash('sha256').update(JSON.stringify(['https://facetime.trychert.com', PROJECT])).digest('hex')}.json`);
  expect(JSON.parse(readFileSync(resumeFile, 'utf8'))).toEqual({ request_key: expect.any(String), session_id: SESSION });
});

test('a number Messages did not send from is reported, not claimed', async () => {
  world.aliases = [A, B];
  world.finishOnly = true;
  expect(await run('--yes', '--no-wire')).toBe(0);
  const signedIn = records().find(r => r.code === 'signed_in')!;
  expect(signedIn).toMatchObject({ verified: ['•••0100'], unverified: ['•••0199'] });
  expect(signedIn.message).toContain('Start New Conversations From');
  const finished = world.calls.filter(call => call.path.endsWith('/token')).at(-1)!;
  expect(finished.body).toEqual({ device_code: DEVICE, finish: true });
  expect(world.now - 1_000_000).toBeLessThan(60_000);
  expect(records().find(r => r.code === 'demo_requested')!.message).not.toContain('first one verified');
});

test('two verified numbers say which one is called, and a taken number is reported', async () => {
  world.aliases = [A, B];
  world.verified = [A, B];
  world.unlinked = [B];
  expect(await run('--yes', '--no-wire')).toBe(0);
  expect(records().find(r => r.code === 'signed_in')).toMatchObject({ unlinked: ['•••0199'] });
  expect(records().find(r => r.code === 'demo_requested')!.message).toContain('first one verified');
});

test('no verified number times out, asks for the sender setting and starts fresh next time', async () => {
  world.verified = [];
  expect(await run('--yes')).toBe(1);
  expect(failure().code).toBe('verification_timeout');
  expect(failure().error).toContain('Start New Conversations From');
  expect(world.calls.filter(call => call.path.endsWith('/token')).some(call => (call.body as { finish?: boolean }).finish)).toBe(true);
  expect(existsSync(credentials())).toBe(false);
  expect(readdirNames(join(world.home, '.chert', 'onboarding'))).toEqual([]);
});

test('a crash after sending resumes the same login without sending again, and keeps no code', async () => {
  const first = deps();
  const fetcher = first.fetch;
  first.fetch = (async (input: URL, init: RequestInit) => {
    if (new URL(input).pathname.endsWith('/token')) throw new Error('offline');
    return fetcher(input, init);
  }) as unknown as typeof fetch;
  first.sleep = async () => { throw new Error('killed'); };
  expect(await runOnboard(['--json', '--yes'], first)).toBe(1);
  expect(world.sent.length).toBe(1);
  const name = readdirNames(join(world.home, '.chert', 'onboarding')).find(file => file.startsWith('phone-login-'))!;
  const pendingText = readFileSync(join(world.home, '.chert', 'onboarding', name), 'utf8');
  expect(pendingText).not.toContain('SECRET');
  expect(pendingText).not.toContain(CODE);
  expect(statSync(join(world.home, '.chert', 'onboarding', name)).mode & 0o777).toBe(0o600);
  world.out = [];
  expect(await run('--yes', '--no-wire', '--skip-demo')).toBe(0);
  expect(records().map(r => r.code)).toContain('login_resumed');
  expect(world.calls.filter(call => call.path === '/api/v1/phone-logins').length).toBe(1);
  expect(readdirNames(join(world.home, '.chert', 'onboarding')).some(file => file.startsWith('phone-login-'))).toBe(false);
});

test('a rerun reuses the sign-in and session, and sends nothing already done', async () => {
  expect(await run('--yes', '--no-wire')).toBe(0);
  const sent = world.sent.length;
  world.out = [];
  world.calls = [];
  expect(await run('--yes', '--no-wire')).toBe(0);
  expect(world.sent.length).toBe(sent);
  expect(world.calls.some(call => call.path === '/api/v1/phone-logins')).toBe(false);
  expect(world.calls.some(call => call.path === '/api/v1/onboarding')).toBe(false);
  expect(world.calls.some(call => call.path === `/api/v1/onboarding/${SESSION}` && call.method === 'GET')).toBe(true);
  expect(records().map(r => r.code)).toContain('demo_requested');
});

test('a different sign-in is never overwritten', async () => {
  mkdirSync(join(world.home, '.chert'), { mode: 0o700 });
  writeFileSync(credentials(), JSON.stringify({ access_token: 'browser-session', expires_at: world.now + 1000 }), { mode: 0o600 });
  expect(await run('--yes')).toBe(1);
  expect(failure().code).toBe('existing_signin_conflict');
  expect(JSON.parse(readFileSync(credentials(), 'utf8')).access_token).toBe('browser-session');
  expect(world.sent).toEqual([]);
});

test('a readable-by-others credential file is refused', async () => {
  mkdirSync(join(world.home, '.chert'), { mode: 0o700 });
  writeFileSync(credentials(), '{}');
  chmodSync(credentials(), 0o644);
  expect(await run('--yes')).toBe(1);
  expect(failure().code).toBe('unsafe_file');
  expect(world.sent).toEqual([]);
});

test('known server errors get their action, and unknown ones reveal nothing', async () => {
  world.responses['/api/v1/onboarding'] = { status: 402, body: { error: { code: 'shared_trial_exhausted', message: 'server wording' } } };
  expect(await run('--yes', '--no-wire')).toBe(1);
  expect(failure().code).toBe('shared_trial_exhausted');
  expect(failure().error).toContain('already used its trial');
  world.responses['/api/v1/onboarding'] = { status: 500, body: { error: { code: 'weird_failure', message: 'private internal detail' } } };
  expect(await run('--yes', '--no-wire')).toBe(1);
  expect(failure().code).toBe('onboarding_not_ready');
  expect(everything()).not.toContain('private internal detail');
});

test('a server without this feature says so plainly', async () => {
  world.responses['/api/v1/phone-logins'] = { status: 404, body: {} };
  expect(await run('--yes')).toBe(1);
  expect(failure().code).toBe('onboarding_unavailable');
  expect(world.sent).toEqual([]);
});

test('reports the queue position while waiting for a busy line', async () => {
  world.session = { status: 'ready' };
  let polls = 0;
  const wrapped = deps(), fetcher = wrapped.fetch;
  wrapped.fetch = (async (input: URL, init: RequestInit) => {
    const path = new URL(input).pathname;
    if (path.endsWith('/demo')) return Response.json({ data: { id: SESSION, status: 'ready', line: { id: PROJECT, receiving_number: LINE }, demo_queue: { state: 'waiting', position: 2 } } });
    if (path === `/api/v1/onboarding/${SESSION}`) {
      polls++;
      return Response.json({ data: { id: SESSION, line: { id: PROJECT, receiving_number: LINE }, ...(polls === 1 ? { status: 'ready', demo_queue: { state: 'waiting', position: 1 } } : { status: 'demo_running', demo_call_id: CALL }) } });
    }
    return fetcher(input, init);
  }) as unknown as typeof fetch;
  expect(await runOnboard(['--json', '--yes', '--no-wire'], wrapped)).toBe(0);
  expect(records().filter(r => r.code === 'demo_queued').map(r => r.position)).toEqual([2, 1]);
  expect(records().map(r => r.code)).toContain('demo_requested');
});

test('a queue wait that ended is not reported as a call', async () => {
  world.session = { status: 'ready' };
  world.responses[`/api/v1/onboarding/${SESSION}/demo`] = { status: 200, body: { data: { id: SESSION, status: 'ready', line: { id: PROJECT, receiving_number: LINE }, demo_queue: { state: 'expired', position: null } } } };
  expect(await run('--yes', '--no-wire')).toBe(1);
  expect(failure()).toMatchObject({ code: 'demo_not_started', queue_state: 'expired' });
});

test('detects projects by manifest and picks the install command', () => {
  const dir = join(root, 'detect');
  const inProject = (...files: string[]) => {
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir);
    for (const file of files) writeFileSync(join(dir, file), '');
    return detectProject(dir);
  };
  expect(inProject()).toBeNull();
  expect(inProject('notes.txt')).toBeNull();
  expect(inProject('package.json')).toEqual({ stack: 'javascript', install_command: 'npm install @trychert/sdk' });
  expect(inProject('package.json', 'bun.lock')!.install_command).toBe('bun add @trychert/sdk');
  expect(inProject('package.json', 'pnpm-lock.yaml')!.install_command).toBe('pnpm add @trychert/sdk');
  expect(inProject('pyproject.toml', 'uv.lock')!.install_command).toBe('uv add chert-sdk');
  expect(inProject('requirements.txt')!.install_command).toBe('python -m pip install chert-sdk');
  for (const [file, stack] of [['Cargo.toml', 'rust'], ['go.mod', 'go'], ['App.csproj', 'dotnet'], ['CMakeLists.txt', 'cpp']] as const) {
    expect(inProject(file)).toMatchObject({ stack, install_command: null });
  }
  expect(inProject('.git')).toMatchObject({ stack: 'unknown', install_command: null });
});

test('a project gets a handoff and an ignored .env.local, with its other lines kept', async () => {
  writeFileSync(join(world.cwd, 'package.json'), '{}');
  writeFileSync(join(world.cwd, '.env.local'), 'OTHER=keep\n');
  expect(await run('--yes')).toBe(0);
  const wire = records().find(r => r.code === 'wire_in')!;
  expect(wire).toMatchObject({ stack: 'javascript', install_command: 'npm install @trychert/sdk', env_vars: ['CHERT_FACETIME_TOKEN', 'CHERT_PROJECT_ID'], env_local_written: true });
  expect(wire.prompt).toContain('npm install @trychert/sdk');
  expect(JSON.stringify(wire)).not.toContain(TOKEN);
  expect(readFileSync(join(world.cwd, '.env.local'), 'utf8')).toBe(`OTHER=keep\nCHERT_FACETIME_TOKEN=${TOKEN}\nCHERT_PROJECT_ID=${PROJECT}\n`);
  expect(statSync(join(world.cwd, '.env.local')).mode & 0o777).toBe(0o600);
  expect(readFileSync(join(world.cwd, 'package.json'), 'utf8')).toBe('{}');
  expect(world.installs).toEqual([]);
});

test('a project whose .env.local git does not ignore gets no credential on disk', async () => {
  writeFileSync(join(world.cwd, 'package.json'), '{}');
  world.ignored = false;
  expect(await run('--yes')).toBe(0);
  expect(records().find(r => r.code === 'wire_in')).toMatchObject({ env_local_written: false });
  expect(existsSync(join(world.cwd, '.env.local'))).toBe(false);
});

test('an existing different value or symlinked .env.local is left alone', async () => {
  writeFileSync(join(world.cwd, 'package.json'), '{}');
  writeFileSync(join(world.cwd, '.env.local'), 'CHERT_PROJECT_ID=someone-elses\n');
  expect(await run('--yes')).toBe(0);
  expect(records().find(r => r.code === 'wire_in')).toMatchObject({ env_local_written: false });
  expect(readFileSync(join(world.cwd, '.env.local'), 'utf8')).toBe('CHERT_PROJECT_ID=someone-elses\n');
  rmSync(join(world.cwd, '.env.local'));
  const elsewhere = join(root, 'elsewhere');
  writeFileSync(elsewhere, 'X=1\n');
  symlinkSync(elsewhere, join(world.cwd, '.env.local'));
  world.out = [];
  expect(await run('--yes')).toBe(0);
  expect(records().find(r => r.code === 'wire_in')).toMatchObject({ env_local_written: false });
  expect(readFileSync(elsewhere, 'utf8')).toBe('X=1\n');
});

test('no project with the CLI present reports it ready', async () => {
  expect(await run('--yes')).toBe(0);
  expect(records().at(-1)).toMatchObject({ code: 'personal_agent_ready', next_commands: ['chert doctor', 'chert dev'] });
  expect(world.installs).toEqual([]);
});

test('no project installs the published CLI only with consent', async () => {
  world.chertInstalled = false;
  expect(await run('--numbers', '1')).toBe(0);
  expect(records().at(-1)).toMatchObject({ code: 'personal_agent_cli_install_required', install_command: 'npm install -g @trychert/facetime@beta' });
  expect(world.installs).toEqual([]);
  world.out = [];
  expect(await run('--yes')).toBe(0);
  expect(world.installs).toEqual([['install', '-g', '@trychert/facetime@beta']]);
  expect(records().at(-1)!.code).toBe('personal_agent_ready');
});

test('an unavailable CLI is reported as such and is not success', async () => {
  world.chertInstalled = false;
  world.npmPublished = false;
  expect(await run('--yes')).toBe(1);
  expect(records().at(-1)!.code).toBe('personal_agent_cli_unavailable');
  expect(world.installs).toEqual([]);
});

test('--no-wire skips the directory step', async () => {
  writeFileSync(join(world.cwd, 'package.json'), '{}');
  expect(await run('--yes', '--no-wire')).toBe(0);
  expect(records().map(r => r.code)).not.toContain('wire_in');
  expect(existsSync(join(world.cwd, '.env.local'))).toBe(false);
});

test('the origin can be overridden only by a plain https address', async () => {
  const unsafe = deps();
  unsafe.env = { CHERT_FACETIME_URL: 'http://example.test' };
  expect(await runOnboard(['--json', '--yes'], unsafe)).toBe(1);
  expect(failure().code).toBe('invalid_origin');
  expect(world.sent).toEqual([]);
});

function readdirNames(dir: string): string[] {
  return existsSync(dir) ? Array.from(new Bun.Glob('*').scanSync({ cwd: dir, dot: true })) : [];
}
