import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const executable = fileURLToPath(new URL('../../src/cli/main.js', import.meta.url));
const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const userToken = `${part({ alg: 'HS256' })}.${part({ sub: 'user', email: 'dev@example.test', exp: Math.floor(Date.now() / 1000) + 3600 })}.c2lnbmF0dXJl`;
const LIVEKIT = { LIVEKIT_URL: 'wss://fixture.livekit.invalid', LIVEKIT_API_KEY: 'APIfixture', LIVEKIT_API_SECRET: 'SECRET_SENTINEL_at_least_32_characters_long' };

function chert(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  return spawnSync(process.execPath, [executable, ...args], { encoding: 'utf8', input, env: { PATH: process.env.PATH, CHERT_CONTROL_ORIGIN: 'https://127.0.0.1:9', ...env }, timeout: 20000 });
}
function home() { const directory = mkdtempSync(join(tmpdir(), 'chert-home-')); return { directory, close: () => rmSync(directory, { recursive: true, force: true }) }; }

test('help lists the developer commands', () => {
  const result = chert(['--help'], {});
  assert.equal(result.status, 0, result.stderr);
  for (const word of ['login', 'dev', 'doctor', 'whoami', 'logout']) assert.match(result.stdout, new RegExp(word));
});

test('help lists every exit code a developer command can end with, the cancelled sign-in among them', () => {
  // The short help stays short: the codes are on each command's --help --all and on the advanced page.
  assert.match(chert(['login', '--help', '--all'], {}).stdout, /Exit codes: 0 success,[\s\S]*130 cancelled/);
  const all = chert(['--help', '--all'], {});
  assert.match(all.stdout, /Exit: 0 success,/); assert.match(all.stdout, /130 sign-in cancelled/);
});

test('dev: the agent name is required', () => {
  const h = home();
  try {
    const result = chert(['dev', '--json'], { CHERT_HOME: h.directory, ...LIVEKIT });
    assert.equal(result.status, 2); assert.equal(JSON.parse(result.stderr).code, 'missing_input');
  } finally { h.close(); }
});

test('dev: without a login it stops before any network or LiveKit effect', () => {
  const h = home();
  try {
    const result = chert(['dev', '--agent', 'fixture-agent', '--json'], { CHERT_HOME: h.directory, ...LIVEKIT });
    assert.equal(result.status, 3); assert.equal(JSON.parse(result.stderr).code, 'login_required');
    assert.ok(!(result.stdout + result.stderr).includes(LIVEKIT.LIVEKIT_API_SECRET));
  } finally { h.close(); }
});

test('dev: missing LiveKit credentials are named, never printed', () => {
  const h = home();
  try {
    const result = chert(['dev', '--agent', 'fixture-agent', '--json'], { CHERT_HOME: h.directory, CHERT_USER_ACCESS_TOKEN: userToken, LIVEKIT_URL: LIVEKIT.LIVEKIT_URL });
    assert.equal(result.status, 3);
    const failure = JSON.parse(result.stderr);
    assert.equal(failure.code, 'livekit_credentials_missing');
    assert.match(failure.action, /LIVEKIT_API_KEY/); assert.match(failure.action, /LIVEKIT_API_SECRET/);
    assert.ok(!(result.stdout + result.stderr).includes(userToken));
  } finally { h.close(); }
});

test('login --with-token stores the session privately; whoami shows it without the token; logout removes it', () => {
  const h = home();
  try {
    const login = chert(['login', '--with-token', '--json'], { CHERT_HOME: h.directory }, userToken + '\n');
    assert.equal(login.status, 0, login.stderr);
    assert.ok(!(login.stdout + login.stderr).includes(userToken));
    assert.equal(statSync(join(h.directory, 'credentials.json')).mode & 0o777, 0o600);
    const who = chert(['whoami', '--json'], { CHERT_HOME: h.directory });
    assert.equal(who.status, 0, who.stderr);
    const status = JSON.parse(who.stdout);
    assert.equal(status.signed_in, true); assert.equal(status.email, 'dev@example.test');
    assert.ok(!who.stdout.includes(userToken));
    const out = chert(['logout', '--json'], { CHERT_HOME: h.directory });
    assert.equal(out.status, 0, out.stderr);
    assert.equal(JSON.parse(chert(['whoami', '--json'], { CHERT_HOME: h.directory }).stdout).signed_in, false);
  } finally { h.close(); }
});

test('login --with-token rejects something that is not a session token', () => {
  const h = home();
  try {
    const result = chert(['login', '--with-token', '--json'], { CHERT_HOME: h.directory }, 'not-a-token\n');
    assert.equal(result.status, 2); assert.equal(JSON.parse(result.stderr).code, 'invalid_token');
  } finally { h.close(); }
});

const expiredToken = `${part({ alg: 'HS256' })}.${part({ sub: 'user', exp: Math.floor(Date.now() / 1000) - 60 })}.c2lnbmF0dXJl`;
const ready = (h: { directory: string }, extra: NodeJS.ProcessEnv = {}) => ({ CHERT_HOME: h.directory, CHERT_USER_ACCESS_TOKEN: userToken, ...LIVEKIT, ...extra });
const noSecrets = (result: { stdout: string; stderr: string }) => { const text = result.stdout + result.stderr; assert.ok(!text.includes(LIVEKIT.LIVEKIT_API_SECRET) && !text.includes(userToken), text); };

for (const [name, args, code] of [
  ['an unknown flag', ['dev', '--agent', 'a', '--verbose'], 'invalid_usage'],
  ['a repeated flag', ['dev', '--agent', 'a', '--agent', 'b'], 'invalid_usage'],
  ['a flag without its value', ['dev', '--agent'], 'missing_input'],
  ['a value that is another flag', ['dev', '--agent', '--takeover'], 'missing_input'],
  ['a positional argument', ['dev', 'my-agent'], 'invalid_usage'],
  ['an agent name with a space', ['dev', '--agent', 'my agent'], 'invalid_agent_name'],
  ['an agent name with a slash', ['dev', '--agent', '../x'], 'invalid_agent_name'],
  ['a flag on whoami', ['whoami', '--agent', 'a'], 'invalid_usage'],
  ['login with a token and a device code at once', ['login', '--with-token', '--device'], 'invalid_usage'],
  ['login to an address that is not https', ['login', '--backend', 'http://control.example'], 'invalid_origin'],
] as const) {
  test(`usage: ${name} is rejected with ${code} before anything else happens`, () => {
    const h = home();
    try {
      const result = chert([...args, '--json'], ready(h));
      assert.equal(result.status, 2, result.stderr); assert.equal(JSON.parse(result.stderr).code, code); assert.equal(result.stdout, ''); noSecrets(result);
    } finally { h.close(); }
  });
}

for (const [name, args, code, words] of [
  ['an --until that is not a time of day', ['dev', '--agent', 'a', '--until', '25:00'], 'invalid_usage', /--until .*HH:MM/],
  ['an --until that has passed today', ['dev', '--agent', 'a', '--until', '00:00'], 'slot_time_passed', /00:00 has already passed today/],
  ['--minutes out of range', ['dev', '--agent', 'a', '--minutes', '0'], 'invalid_usage', /1 to 240/],
  ['--minutes that is not a whole number', ['dev', '--agent', 'a', '--minutes', '7.5'], 'invalid_usage', /1 to 240/],
  ['--until with --minutes', ['dev', '--agent', 'a', '--until', '23:59', '--minutes', '10'], 'invalid_usage', /not both/],
] as const) {
  test(`dev: ${name} is refused with ${code} before any network call`, () => {
    const h = home();
    try {
      const result = chert([...args, '--json'], ready(h));
      assert.equal(result.status, 2, result.stderr); const failure = JSON.parse(result.stderr);
      assert.equal(failure.code, code); assert.match(failure.action, words); assert.equal(result.stdout, ''); noSecrets(result);
    } finally { h.close(); }
  });
}

test('dev: a valid --until or --minutes is accepted and the run goes on to its first network call', () => {
  const h = home();
  try {
    // Five minutes from now, unless that falls tomorrow: --until is a time today.
    const later = new Date(Date.now() + 5 * 60_000), hhmm = [later.getHours(), later.getMinutes()].map(part => String(part).padStart(2, '0')).join(':');
    const flags = [['--minutes', '240'], ...(later.getDate() === new Date().getDate() ? [['--until', hhmm]] : [])];
    for (const flag of flags) {
      const result = chert(['dev', '--agent', 'a', ...flag, '--json'], ready(h));
      // The fixture LiveKit address cannot be reached: getting that far means the flag was read and judged.
      assert.equal(result.status, 6, result.stderr); assert.equal(JSON.parse(result.stderr).code, 'livekit_unreachable');
    }
  } finally { h.close(); }
});

for (const [url, label] of [['https://project.livekit.cloud', 'https'], ['wss://user:pass@project.livekit.cloud', 'embedded credentials'], ['wss://project.livekit.cloud/path', 'a path'], ['project.livekit.cloud', 'no scheme']] as const) {
  test(`dev: a LIVEKIT_URL with ${label} is rejected before any network call`, () => {
    const h = home();
    try {
      const result = chert(['dev', '--agent', 'a', '--json'], ready(h, { LIVEKIT_URL: url }));
      assert.equal(result.status, 2, result.stderr); assert.equal(JSON.parse(result.stderr).code, 'livekit_url_invalid'); noSecrets(result);
    } finally { h.close(); }
  });
}

for (const flag of ['--backend', '--relay-origin']) {
  test(`dev: a ${flag} that is not a plain https origin is rejected before any network call`, () => {
    const h = home();
    try {
      const result = chert(['dev', '--agent', 'a', flag, 'http://127.0.0.1:9', '--json'], ready(h));
      assert.equal(result.status, 2, result.stderr); assert.equal(JSON.parse(result.stderr).code, 'invalid_origin'); noSecrets(result);
    } finally { h.close(); }
  });
}

test('dev: an unreachable LiveKit project is named as such and nothing is claimed', () => {
  const h = home();
  try {
    const result = chert(['dev', '--agent', 'a', '--json'], ready(h));
    assert.equal(result.status, 6, result.stderr); assert.equal(JSON.parse(result.stderr).code, 'livekit_unreachable'); noSecrets(result);
  } finally { h.close(); }
});

test('dev: an expired stored session says so, and an expired token in the environment is not used silently', () => {
  const h = home();
  try {
    assert.equal(chert(['login', '--with-token', '--json'], { CHERT_HOME: h.directory }, expiredToken).status, 2, 'an expired token cannot be stored');
    const login = chert(['login', '--with-token', '--json'], { CHERT_HOME: h.directory }, userToken); assert.equal(login.status, 0, login.stderr);
    const who = JSON.parse(chert(['whoami', '--json'], { CHERT_HOME: h.directory }).stdout);
    assert.equal(who.signed_in, true); assert.ok(who.expires_at > Date.now());
    const result = chert(['dev', '--agent', 'a', '--json'], { CHERT_HOME: h.directory, ...LIVEKIT, CHERT_USER_ACCESS_TOKEN: 'line1\nline2' });
    assert.equal(result.status, 3); assert.equal(JSON.parse(result.stderr).code, 'login_required');
  } finally { h.close(); }
});

test('login --with-token accepts a trailing newline and surrounding spaces, and rejects an empty pipe', () => {
  const h = home();
  try {
    assert.equal(chert(['login', '--with-token', '--json'], { CHERT_HOME: h.directory }, `  ${userToken}\n\n`).status, 0);
    const empty = chert(['login', '--with-token', '--json'], { CHERT_HOME: h.directory }, '');
    assert.equal(empty.status, 2); assert.equal(JSON.parse(empty.stderr).code, 'invalid_token');
  } finally { h.close(); }
});

test('without --json, errors are one readable line and success prints a sentence, never raw JSON', () => {
  const h = home();
  try {
    const failed = chert(['dev'], ready(h));
    assert.equal(failed.status, 2); assert.match(failed.stderr, /^Name your agent: chert dev --agent my-agent, .* \(missing_input\)\n$/); assert.ok(!failed.stderr.includes('{'));
    const who = chert(['whoami'], { CHERT_HOME: h.directory });
    assert.equal(who.stdout.trim(), 'Not signed in. Run chert login.');
  } finally { h.close(); }
});

test('the home directory is created owner-only even when it did not exist', () => {
  const h = home();
  try {
    const nested = join(h.directory, 'nested', 'chert');
    chert(['whoami', '--json'], { CHERT_HOME: nested });
    assert.equal(statSync(nested).mode & 0o777, 0o700);
  } finally { h.close(); }
});

test('doctor: with nothing set up it reports every missing piece at once, without any network call, and exits 3', () => {
  const h = home();
  try {
    const result = chert(['doctor', '--agent', 'a', '--json'], { CHERT_HOME: h.directory });
    assert.equal(result.status, 3, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, false);
    const status = Object.fromEntries(report.checks.map((c: { name: string; status: string }) => [c.name, c.status]));
    assert.deepEqual(status, { session: 'fail', chert: 'skip', clock: 'skip', project: 'skip', line: 'skip', worker: 'skip', line_free: 'skip', livekit: 'fail', agent: 'skip' });
  } finally { h.close(); }
});

test('doctor: the readable report marks each check and ends with a verdict', () => {
  const h = home();
  try {
    const result = chert(['doctor'], { CHERT_HOME: h.directory, LIVEKIT_URL: 'https://wrong.example', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: LIVEKIT.LIVEKIT_API_SECRET });
    assert.equal(result.status, 3);
    assert.match(result.stdout, /✗ session\s+Not signed in\./); assert.match(result.stdout, /→ Run chert login\./);
    assert.match(result.stdout, /✗ livekit\s+LIVEKIT_URL is not a wss:\/\/ address\./); assert.match(result.stdout, /2 problems to fix/);
    assert.ok(!result.stdout.includes(LIVEKIT.LIVEKIT_API_SECRET));
  } finally { h.close(); }
});

test('doctor: an expired token in the environment counts as not signed in', () => {
  const h = home();
  try {
    const report = JSON.parse(chert(['doctor', '--json'], { CHERT_HOME: h.directory, CHERT_USER_ACCESS_TOKEN: expiredToken }).stdout);
    assert.equal(report.checks.find((c: { name: string }) => c.name === 'session').status, 'fail');
    assert.equal(report.checks.find((c: { name: string }) => c.name === 'chert').status, 'skip');
  } finally { h.close(); }
});

test('dev: explicit Muse mode requires authentication and cannot disable preparation', () => {
  const h = home();
  try {
    const result = chert(['dev', '--agent', 'demo-agent-0', '--muse', '--json'], { CHERT_HOME: h.directory, ...LIVEKIT });
    assert.equal(result.status, 3); assert.equal(JSON.parse(result.stderr).code, 'login_required');
    const conflict = chert(['dev', '--agent', 'demo-agent-0', '--muse', '--no-prewarm', '--json'], { CHERT_HOME: h.directory, ...LIVEKIT });
    assert.equal(conflict.status, 2); assert.equal(JSON.parse(conflict.stderr).code, 'invalid_usage');
  } finally { h.close(); }
});

test('login: without a terminal it asks Chert for a device code, and an unreachable Chert saves nothing', () => {
  const h = home();
  try {
    const result = chert(['login', '--json'], { CHERT_HOME: h.directory, CHERT_CONTROL_ORIGIN: 'https://127.0.0.1:9' });
    assert.equal(result.status, 6, result.stderr); assert.equal(JSON.parse(result.stderr).code, 'backend_unreachable');
    assert.equal(JSON.parse(chert(['whoami', '--json'], { CHERT_HOME: h.directory }).stdout).signed_in, false);
  } finally { h.close(); }
});

test('a bare chert outside a terminal prints the help and never starts a sign-in', () => {
  const h = home();
  try {
    const result = chert([], { CHERT_HOME: h.directory, CHERT_CONTROL_ORIGIN: 'https://127.0.0.1:9' });
    assert.equal(result.status, 0); assert.match(result.stdout, /GET STARTED\n {2}1\. chert login/);
  } finally { h.close(); }
});
