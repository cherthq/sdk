import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { credentialStore, startLoginCallback, whoami, logout } from '../../src/cli/login.js';

const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJl';
const future = () => Date.now() + 3600_000;
function temp() { const root = mkdtempSync(join(tmpdir(), 'chert-login-edge-')); return { dir: join(root, 'chert'), root, close: () => rmSync(root, { recursive: true, force: true }) }; }

test('store: a credential file readable by others is treated as absent', () => {
  const t = temp();
  try {
    const store = credentialStore(t.dir); store.save({ access_token: token, expires_at: future() });
    chmodSync(join(t.dir, 'credentials.json'), 0o644);
    assert.equal(store.load(), undefined); assert.equal(whoami(store).signed_in, false);
  } finally { t.close(); }
});

test('store: a symbolic link in place of the credential file is not followed', () => {
  const t = temp();
  try {
    const store = credentialStore(t.dir); store.save({ access_token: token, expires_at: future() });
    const real = join(t.root, 'elsewhere.json'); writeFileSync(real, readFileSync(join(t.dir, 'credentials.json')), { mode: 0o600 });
    rmSync(join(t.dir, 'credentials.json')); symlinkSync(real, join(t.dir, 'credentials.json'));
    assert.equal(store.load(), undefined);
  } finally { t.close(); }
});

test('store: saving again replaces the session and corrupt content is treated as absent', () => {
  const t = temp();
  try {
    const store = credentialStore(t.dir);
    store.save({ access_token: token, expires_at: future(), email: 'one@example.test' });
    store.save({ access_token: token, expires_at: future(), email: 'two@example.test' });
    assert.equal(whoami(store).email, 'two@example.test');
    writeFileSync(join(t.dir, 'credentials.json'), '{not json', { mode: 0o600 });
    assert.equal(store.load(), undefined);
  } finally { t.close(); }
});

test('store: a token with a line break or an unknown field is refused', () => {
  const t = temp();
  try {
    const store = credentialStore(t.dir);
    assert.throws(() => store.save({ access_token: `${token}\nX-Injected: 1`, expires_at: future() }));
    assert.throws(() => store.save({ access_token: token, expires_at: future(), extra: 1 } as never));
  } finally { t.close(); }
});

test('logout: with nothing stored it still succeeds and calls no revocation', async () => {
  const t = temp();
  try {
    let called = 0;
    assert.deepEqual(await logout(credentialStore(t.dir), async () => { called++; }), { signed_out: true, revoked: false });
    assert.equal(called, 0);
  } finally { t.close(); }
});

const post = (url: string, body: string, headers: Record<string, string> = { 'content-type': 'application/json' }) => fetch(url, { method: 'POST', headers, body });
test('callback: wrong path, oversized, non-JSON and incomplete bodies are rejected and do not complete the login', async () => {
  const login = await startLoginCallback({ state: 'state_abc', timeoutMs: 400 });
  const outcome = login.result.then(() => 'resolved', error => String((error as Error).message));
  try {
    assert.equal((await post(login.url.replace('/callback', '/other'), JSON.stringify({ state: 'state_abc', access_token: token, expires_at: future() }))).status, 400);
    assert.equal((await post(login.url, 'x'.repeat(40_000)).catch(() => ({ status: 400 }))).status, 400);
    assert.equal((await post(login.url, 'not json')).status, 400);
    assert.equal((await post(login.url, JSON.stringify({ state: 'state_abc' }))).status, 400);
    assert.equal((await post(login.url, JSON.stringify({ state: 'state_abc', access_token: 'a\nb', expires_at: future() }))).status, 400);
    assert.equal(await outcome, 'login_timeout');
  } finally { login.close(); }
});

test('callback: after a successful login the server stops accepting requests', async () => {
  const login = await startLoginCallback({ state: 'state_abc', timeoutMs: 2000 });
  try {
    assert.equal((await post(login.url, JSON.stringify({ state: 'state_abc', access_token: token, expires_at: future() }))).status, 200);
    await login.result;
    await assert.rejects(post(login.url, JSON.stringify({ state: 'state_abc', access_token: token, expires_at: future() })));
  } finally { login.close(); }
});

test('callback: each login listens on its own port', async () => {
  const a = await startLoginCallback({ state: 'a', timeoutMs: 200 }); const b = await startLoginCallback({ state: 'b', timeoutMs: 200 });
  a.result.catch(() => {}); b.result.catch(() => {});
  try { assert.notEqual(a.url, b.url); } finally { a.close(); b.close(); }
});
