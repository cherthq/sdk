import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onboard } from '../../src/dev/command.js';
import { credentialStore } from '../../src/cli/login.js';
import { onboardingStore } from '../../src/dev/onboard.js';
import type { DeviceLoginDeps } from '../../src/dev/device-login.js';

const origin = 'https://control.example', project = '11000000-0000-4000-8000-000000000001';
const legacyProject = '11000000-0000-4000-8000-000000000009';
const sessionID = '22000000-0000-4000-8000-000000000002';
const token = `ftu_${'a'.repeat(43)}`, oldToken = `ftu_${'b'.repeat(43)}`;
function rig() {
  const home = mkdtempSync(join(tmpdir(), 'chert-browser-setup-'));
  const calls: { path: string; key: string | null }[] = [], opened: string[] = [];
  const records: Record<string, unknown>[] = [], revoked: { token: string | null; saved: string | undefined }[] = [];
  let clock = Date.now(), loginProject = project, status = 'awaiting_verification', failStart = false, dedicated = false, failRevoke = false;
  const credentials = credentialStore(home);
  const deps: DeviceLoginDeps = {
    now: () => clock, pause: async ms => { clock += ms; }, open: async url => { opened.push(url); return true; },
    fetch: (async (url: URL, init: RequestInit) => {
      calls.push({ path: url.pathname, key: new Headers(init.headers).get('idempotency-key') });
      if (url.pathname === '/api/v1/cli/logout') {
        revoked.push({ token: new Headers(init.headers).get('authorization'), saved: credentials.load()?.access_token });
        if (failRevoke) throw new TypeError('network');
        return Response.json({ data: { revoked: true } });
      }
      if (url.pathname === '/api/v1/cli/logins') {
        if (failStart) throw new TypeError('network');
        return Response.json({ data: { device_code: `fdc_${'d'.repeat(43)}`, user_code: 'KDTF-2937', verification_url: `${origin}/cli`,
          verification_url_complete: `${origin}/cli?code=KDTF-2937`, expires_in: 600, interval: 2 } });
      }
      if (url.pathname.endsWith('/token')) return Response.json({ data: { status: 'approved', access_token: token, expires_in: 3600,
        project: { id: loginProject, name: "Avery's project" } } });
      if (dedicated && new Headers(init.headers).get('x-chert-project-id') === legacyProject) {
        return Response.json({ error: { code: 'shared_project_has_dedicated_line' } }, { status: 409 });
      }
      const value = status; status = 'ready';
      return Response.json({ data: { id: sessionID, status: value, verification_url: `${origin}/cli/onboarding?session=${sessionID}&project=${loginProject}`,
        expires_at: new Date(clock + 3600000).toISOString(), line: { id: legacyProject, receiving_number: '+15555550100' } } });
    }) as typeof fetch,
  };
  const run = (args: string[] = []) => onboard(['--backend', origin, '--skip-demo', ...args], { CHERT_HOME: home }, new AbortController().signal, record => records.push(record), deps);
  const oldLogin = () => credentials.save({ access_token: oldToken, expires_at: clock + 3600000, project_id: legacyProject, kind: 'cli', origin });
  return { home, calls, opened, records, revoked, credentials, run, oldLogin, cleanup: () => rmSync(home, { recursive: true, force: true }),
    failRevoke: () => { failRevoke = true; },
    failStart: (value: boolean) => { failStart = value; }, dedicated: () => { dedicated = true; }, loginProject: (value: string) => { loginProject = value; }, ready: () => { status = 'ready'; } };
}

test('fresh browser setup resumes the browser session with one key and never opens a second tab', async () => {
  const r = rig();
  try {
    await r.run();
    assert.equal(r.opened.length, 1);
    const key = new URL(r.opened[0]!).searchParams.get('onboard');
    assert.ok(key);
    assert.equal(r.credentials.load()?.onboarding_request_key, key);
    assert.equal(r.calls.find(call => call.path === '/api/v1/onboarding')?.key, key);
    assert.deepEqual(onboardingStore(r.home, origin, project).load(), { request_key: key, session_id: sessionID });
    assert.equal(onboardingStore(r.home, origin, 'browser-setup').load(), undefined);
  } finally { r.cleanup(); }
});

test('plain onboard replaces legacy project selection with browser setup without touching its existing line', async () => {
  const r = rig();
  try { r.oldLogin(); await r.run(); assert.equal(r.calls[0]?.path, '/api/v1/cli/logins'); assert.equal(r.credentials.load()?.project_id, project); }
  finally { r.cleanup(); }
});

test('failed login retains setup intent for retry', async () => {
  const r = rig();
  try {
    r.failStart(true); await assert.rejects(r.run(), /backend_unreachable/);
    const intent = onboardingStore(r.home, origin, 'browser-setup').load(); assert.ok(intent);
    r.failStart(false); await r.run();
    assert.equal(new URL(r.opened[0]!).searchParams.get('onboard'), intent.request_key);
  } finally { r.cleanup(); }
});

test('active and uncertain legacy sessions remain scoped to their project', async () => {
  for (const savedSession of [undefined, sessionID]) {
    const r = rig();
    try {
      r.oldLogin(); r.loginProject(legacyProject); r.ready();
      onboardingStore(r.home, origin, legacyProject).save({ request_key: project, ...(savedSession ? { session_id: savedSession } : {}) });
      await r.run(); assert.ok(r.calls.every(call => !call.path.includes('/cli/logins')));
      assert.equal(r.credentials.load()?.project_id, legacyProject);
    } finally { r.cleanup(); }
  }
});

test('definitive dedicated-line refusal recovers the old failed intent by opening setup', async () => {
  const r = rig();
  try {
    r.oldLogin(); r.dedicated(); onboardingStore(r.home, origin, legacyProject).save({ request_key: project });
    await r.run(); assert.equal(r.opened.length, 1); assert.equal(r.credentials.load()?.project_id, project);
    assert.deepEqual(onboardingStore(r.home, origin, legacyProject).load(), { request_key: project });
  } finally { r.cleanup(); }
});

test('explicit projects and status do not launch browser setup', async () => {
  const r = rig();
  try {
    r.oldLogin(); r.loginProject(legacyProject); r.ready();
    await assert.rejects(r.run(['--status']), /onboarding_not_started/); assert.equal(r.calls.length, 0);
    await r.run(['--project', legacyProject]); assert.ok(r.calls.every(call => !call.path.includes('/cli/logins')));
  } finally { r.cleanup(); }
});


test('expired credentials cannot abandon an uncertain session by selecting a different project', async () => {
  const r = rig();
  try {
    r.oldLogin();
    r.credentials.save({ ...r.credentials.load()!, expires_at: Date.now() - 1000 });
    onboardingStore(r.home, origin, legacyProject).save({ request_key: project });
    await assert.rejects(r.run(), /onboarding_project_mismatch/);
    assert.equal(r.credentials.load()?.project_id, legacyProject);
    assert.deepEqual(onboardingStore(r.home, origin, legacyProject).load(), { request_key: project });
    assert.equal(r.calls.filter(call => call.path === '/api/v1/onboarding').length, 0);
  } finally { r.cleanup(); }
});


test('setup saves the replacement before revoking the old CLI credential', async () => {
  const r = rig();
  try {
    r.oldLogin(); await r.run();
    assert.deepEqual(r.revoked, [{ token: `Bearer ${oldToken}`, saved: token }]);
  } finally { r.cleanup(); }
});

test('failed old credential revocation warns without failing setup', async () => {
  const r = rig();
  try {
    r.oldLogin(); r.failRevoke(); await r.run();
    assert.equal(r.credentials.load()?.access_token, token);
    assert.ok(r.records.some(record => record.code === 'credential_revocation_warning'));
    assert.doesNotMatch(JSON.stringify(r.records), /ftu_/);
  } finally { r.cleanup(); }
});

test('conflicting target resume revokes the newly issued credential and keeps both old files', async () => {
  const r = rig();
  try {
    r.oldLogin();
    onboardingStore(r.home, origin, project).save({ request_key: legacyProject, session_id: sessionID });
    await assert.rejects(r.run(), /onboarding_active/);
    assert.deepEqual(r.revoked, [{ token: `Bearer ${token}`, saved: oldToken }]);
    assert.equal(r.credentials.load()?.access_token, oldToken);
    assert.deepEqual(onboardingStore(r.home, origin, project).load(), { request_key: legacyProject, session_id: sessionID });
  } finally { r.cleanup(); }
});
