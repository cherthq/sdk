import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { credentialStore, startLoginCallback, logout, whoami } from '../../src/cli/login.js';

const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl';
function temp() { return mkdtempSync(join(tmpdir(), 'chert-login-')); }

test('login: the credential is stored owner-only and status never prints it', () => {
  const root = temp();
  try {
    const dir = join(root, 'chert');
    const store = credentialStore(dir);
    store.save({ access_token: token, expires_at: Date.now() + 3600_000, email: 'dev@example.test' });
    const file = join(dir, 'credentials.json');
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const status = whoami(store);
    assert.equal(status.signed_in, true);
    assert.equal(status.email, 'dev@example.test');
    assert.ok(!JSON.stringify(status).includes(token));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('login: an expired credential reports signed out', () => {
  const root = temp();
  try {
    const store = credentialStore(join(root, 'chert'));
    store.save({ access_token: token, expires_at: Date.now() - 1000 });
    assert.equal(whoami(store).signed_in, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('login: the browser callback listens on loopback only and accepts a POST with the matching state', async () => {
  const login = await startLoginCallback({ state: 'state_abc', timeoutMs: 2000 });
  try {
    const callback = new URL(login.url);
    assert.equal(callback.hostname, '127.0.0.1');
    const response = await fetch(login.url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'state_abc', access_token: token, expires_at: Date.now() + 3600_000 }) });
    assert.equal(response.status, 200);
    const result = await login.result;
    assert.equal(result.access_token, token);
  } finally { login.close(); }
});

test('login: the callback rejects a wrong state and a token placed in the URL', async () => {
  const login = await startLoginCallback({ state: 'state_abc', timeoutMs: 2000 });
  login.result.catch(() => {});
  try {
    const wrong = await fetch(login.url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'other', access_token: token, expires_at: Date.now() + 3600_000 }) });
    assert.equal(wrong.status, 400);
    const inUrl = await fetch(`${login.url}?state=state_abc&access_token=${token}`);
    assert.equal(inUrl.status, 400);
  } finally { login.close(); }
});

test('login: the callback gives up after the timeout', async () => {
  const login = await startLoginCallback({ state: 'state_abc', timeoutMs: 50 });
  try { await assert.rejects(login.result, /login_timeout/); }
  finally { login.close(); }
});

test('logout: revokes on the server, then removes the local credential', async () => {
  const root = temp();
  try {
    const store = credentialStore(join(root, 'chert'));
    store.save({ access_token: token, expires_at: Date.now() + 3600_000 });
    const revoked: string[] = [];
    assert.deepEqual(await logout(store, async value => { revoked.push(value); }), { signed_out: true, revoked: true });
    assert.deepEqual(revoked, [token]);
    assert.equal(existsSync(join(root, 'chert', 'credentials.json')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('logout: a failed revocation still removes the local credential and says so', async () => {
  const root = temp();
  try {
    const dir = join(root, 'chert');
    const store = credentialStore(dir);
    store.save({ access_token: token, expires_at: Date.now() + 3600_000 });
    assert.deepEqual(await logout(store, async () => { throw new Error('offline'); }), { signed_out: true, revoked: false });
    assert.equal(existsSync(join(dir, 'credentials.json')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
