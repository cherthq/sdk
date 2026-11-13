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
  execFail: Record<string, { stderr?: string }>; proven?: boolean; prompts: string[]; answers: string[]; ignored: boolean; chertInstalled: boolean; npmPublished: boolean; installs: string[][];
  verified: string[]; unlinked: string[]; finishOnly: boolean; tokenPolls: number; session: Record<string, unknown>; responses: Record<string, { status: number; body: unknown }>;
  platform: string; interactive: boolean; now: number; verificationSent: boolean;
}
let world: World;
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'chert-onboard-'));
  mkdirSync(join(root, 'home'));
  mkdirSync(join(root, 'cwd'));
  world = { aliases: [A], home: join(root, 'home'), cwd: join(root, 'cwd'), out: [], err: [], sent: [], calls: [], execFail: {}, prompts: [], answers: [], ignored: true, chertInstalled: true, npmPublished: true, installs: [],
    verified: [A], unlinked: [], finishOnly: false, tokenPolls: 0, session: { status: 'awaiting_verification' }, responses: {}, platform: 'darwin', interactive: false, now: 1_000_000, verificationSent: false };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function deps(): OnboardDeps {
  return {
    async exec(file, args) {
      const fail = world.execFail[file];
      if (fail) throw Object.assign(new Error('failed'), fail);
      if (file === 'plutil') return { stdout: JSON.stringify({ allAliases: world.aliases, selectedAliases: [] }) };
      if (file === 'osascript') {
        world.sent.push(args);
        if (args.at(-2) === CODE) world.verificationSent = true;
        return { stdout: '' };
      }
      if (file === 'git') { if (!world.ignored) throw new Error('not ignored'); return { stdout: '' }; }
      if (file === 'chert') { if (!world.chertInstalled) throw new Error('missing'); return { stdout: '1' }; }
      if (file === 'npm') {
        if (args[0] === 'view') { if (!world.npmPublished) throw new Error('missing'); return { stdout: '1' }; }
        world.installs.push(args); return { stdout: '' };
      }
      throw new Error(`unexpected ${file}`);
    },
    async nativeSend({ from, to, text }) {
      if (world.execFail.osascript) throw new Error('send failed');
      world.sent.push([from, text, to]);
      if (text === CODE) world.verificationSent = true;
      return { from, to, acknowledged: true };
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
  if (path.endsWith('/verify')) { world.verificationSent = false; world.session = { status: world.proven ? 'ready' : 'awaiting_verification', recipient: body.recipient }; return world.proven ? { code: null, verified: true } : { code: CODE, recipient: body.recipient }; }
  if (path.endsWith('/demo')) { world.session = { ...world.session, status: 'demo_running', demo_call_id: CALL }; return view(); }
  if (method === 'GET') {
    if (world.verificationSent && world.session.status === 'awaiting_verification') world.session = { ...world.session, status: 'ready' };
    return view();
  }
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

test('reports no numbers or an unavailable Messages identity', async () => {
  world.aliases = ['person@example.com'];
  expect(await run('--yes')).toBe(1);
  expect(failure().code).toBe('no_phone_numbers');
  world.execFail.plutil = {};
  expect(await run('--yes')).toBe(1);
  expect(failure().code).toBe('messages_identity_unavailable');
  expect(world.calls).toEqual([]);
});

test('no detected aliases never accepts a supplied number or prompts for one', async () => {
  world.aliases = [];
  world.interactive = true;
  world.answers = [FOREIGN];
  for (const args of [[], ['--numbers', FOREIGN], ['--numbers', '1']]) {
    expect(await run(...args)).toBe(1);
    expect(failure().code).toBe('no_phone_numbers');
  }
  expect(world.prompts).toEqual([]);
  expect(world.calls).toEqual([]);
  expect(world.sent).toEqual([]);
});

test('a machine caller without a choice gets masked numbers and nothing is sent', async () => {
  world.aliases = [A, B];
  expect(await run()).toBe(1);
  expect(failure()).toMatchObject({ code: 'numbers_required', numbers: [{ index: 1, number: '•••0100' }, { index: 2, number: '•••0199' }] });
  expect(world.calls).toEqual([]);
  expect(world.sent).toEqual([]);
  expect(everything()).not.toContain(A);
});

test('a terminal without json still stops at a choice of numbers without a real terminal', async () => {
  world.aliases = [A, B];
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

test('the concierge asks which number and sends straight away', async () => {
  world.aliases = [A, B];
  world.interactive = true;
  world.answers = ['2'];
  expect(await runOnboard(['--skip-demo', '--no-wire'], deps())).toBe(1);
  expect(world.out.join('\n')).toContain(B);
  expect(world.prompts.length).toBe(1);
  const login = world.calls.find(call => call.path === '/api/v1/phone-logins')!;
  expect(login.body).toEqual({ device_name: 'Test Mac', numbers: [B] });
});

test('choosing all sends one code per number', async () => {
  world.aliases = [A, B];
  world.interactive = true;
  world.answers = ['all'];
  world.verified = [A, B];
  expect(await runOnboard(['--no-wire'], deps())).toBe(0);
  expect(world.sent.slice(0, 2)).toEqual([[A, message(A), LINE], [B, message(B), LINE]]);
});

test('passes the selected sender and metacharacters as native data', async () => {
  const hostile = 'x" & (do shell script "id") & "`$(id)`;\'';
  world.responses['/api/v1/phone-logins'] = { status: 200, body: { data: { device_code: DEVICE, receiving_number: LINE, expires_in: 600, interval: 2, challenges: [{ number: A, message: hostile }] } } };
  expect(await run('--yes', '--no-wire', '--skip-demo')).toBe(0);
  const args = world.sent[0]!;
  expect(args.at(-2)).toBe(hostile);
  expect(args.at(-1)).toBe(LINE);
  expect(args[0]).toBe(A);
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

test('native sender is required and a mismatched acknowledgement is refused', async () => {
  const unavailable = deps();
  delete unavailable.nativeSend;
  expect(await runOnboard(['--json', '--yes', '--no-wire'], unavailable)).toBe(1);
  expect(failure().code).toBe('native_sender_unavailable');
  expect(world.sent).toEqual([]);
  for (const receipt of [
    { from: B, to: LINE, acknowledged: true },
    { from: A, to: B, acknowledged: true },
    { from: A, to: LINE, acknowledged: false },
  ]) {
    const mismatch = deps();
    mismatch.nativeSend = async () => receipt;
    expect(await runOnboard(['--json', '--yes', '--no-wire'], mismatch)).toBe(1);
    expect(failure().code).toBe('messages_send_failed');
    expect(world.calls.some(call => call.path.endsWith('/demo'))).toBe(false);
  }
});

test('native send failure leaves no sign-in behind', async () => {
  world.execFail.osascript = { stderr: 'not authorized' };
  expect(await run('--yes')).toBe(1);
  expect(failure().code).toBe('messages_send_failed');
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
  expect(records().map(r => r.code)).toEqual(['numbers_detected', 'login_code_sent', 'signed_in', 'trial_status', 'verification_code_sent', 'demo_requested']);
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
  expect(records().find(r => r.code === 'trial_status')!.message).toContain('Trial allowance details were retrieved');
});

test('reports an unavailable allowance check without stopping verification or the demo', async () => {
  world.responses['/api/v1/allowance'] = { status: 503, body: { error: { code: 'unavailable' } } };
  expect(await run('--yes', '--no-wire')).toBe(0);
  expect(records().find(r => r.code === 'trial_status')).toMatchObject({
    allowance: {}, message: 'Shared access is set up, but your trial allowance could not be checked.',
  });
  expect(records().some(r => r.code === 'demo_requested')).toBe(true);
});

test('reports a network failure checking allowance and continues', async () => {
  const options = deps();
  const fetch = options.fetch;
  options.fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (new URL(String(input)).pathname === '/api/v1/allowance') throw new Error('offline');
    return fetch(input, init);
  }, { preconnect: fetch.preconnect });
  expect(await runOnboard(['--json', '--yes', '--no-wire'], options)).toBe(0);
  expect(records().find(r => r.code === 'trial_status')?.message).toContain('allowance could not be checked');
  expect(records().some(r => r.code === 'demo_requested')).toBe(true);
});

test('a second verification challenge is sent automatically without displaying it', async () => {
  expect(await run('--yes', '--no-wire')).toBe(0);
  expect(world.sent.map(args => args.slice(-2))).toEqual([[message(A), LINE], [CODE, LINE]]);
  expect(records().some(r => r.code === 'verification_code_sent')).toBe(true);
  expect(everything()).not.toContain(CODE);
  expect(world.calls.findIndex(call => call.path === `/api/v1/onboarding/${SESSION}` && call.method === 'GET')).toBeLessThan(world.calls.findIndex(call => call.path.endsWith('/demo')));
});

test('sending a verification code does not start a demo without server confirmation', async () => {
  world.responses[`/api/v1/onboarding/${SESSION}`] = { status: 200, body: { data: { id: SESSION, status: 'awaiting_verification', recipient: A, line: { receiving_number: LINE } } } };
  expect(await run('--yes', '--no-wire')).toBe(1);
  expect(world.sent.map(args => args.slice(-2))).toEqual([[message(A), LINE], [CODE, LINE]]);
  expect(failure().code).toBe('verification_timeout');
  expect(world.calls.some(call => call.path === `/api/v1/onboarding/${SESSION}` && call.method === 'GET')).toBe(true);
  expect(world.calls.some(call => call.path.endsWith('/demo'))).toBe(false);
});

test('a failed second send reports the Messages error and never starts the demo', async () => {
  const options = deps(), send = options.nativeSend!;
  options.nativeSend = async message => {
    if (message.text === CODE) throw new Error('send failed');
    return send(message);
  };
  expect(await runOnboard(['--json', '--yes', '--no-wire'], options)).toBe(1);
  expect(failure().code).toBe('messages_send_failed');
  expect(world.calls.some(call => call.path.endsWith('/demo'))).toBe(false);
  expect(records().some(r => r.code === 'verification_code_sent')).toBe(false);
});

test('a saved sign-in does not verify a newly selected number', async () => {
  world.proven = true;
  expect(await run('--yes', '--no-wire')).toBe(0);
  world.aliases = [B];
  world.calls = [];
  world.out = [];
  expect(await run('--yes', '--no-wire')).toBe(1);
  expect(failure().code).toBe('recipient_proof_required');
  expect(world.calls.some(call => call.path.endsWith('/demo'))).toBe(false);
  expect(records().some(r => r.code === 'demo_requested' && r.number === '•••0199')).toBe(false);
});

test('a pending project-scoped verification cannot be reused for another number', async () => {
  expect(await run('--yes', '--no-wire')).toBe(0);
  world.session = { status: 'awaiting_verification' };
  world.aliases = [B];
  world.calls = [];
  expect(await run('--yes', '--no-wire')).toBe(1);
  expect(failure().code).toBe('recipient_proof_required');
  expect(world.calls.some(call => call.path.endsWith('/verify') || call.path.endsWith('/demo'))).toBe(false);
});

test('never prints credentials, login secrets, or verification codes', async () => {
  mkdirSync(join(world.cwd, '.git'));
  expect(await run('--yes')).toBe(0);
  const text = everything();
  for (const secret of [TOKEN, DEVICE, message(A), CODE]) expect(text).not.toContain(secret);
  expect(records().some(r => r.code === 'verification_code_sent')).toBe(true);
});

test('saves the sign-in in the format and place the chert CLI reads', async () => {
  expect(await run('--yes', '--no-wire', '--skip-demo')).toBe(0);
  const saved = JSON.parse(readFileSync(credentials(), 'utf8'));
  expect(saved).toEqual({ access_token: TOKEN, expires_at: 1_000_000 + 86400_000, kind: 'cli', project_id: PROJECT, device_name: 'Test Mac', origin: 'https://facetime.trychert.com' });
  expect(statSync(credentials()).mode & 0o777).toBe(0o600);
  expect(statSync(join(world.home, '.chert')).mode & 0o777).toBe(0o700);
  const resumeFile = join(world.home, '.chert', 'onboarding', `${createHash('sha256').update(JSON.stringify(['https://facetime.trychert.com', PROJECT])).digest('hex')}.json`);
  expect(JSON.parse(readFileSync(resumeFile, 'utf8'))).toEqual({ request_key: expect.any(String), binding: expect.any(String), session_id: SESSION });
});

test('a number Messages did not send from is reported, not claimed', async () => {
  world.aliases = [A, B];
  world.finishOnly = true;
  expect(await run('--yes', '--no-wire')).toBe(0);
  const signedIn = records().find(r => r.code === 'signed_in')!;
  expect(signedIn).toMatchObject({ verified: ['•••0100'], unverified: ['•••0199'] });
  expect(signedIn.message).toContain('Start New Conversations From');
  expect(signedIn.message).toContain('Contact Chert support');
  expect(signedIn.message).not.toContain('run this again to add');
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
  expect(records().find(r => r.code === 'demo_requested')!.message).not.toContain('first one verified');
});

test('the demo never calls a number that belongs to another account', async () => {
  world.aliases = [A, B];
  world.verified = [A, B];
  world.unlinked = [A];
  expect(await run('--yes', '--no-wire')).toBe(0);
  expect(records().find(r => r.code === 'demo_requested')).toMatchObject({ number: '•••0199' });
});

test('a saved sign-in resumes the linked second number when both remain selected', async () => {
  world.aliases = [A, B];
  world.verified = [B];
  expect(await run('--yes', '--no-wire')).toBe(0);
  world.calls = []; world.out = [];
  expect(await run('--yes', '--no-wire')).toBe(0);
  expect(records().find(r => r.code === 'demo_requested')).toMatchObject({ number: '•••0199' });
  expect(world.calls.some(call => call.path.endsWith('/verify') || call.path.endsWith('/demo'))).toBe(false);
  world.aliases = [A]; world.calls = [];
  expect(await run('--yes', '--no-wire')).toBe(1);
  expect(failure().code).toBe('recipient_proof_required');
  expect(world.calls.some(call => call.path.endsWith('/verify') || call.path.endsWith('/demo'))).toBe(false);
});

test('a pending session resumes the linked second number before the server has a recipient', async () => {
  world.aliases = [A, B]; world.verified = [B];
  world.responses[`/api/v1/onboarding/${SESSION}/verify`] = { status: 500, body: {} };
  expect(await run('--yes', '--no-wire')).toBe(1);
  delete world.responses[`/api/v1/onboarding/${SESSION}/verify`];
  world.calls = [];
  expect(await run('--yes', '--no-wire')).toBe(0);
  expect(world.calls.find(call => call.path.endsWith('/verify'))?.body).toEqual({ recipient: B });
});

test('a demo that cannot start still wires the project and reports the failure', async () => {
  writeFileSync(join(world.cwd, 'package.json'), '{}');
  world.responses[`/api/v1/onboarding/${SESSION}/demo`] = { status: 409, body: { error: { code: 'outbound_unavailable', message: 'server wording' } } };
  expect(await run('--yes')).toBe(1);
  expect(records().some(r => r.code === 'wire_in')).toBe(true);
  expect(world.err.join('\n')).toContain('outbound_unavailable');
});

test('two linked numbers say which one is called', async () => {
  world.aliases = [A, B];
  world.verified = [A, B];
  expect(await run('--yes', '--no-wire')).toBe(0);
  expect(records().find(r => r.code === 'demo_requested')!.message).toContain('Chert is calling •••0100');
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

test('a rerun fails closed when the session cannot prove its recipient', async () => {
  expect(await run('--yes', '--no-wire')).toBe(0);
  delete world.session.recipient;
  const sent = world.sent.length;
  world.out = [];
  world.calls = [];
  expect(await run('--yes', '--no-wire')).toBe(1);
  expect(world.sent.length).toBe(sent);
  expect(world.calls.some(call => call.path === '/api/v1/phone-logins')).toBe(false);
  expect(world.calls.some(call => call.path === '/api/v1/onboarding')).toBe(false);
  expect(world.calls.some(call => call.path === `/api/v1/onboarding/${SESSION}` && call.method === 'GET')).toBe(true);
  expect(failure().code).toBe('recipient_proof_required');
  expect(records().map(r => r.code)).not.toContain('demo_requested');
});

test('a rerun resumes a session that confirms the selected recipient', async () => {
  expect(await run('--yes', '--no-wire')).toBe(0);
  world.calls = []; world.out = [];
  expect(await run('--yes', '--no-wire')).toBe(0);
  expect(world.calls.some(call => call.path.endsWith('/verify') || call.path.endsWith('/demo'))).toBe(false);
  expect(records().some(r => r.code === 'demo_requested')).toBe(true);
});

test('a pending session bound by the server to another recipient is refused', async () => {
  world.responses[`/api/v1/onboarding/${SESSION}/verify`] = { status: 500, body: {} };
  expect(await run('--yes', '--no-wire')).toBe(1);
  world.session = { status: 'awaiting_verification', recipient: B };
  world.calls = [];
  expect(await run('--yes', '--no-wire')).toBe(1);
  expect(failure().code).toBe('recipient_proof_required');
  expect(world.calls.some(call => call.path.endsWith('/verify') || call.path.endsWith('/demo'))).toBe(false);
});

test('a pending session resumes only with the same sign-in and recipient', async () => {
  world.responses[`/api/v1/onboarding/${SESSION}/verify`] = { status: 500, body: {} };
  expect(await run('--yes', '--no-wire')).toBe(1);
  delete world.responses[`/api/v1/onboarding/${SESSION}/verify`];
  world.calls = [];
  expect(await run('--yes', '--no-wire')).toBe(0);
  expect(world.calls.some(call => call.path === '/api/v1/onboarding')).toBe(false);
  expect(world.calls.find(call => call.path.endsWith('/verify'))?.body).toEqual({ recipient: A });
});

test('an expired verification starts one new challenge for the same recipient', async () => {
  world.responses[`/api/v1/onboarding/${SESSION}/verify`] = { status: 409, body: { error: { code: 'verification_expired' } } };
  const wrapped = deps(), fetcher = wrapped.fetch;
  wrapped.fetch = (async (input: URL, init: RequestInit) => {
    const response = await fetcher(input, init);
    if (new URL(input).pathname.endsWith('/verify')) delete world.responses[`/api/v1/onboarding/${SESSION}/verify`];
    return response;
  }) as unknown as typeof fetch;
  expect(await runOnboard(['--json', '--yes', '--no-wire'], wrapped)).toBe(0);
  const requests = world.calls.filter(call => call.path.endsWith('/verify'));
  expect(requests).toHaveLength(2);
  expect(requests.map(call => call.body)).toEqual([{ recipient: A }, { recipient: A }]);
  expect(requests[0]!.headers.get('idempotency-key')).not.toBe(requests[1]!.headers.get('idempotency-key'));
});

test('a lost replacement response resumes with the same persisted challenge key', async () => {
  world.responses[`/api/v1/onboarding/${SESSION}/verify`] = { status: 409, body: { error: { code: 'verification_expired' } } };
  const wrapped = deps(), fetcher = wrapped.fetch;
  let requests = 0;
  wrapped.fetch = (async (input: URL, init: RequestInit) => {
    const response = await fetcher(input, init);
    if (new URL(input).pathname.endsWith('/verify')) {
      if (++requests === 1) delete world.responses[`/api/v1/onboarding/${SESSION}/verify`];
      else { world.session = { status: 'awaiting_verification', recipient: A }; throw new Error('response lost'); }
    }
    return response;
  }) as unknown as typeof fetch;
  expect(await runOnboard(['--json', '--yes', '--no-wire'], wrapped)).toBe(1);
  expect(failure().code).toBe('backend_unreachable');
  const previous = world.calls.filter(call => call.path.endsWith('/verify')).at(-1)!.headers.get('idempotency-key');
  world.calls = [];
  expect(await run('--yes', '--no-wire')).toBe(0);
  expect(world.calls.find(call => call.path.endsWith('/verify'))!.headers.get('idempotency-key')).toBe(previous);
});

test('repeated expired responses stop after one replacement per run', async () => {
  world.responses[`/api/v1/onboarding/${SESSION}/verify`] = { status: 409, body: { error: { code: 'verification_expired' } } };
  expect(await run('--yes', '--no-wire')).toBe(1);
  expect(failure().code).toBe('verification_expired');
  expect(world.calls.filter(call => call.path.endsWith('/verify'))).toHaveLength(2);
  world.calls = [];
  expect(await run('--yes', '--no-wire')).toBe(1);
  expect(world.calls.filter(call => call.path.endsWith('/verify'))).toHaveLength(2);
});

test('already verified after a pending read polls for confirmation without replacing the challenge', async () => {
  world.responses[`/api/v1/onboarding/${SESSION}/verify`] = { status: 500, body: {} };
  expect(await run('--yes', '--no-wire')).toBe(1);
  world.responses[`/api/v1/onboarding/${SESSION}/verify`] = { status: 409, body: { error: { code: 'verification_already_verified' } } };
  world.calls = []; world.out = [];
  const wrapped = deps(), fetcher = wrapped.fetch;
  let polls = 0;
  wrapped.fetch = (async (input: URL, init: RequestInit) => {
    const path = new URL(input).pathname;
    if (path === `/api/v1/onboarding/${SESSION}`) {
      polls++;
      world.session = polls === 1 ? { status: 'awaiting_verification', recipient: A } : polls === 2 ? { status: 'awaiting_verification', recipient: A, verification_received: true } : { status: 'ready', recipient: A };
    }
    return fetcher(input, init);
  }) as unknown as typeof fetch;
  expect(await runOnboard(['--json', '--yes', '--no-wire'], wrapped)).toBe(0);
  expect(polls).toBe(3);
  expect(world.calls.filter(call => call.path.endsWith('/verify'))).toHaveLength(1);
  expect(records().some(record => record.code === 'verification_code_sent')).toBe(false);
  expect(records().some(record => record.code === 'demo_requested')).toBe(true);
});

test('already verified never reports success without confirmation or for another recipient', async () => {
  world.responses[`/api/v1/onboarding/${SESSION}/verify`] = { status: 409, body: { error: { code: 'verification_already_verified' } } };
  const wrapped = deps(), fetcher = wrapped.fetch;
  wrapped.fetch = (async (input: URL, init: RequestInit) => {
    if (new URL(input).pathname.endsWith('/verify')) world.session = { status: 'awaiting_verification', recipient: A, verification_received: true };
    return fetcher(input, init);
  }) as unknown as typeof fetch;
  wrapped.sleep = async () => { world.now += 600_000; };
  expect(await runOnboard(['--json', '--yes', '--no-wire'], wrapped)).toBe(1);
  expect(failure().code).toBe('verification_timeout');
  expect(world.calls.some(call => call.path.endsWith('/demo'))).toBe(false);
  world.session = { status: 'awaiting_verification' }; world.calls = []; world.out = [];
  const mismatch = deps(), baseFetch = mismatch.fetch;
  mismatch.fetch = (async (input: URL, init: RequestInit) => {
    if (new URL(input).pathname.endsWith('/verify')) world.session = { status: 'ready', recipient: B };
    return baseFetch(input, init);
  }) as unknown as typeof fetch;
  expect(await runOnboard(['--json', '--yes', '--no-wire'], mismatch)).toBe(1);
  expect(failure().code).toBe('recipient_proof_required');
  expect(world.calls.some(call => call.path.endsWith('/demo'))).toBe(false);
});

test('a consumed verification waits for confirmation without reissuing the challenge', async () => {
  world.responses[`/api/v1/onboarding/${SESSION}/verify`] = { status: 500, body: {} };
  expect(await run('--yes', '--no-wire')).toBe(1);
  world.session = { status: 'awaiting_verification', recipient: A, verification_received: true };
  world.calls = []; world.out = [];
  const wrapped = deps(), fetcher = wrapped.fetch;
  let polls = 0;
  wrapped.fetch = (async (input: URL, init: RequestInit) => {
    if (new URL(input).pathname === `/api/v1/onboarding/${SESSION}` && ++polls === 2)
      world.session = { status: 'ready', recipient: A };
    return fetcher(input, init);
  }) as unknown as typeof fetch;
  expect(await runOnboard(['--json', '--yes', '--no-wire'], wrapped)).toBe(0);
  expect(polls).toBe(2);
  expect(world.calls.some(call => call.path.endsWith('/verify'))).toBe(false);
  expect(records().some(record => record.code === 'verification_code_sent')).toBe(false);
  expect(records().some(record => record.code === 'demo_requested')).toBe(true);
});

test('a consumed verification without a matching recipient never polls or reissues', async () => {
  world.responses[`/api/v1/onboarding/${SESSION}/verify`] = { status: 500, body: {} };
  expect(await run('--yes', '--no-wire')).toBe(1);
  for (const recipient of [undefined, B]) {
    world.session = { status: 'awaiting_verification', verification_received: true, ...(recipient ? { recipient } : {}) };
    world.calls = [];
    expect(await run('--yes', '--no-wire')).toBe(1);
    expect(failure().code).toBe('recipient_proof_required');
    expect(world.calls.filter(call => call.path === `/api/v1/onboarding/${SESSION}`)).toHaveLength(1);
    expect(world.calls.some(call => call.path.endsWith('/verify') || call.path.endsWith('/demo'))).toBe(false);
  }
});

test('a rotated credential resumes only after the server confirms its session and recipient', async () => {
  expect(await run('--yes', '--no-wire')).toBe(0);
  const saved = JSON.parse(readFileSync(credentials(), 'utf8'));
  writeFileSync(credentials(), JSON.stringify({ ...saved, access_token: `ftu_${'x'.repeat(43)}` }));
  world.calls = []; world.out = [];
  expect(await run('--yes', '--no-wire')).toBe(0);
  expect(world.calls[0]!.path).toBe(`/api/v1/onboarding/${SESSION}`);
  expect(world.calls[0]!.headers.get('authorization')).toBe(`Bearer ftu_${'x'.repeat(43)}`);
  expect(records().some(record => record.code === 'demo_requested')).toBe(true);
  world.calls = [];
  expect(await run('--yes', '--no-wire')).toBe(0);
  expect(world.calls.filter(call => call.path === `/api/v1/onboarding/${SESSION}`)).toHaveLength(1);
});

test('an expired sign-in during recipient lookup is removed and can sign in again', async () => {
  expect(await run('--yes', '--no-wire')).toBe(0);
  const saved = JSON.parse(readFileSync(credentials(), 'utf8'));
  const stale = `ftu_${'x'.repeat(43)}`;
  writeFileSync(credentials(), JSON.stringify({ ...saved, access_token: stale }));
  world.calls = []; world.out = []; world.err = [];
  world.responses[`/api/v1/onboarding/${SESSION}`] = { status: 401, body: {} };
  expect(await run('--yes', '--no-wire')).toBe(1);
  expect(failure().code).toBe('login_required');
  expect(existsSync(credentials())).toBe(false);
  expect(world.calls.map(call => call.path)).toEqual([`/api/v1/onboarding/${SESSION}`]);
  delete world.responses[`/api/v1/onboarding/${SESSION}`];
  world.calls = [];
  expect(await run('--yes', '--no-wire')).toBe(0);
  expect(world.calls.some(call => call.path === '/api/v1/phone-logins')).toBe(true);
  expect(JSON.parse(readFileSync(credentials(), 'utf8')).access_token).toBe(TOKEN);
  expect(everything()).not.toContain(stale);
  expect(everything()).not.toContain(TOKEN);
});

test('a changed credential without server recipient proof fails closed', async () => {
  world.responses[`/api/v1/onboarding/${SESSION}/verify`] = { status: 500, body: {} };
  expect(await run('--yes', '--no-wire')).toBe(1);
  const saved = JSON.parse(readFileSync(credentials(), 'utf8'));
  writeFileSync(credentials(), JSON.stringify({ ...saved, access_token: `ftu_${'x'.repeat(43)}` }));
  world.calls = [];
  expect(await run('--yes', '--no-wire')).toBe(1);
  expect(failure().code).toBe('recipient_proof_required');
  expect(world.calls.filter(call => call.path.endsWith('/verify') || call.path.endsWith('/demo'))).toEqual([]);
});

test('a rotated credential sets aside an unknown session and never accepts old proof', async () => {
  expect(await run('--yes', '--no-wire')).toBe(0);
  const file = join(world.home, '.chert', 'onboarding', `${createHash('sha256').update(JSON.stringify(['https://facetime.trychert.com', PROJECT])).digest('hex')}.json`);
  const previous = JSON.parse(readFileSync(file, 'utf8'));
  delete previous.session_id;
  writeFileSync(file, JSON.stringify(previous));
  const saved = JSON.parse(readFileSync(credentials(), 'utf8'));
  writeFileSync(credentials(), JSON.stringify({ ...saved, access_token: `ftu_${'x'.repeat(43)}` }));
  world.responses['/api/v1/onboarding'] = { status: 200, body: { data: { id: CALL, status: 'ready', recipient: A, line: { receiving_number: LINE } } } };
  world.calls = []; world.out = [];
  expect(await run('--yes', '--no-wire')).toBe(1);
  expect(failure().code).toBe('recipient_proof_required');
  expect(records().some(record => record.code === 'onboarding_restarted')).toBe(true);
  expect(world.calls.find(call => call.path === '/api/v1/onboarding')!.headers.get('idempotency-key')).not.toBe(previous.request_key);
  expect(world.calls.some(call => call.path.endsWith('/demo'))).toBe(false);
});

test('stale session lookup after token rotation starts distinct fresh verification', async () => {
  expect(await run('--yes', '--no-wire')).toBe(0);
  const saved = JSON.parse(readFileSync(credentials(), 'utf8'));
  writeFileSync(credentials(), JSON.stringify({ ...saved, access_token: `ftu_${'x'.repeat(43)}` }));
  world.responses[`/api/v1/onboarding/${SESSION}`] = { status: 409, body: { error: { code: 'verification_stale' } } };
  world.responses['/api/v1/onboarding'] = { status: 200, body: { data: { id: CALL, status: 'ready', recipient: A, line: { receiving_number: LINE } } } };
  world.calls = []; world.out = [];
  expect(await run('--yes', '--no-wire')).toBe(1);
  expect(failure().code).toBe('recipient_proof_required');
  expect(world.calls.some(call => call.path === '/api/v1/onboarding')).toBe(true);
  expect(world.calls.some(call => call.path.endsWith('/demo'))).toBe(false);
});

test('fresh sign-in reconciles prior state using only linked verified candidates', async () => {
  expect(await run('--yes', '--no-wire')).toBe(0);
  const file = join(world.home, '.chert', 'onboarding', `${createHash('sha256').update(JSON.stringify(['https://facetime.trychert.com', PROJECT])).digest('hex')}.json`);
  const resume = JSON.parse(readFileSync(file, 'utf8'));
  delete resume.session_id;
  writeFileSync(file, JSON.stringify(resume));
  rmSync(credentials());
  world.aliases = [A, B]; world.verified = [B]; world.calls = []; world.out = [];
  world.responses['/api/v1/phone-logins/token'] = { status: 200, body: { data: { status: 'approved', access_token: `ftu_${'x'.repeat(43)}`, project_id: PROJECT, verified_numbers: [B], expires_in: 86400 } } };
  world.responses['/api/v1/onboarding'] = { status: 200, body: { data: { id: CALL, status: 'awaiting_verification', line: { receiving_number: LINE } } } };
  const wrapped = deps(), fetcher = wrapped.fetch;
  wrapped.fetch = (async (input: URL, init: RequestInit) => {
    const response = await fetcher(input, init);
    if (new URL(input).pathname === `/api/v1/onboarding/${CALL}`)
      return Response.json({ data: { id: CALL, line: { receiving_number: LINE }, ...world.session } });
    return response;
  }) as unknown as typeof fetch;
  expect(await runOnboard(['--json', '--yes', '--no-wire', '--skip-demo'], wrapped)).toBe(0);
  expect(world.calls.some(call => call.path === '/api/v1/onboarding')).toBe(true);
  expect(world.calls.find(call => call.path.endsWith('/verify'))?.body).toEqual({ recipient: B });
  expect(records().some(record => record.code === 'verification_code_sent')).toBe(true);
  expect(world.calls.some(call => call.path.endsWith('/demo'))).toBe(false);
});

test('a rotated credential replaces an authorized ended session with a fresh challenge', async () => {
  expect(await run('--yes', '--no-wire')).toBe(0);
  const saved = JSON.parse(readFileSync(credentials(), 'utf8'));
  writeFileSync(credentials(), JSON.stringify({ ...saved, access_token: `ftu_${'x'.repeat(43)}` }));
  for (const status of ['expired', 'cancelled']) {
    world.session = { status, recipient: A };
    world.calls = []; world.out = [];
    const wrapped = deps(), fetcher = wrapped.fetch;
    wrapped.fetch = (async (input: URL, init: RequestInit) => {
      const path = new URL(input).pathname;
      if (path === '/api/v1/onboarding') world.session = { status: 'awaiting_verification' };
      const response = await fetcher(input, init);
      if (path === '/api/v1/onboarding' || path === `/api/v1/onboarding/${CALL}`)
        return Response.json({ data: { id: CALL, line: { id: PROJECT, receiving_number: LINE }, ...world.session } });
      return response;
    }) as unknown as typeof fetch;
    expect(await runOnboard(['--json', '--yes', '--no-wire', '--skip-demo'], wrapped)).toBe(0);
    expect(records().some(record => record.code === 'verification_code_sent')).toBe(true);
    expect(world.calls.filter(call => call.path.endsWith('/verify'))).toHaveLength(1);
    expect(world.calls.some(call => call.path.endsWith('/demo'))).toBe(false);
    const file = join(world.home, '.chert', 'onboarding', `${createHash('sha256').update(JSON.stringify(['https://facetime.trychert.com', PROJECT])).digest('hex')}.json`);
    const current = JSON.parse(readFileSync(file, 'utf8'));
    current.session_id = SESSION;
    writeFileSync(file, JSON.stringify(current));
    const token = JSON.parse(readFileSync(credentials(), 'utf8'));
    token.access_token = token.access_token === TOKEN ? `ftu_${'x'.repeat(43)}` : TOKEN;
    writeFileSync(credentials(), JSON.stringify(token));
  }
});

test('an ended session for another number starts a new verification for the selected number', async () => {
  expect(await run('--yes', '--no-wire')).toBe(0);
  const oldKey = world.calls.find(call => call.path === '/api/v1/onboarding')!.headers.get('idempotency-key');
  world.aliases = [B];
  for (const status of ['expired', 'cancelled']) {
    world.session = { status, recipient: A }; world.calls = []; world.out = [];
    const wrapped = deps(), fetcher = wrapped.fetch;
    wrapped.fetch = (async (input: URL, init: RequestInit) => {
      const path = new URL(input).pathname;
      if (path === '/api/v1/onboarding') world.session = { status: 'awaiting_verification' };
      const response = await fetcher(input, init);
      if (path === '/api/v1/onboarding' || path === `/api/v1/onboarding/${CALL}`)
        return Response.json({ data: { id: CALL, line: { receiving_number: LINE }, ...world.session } });
      return response;
    }) as unknown as typeof fetch;
    expect(await runOnboard(['--json', '--yes', '--no-wire', '--skip-demo'], wrapped)).toBe(0);
    expect(world.calls.find(call => call.path === '/api/v1/onboarding')!.headers.get('idempotency-key')).not.toBe(oldKey);
    expect(world.calls.find(call => call.path.endsWith('/verify'))?.body).toEqual({ recipient: B });
    expect(records().some(record => record.code === 'verification_code_sent')).toBe(true);
    expect(world.calls.some(call => call.path.endsWith('/demo'))).toBe(false);
    const file = join(world.home, '.chert', 'onboarding', `${createHash('sha256').update(JSON.stringify(['https://facetime.trychert.com', PROJECT])).digest('hex')}.json`);
    const state = JSON.parse(readFileSync(file, 'utf8'));
    state.session_id = SESSION;
    writeFileSync(file, JSON.stringify(state));
    const token = JSON.parse(readFileSync(credentials(), 'utf8'));
    token.access_token = `ftu_${'x'.repeat(43)}`;
    writeFileSync(credentials(), JSON.stringify(token));
  }
});

test('an unrelated terminal session cannot authorize a fresh request', async () => {
  expect(await run('--yes', '--no-wire')).toBe(0);
  world.aliases = [B]; world.calls = [];
  world.responses[`/api/v1/onboarding/${SESSION}`] = { status: 200, body: { data: { id: CALL, status: 'expired', recipient: A, line: { receiving_number: LINE } } } };
  expect(await run('--yes', '--no-wire')).toBe(1);
  expect(failure().code).toBe('recipient_proof_required');
  expect(world.calls.some(call => call.path === '/api/v1/onboarding' || call.path.endsWith('/verify') || call.path.endsWith('/demo'))).toBe(false);
});

test('stale verification schedules a fresh session and refuses reused proof', async () => {
  expect(await run('--yes', '--no-wire')).toBe(0);
  world.responses[`/api/v1/onboarding/${SESSION}`] = { status: 409, body: { error: { code: 'verification_stale' } } };
  world.calls = [];
  expect(await run('--yes', '--no-wire')).toBe(1);
  expect(failure().code).toBe('verification_stale');
  expect(world.calls.some(call => call.path.endsWith('/demo'))).toBe(false);
  delete world.responses[`/api/v1/onboarding/${SESSION}`];
  world.responses['/api/v1/onboarding'] = { status: 200, body: { data: { id: CALL, status: 'ready', recipient: A, line: { receiving_number: LINE } } } };
  world.calls = [];
  expect(await run('--yes', '--no-wire')).toBe(1);
  expect(failure().code).toBe('recipient_proof_required');
  expect(world.calls.some(call => call.path.endsWith('/demo'))).toBe(false);
});

test('an authorized legacy session with matching recipient can resume', async () => {
  expect(await run('--yes', '--no-wire')).toBe(0);
  const file = join(world.home, '.chert', 'onboarding', `${createHash('sha256').update(JSON.stringify(['https://facetime.trychert.com', PROJECT])).digest('hex')}.json`);
  const resume = JSON.parse(readFileSync(file, 'utf8'));
  delete resume.binding;
  writeFileSync(file, JSON.stringify(resume));
  world.calls = []; world.out = [];
  expect(await run('--yes', '--no-wire')).toBe(0);
  expect(records().some(record => record.code === 'demo_requested')).toBe(true);
  expect(JSON.parse(readFileSync(file, 'utf8')).binding).toBeDefined();
});

test('an authorized legacy session without a recipient starts a new verification', async () => {
  world.responses[`/api/v1/onboarding/${SESSION}/verify`] = { status: 500, body: {} };
  expect(await run('--yes', '--no-wire')).toBe(1);
  const file = join(world.home, '.chert', 'onboarding', `${createHash('sha256').update(JSON.stringify(['https://facetime.trychert.com', PROJECT])).digest('hex')}.json`);
  const resume = JSON.parse(readFileSync(file, 'utf8'));
  delete resume.binding;
  writeFileSync(file, JSON.stringify(resume));
  delete world.responses[`/api/v1/onboarding/${SESSION}/verify`];
  world.calls = []; world.out = [];
  const wrapped = deps(), fetcher = wrapped.fetch;
  wrapped.fetch = (async (input: URL, init: RequestInit) => {
    const path = new URL(input).pathname;
    const response = await fetcher(input, init);
    if (path === '/api/v1/onboarding' || path === `/api/v1/onboarding/${CALL}`)
      return Response.json({ data: { id: CALL, line: { id: PROJECT, receiving_number: LINE }, ...world.session } });
    return response;
  }) as unknown as typeof fetch;
  expect(await runOnboard(['--json', '--yes', '--no-wire', '--skip-demo'], wrapped)).toBe(0);
  expect(records().some(record => record.code === 'verification_code_sent')).toBe(true);
  expect(world.calls.find(call => call.path.endsWith('/verify'))?.path).toBe(`/api/v1/onboarding/${CALL}/verify`);
});

test('failed account, project, recipient, or session proof never changes the resume binding', async () => {
  expect(await run('--yes', '--no-wire')).toBe(0);
  const saved = JSON.parse(readFileSync(credentials(), 'utf8'));
  writeFileSync(credentials(), JSON.stringify({ ...saved, access_token: `ftu_${'x'.repeat(43)}` }));
  const dir = join(world.home, '.chert', 'onboarding');
  const fileFor = (project: string) => join(dir, `${createHash('sha256').update(JSON.stringify(['https://facetime.trychert.com', project])).digest('hex')}.json`);
  const original = readFileSync(fileFor(PROJECT), 'utf8');
  for (const response of [
    { status: 403, body: { error: { code: 'onboarding_forbidden' } } },
    { status: 404, body: { error: { code: 'onboarding_not_found' } } },
    { status: 200, body: { data: { id: SESSION, status: 'ready', recipient: B, line: { receiving_number: LINE } } } },
    { status: 200, body: { data: { id: PROJECT, status: 'ready', recipient: A, line: { receiving_number: LINE } } } },
  ]) {
    world.responses[`/api/v1/onboarding/${SESSION}`] = response;
    world.calls = [];
    expect(await run('--yes', '--no-wire')).toBe(1);
    expect(readFileSync(fileFor(PROJECT), 'utf8')).toBe(original);
    expect(world.calls.some(call => call.path.endsWith('/verify') || call.path.endsWith('/demo'))).toBe(false);
  }
  const otherProject = '44444444-4444-4444-8444-444444444444';
  writeFileSync(credentials(), JSON.stringify({ ...saved, project_id: otherProject }));
  writeFileSync(fileFor(otherProject), original, { mode: 0o600 });
  world.responses[`/api/v1/onboarding/${SESSION}`] = { status: 404, body: { error: { code: 'onboarding_not_found' } } };
  world.calls = [];
  expect(await run('--yes', '--no-wire')).toBe(1);
  expect(world.calls[0]!.headers.get('x-chert-project-id')).toBe(otherProject);
  expect(readFileSync(fileFor(otherProject), 'utf8')).toBe(original);
});

test('a legacy record without a session id is preserved and starts a fresh verification', async () => {
  expect(await run('--yes', '--no-wire')).toBe(0);
  const file = join(world.home, '.chert', 'onboarding', `${createHash('sha256').update(JSON.stringify(['https://facetime.trychert.com', PROJECT])).digest('hex')}.json`);
  const old = JSON.stringify({ request_key: '44444444-4444-4444-8444-444444444444' });
  writeFileSync(file, old);
  world.calls = []; world.out = []; world.session = { status: 'awaiting_verification' };
  expect(await run('--yes', '--no-wire', '--skip-demo')).toBe(0);
  expect(records().some(record => record.code === 'onboarding_restarted')).toBe(true);
  expect(records().some(record => record.code === 'verification_code_sent')).toBe(true);
  const archive = readdirNames(join(world.home, '.chert', 'onboarding')).find(name => name.includes('.json.archived-'))!;
  expect(readFileSync(join(world.home, '.chert', 'onboarding', archive), 'utf8')).toBe(old);
  expect(world.calls.some(call => call.path.endsWith('/demo'))).toBe(false);
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
  let polls = 0;
  const wrapped = deps(), fetcher = wrapped.fetch;
  wrapped.fetch = (async (input: URL, init: RequestInit) => {
    const path = new URL(input).pathname;
    if (path.endsWith('/demo')) return Response.json({ data: { id: SESSION, status: 'ready', recipient: A, line: { id: PROJECT, receiving_number: LINE }, demo_queue: { state: 'waiting', position: 2 } } });
    if (path === `/api/v1/onboarding/${SESSION}`) {
      polls++;
      return Response.json({ data: { id: SESSION, recipient: A, line: { id: PROJECT, receiving_number: LINE }, ...(polls === 1 ? { status: 'ready' } : polls === 2 ? { status: 'ready', demo_queue: { state: 'waiting', position: 1 } } : { status: 'demo_running', demo_call_id: CALL }) } });
    }
    return fetcher(input, init);
  }) as unknown as typeof fetch;
  expect(await runOnboard(['--json', '--yes', '--no-wire'], wrapped)).toBe(0);
  expect(records().filter(r => r.code === 'demo_queued').map(r => r.position)).toEqual([2, 1]);
  expect(records().map(r => r.code)).toContain('demo_requested');
});

test('a queue wait that ended is not reported as a call', async () => {
  world.responses[`/api/v1/onboarding/${SESSION}/demo`] = { status: 200, body: { data: { id: SESSION, status: 'ready', recipient: A, line: { id: PROJECT, receiving_number: LINE }, demo_queue: { state: 'expired', position: null } } } };
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
  expect(wire.prompt).toContain('cannot create application calls');
  expect(wire.prompt).toContain('project API key created in the browser');
  expect(wire.prompt).toContain('Never ask the user to paste credentials');
  expect(wire.prompt).toContain('explicit user authorization and an approved recipient');
  expect(wire.prompt).toContain('otherwise use non-calling checks');
  expect(wire.prompt).not.toContain('chert-sdk context');
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

test('does not put temporary credentials in an in-repository directory beginning with two dots', async () => {
  writeFileSync(join(world.cwd, 'package.json'), '{}');
  const inside = join(world.cwd, '..cache');
  mkdirSync(inside);
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = inside;
  const wrapped = deps(), exec = wrapped.exec;
  wrapped.exec = async (file, args, timeout) => file === 'git' && args.includes('rev-parse')
    ? { stdout: world.cwd }
    : exec(file, args, timeout);
  try {
    expect(await runOnboard(['--json', '--yes'], wrapped)).toBe(0);
    expect(records().find(r => r.code === 'wire_in')).toMatchObject({ env_local_written: false });
    expect(existsSync(join(world.cwd, '.env.local'))).toBe(false);
  } finally {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
  }
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

test('no project installs the published CLI without asking', async () => {
  world.chertInstalled = false;
  expect(await run('--numbers', '1')).toBe(0);
  expect(world.prompts).toEqual([]);
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

test('one number on the Mac runs from start to call with no prompt and one message', async () => {
  world.interactive = true;
  world.proven = true;
  expect(await runOnboard(['--no-wire'], deps())).toBe(0);
  expect(world.prompts).toEqual([]);
  expect(world.sent.length).toBe(1);
  expect(world.out.join('\n')).toContain('Answer the FaceTime call');
});

function limitedVerify(times: number): OnboardDeps {
  const base = deps(), real = base.fetch;
  let left = times;
  return { ...base, fetch: (async (input: URL, init: RequestInit) => {
    if (new URL(input).pathname.endsWith('/verify') && left-- > 0) {
      world.calls.push({ path: new URL(input).pathname, body: undefined, headers: new Headers(init.headers), method: init.method ?? 'GET' });
      return Response.json({ error: { code: 'verification_rate_limited' } }, { status: 429 });
    }
    return real(input as never, init);
  }) as unknown as typeof fetch };
}

test('a verification rate limit is waited out with no second run', async () => {
  world.proven = true;
  expect(await runOnboard(['--json', '--no-wire'], limitedVerify(3))).toBe(0);
  expect(records().filter(record => record.code === 'verification_waiting').length).toBe(1);
  expect(records().some(record => record.code === 'demo_requested')).toBe(true);
  expect(world.calls.filter(call => call.path.endsWith('/verify')).length).toBe(4);
});

test('a rate limit that outlasts the wait still stops with the same error', async () => {
  world.proven = true;
  const started = world.now;
  expect(await runOnboard(['--json', '--no-wire'], limitedVerify(Number.MAX_SAFE_INTEGER))).toBe(1);
  expect(failure().code).toBe('verification_rate_limited');
  expect(world.now - started).toBeLessThanOrEqual(40_000);
  expect(records().some(record => record.code === 'demo_requested')).toBe(false);
});

test('a demo retry fails closed if the new session does not prove the recipient', async () => {
  world.proven = true;
  expect(await run('--no-wire')).toBe(0);
  world.session = { status: 'complete', recipient: A, demo_result: 'not_completed', demo_call_id: PROJECT };
  world.responses['/api/v1/onboarding'] = { status: 200, body: { data: { id: SESSION, status: 'ready', line: { id: PROJECT, receiving_number: LINE } } } };
  world.calls = []; world.out = [];
  const started = world.calls.length;
  expect(await run('--no-wire')).toBe(1);
  expect(records().some(record => record.code === 'demo_retry')).toBe(true);
  expect(failure().code).toBe('recipient_proof_required');
  const creates = world.calls.slice(started).filter(call => call.path === '/api/v1/onboarding');
  expect(creates.length).toBe(1);
});
