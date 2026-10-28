/**
 * Replays recorded backend media-session exchanges through ChertControlPlane.createMediaSession with a fake fetch.
 *
 *   bun scripts/replay-media-fixture.ts path/to/custom-media-session-v1.json
 *
 * Accepted fixture shapes:
 * - The backend contract fixture: an object with `call_id` and `sessions[]` of `{ name, request, response, ... }`. Each
 *   session replays as `POST /api/v1/calls/{call_id}/media-sessions` with body `request`, answered by 201
 *   `{ data: response, request_id: 'fixture-<name>' }`. Other fields (`contract`, `now`, `persisted`, ...) are ignored.
 *   No clock is needed: grant validation checks RFC 3339 format and connect_by <= expires_at, not the current time.
 * - A JSON array of `{ request: { method, path, body? }, response: { status, body } }`; `path` may omit `/api/v1`.
 * Only `POST /calls/{id}/media-sessions` pairs are replayed; others are listed as skipped. For each pair the SDK's
 * outgoing method, path and JSON body must equal the recorded request, a 2xx response must pass the SDK's grant
 * validation, and an error response must carry a code the SDK surfaces (not `request_failed`). Any mismatch exits non-zero.
 */
import { isDeepStrictEqual } from 'node:util';
import { ChertApiError, ChertControlPlane, type CreateMediaSession } from '../packages/control-plane/index';

interface Pair { request: { method: string; path: string; body?: unknown }; response: { status: number; body: unknown } }

const file = process.argv[2];
if (!file) { console.error('Usage: bun scripts/replay-media-fixture.ts <fixture.json>'); process.exit(2); }
const raw = JSON.parse(await Bun.file(file).text()) as unknown;
const contract = raw as { call_id?: unknown; sessions?: { name: string; request: unknown; response: unknown }[] } | null;
const fixture: Pair[] = Array.isArray(raw) ? raw
  : contract && typeof contract.call_id === 'string' && Array.isArray(contract.sessions)
    ? contract.sessions.map(s => ({ request: { method: 'POST', path: `/api/v1/calls/${encodeURIComponent(contract.call_id as string)}/media-sessions`, body: s.request },
      response: { status: 201, body: { data: s.response, request_id: `fixture-${s.name}` } } }))
    : (() => { throw new TypeError('Fixture must be a {call_id, sessions} contract object or an array of {request, response} pairs.'); })();

const route = /^(?:\/api\/v1)?\/calls\/([^/]+)\/media-sessions$/;
let failures = 0;
for (const [index, pair] of fixture.entries()) {
  const label = `#${index} ${pair?.request?.method} ${pair?.request?.path}`;
  const match = pair?.request?.method?.toUpperCase() === 'POST' ? route.exec(pair.request.path) : null;
  if (!match || typeof pair.response?.status !== 'number') { console.log(`skip ${label}`); continue; }
  const expectedPath = pair.request.path.startsWith('/api/v1/') ? pair.request.path : `/api/v1${pair.request.path}`;
  const mismatches: string[] = [];
  const client = new ChertControlPlane({ baseUrl: 'https://replay.example', token: 'replay-token', projectId: 'replay-project',
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      const sent = { method: init?.method, path: new URL(String(url)).pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined };
      if (sent.method !== 'POST' || sent.path !== expectedPath) mismatches.push(`request ${sent.method} ${sent.path}`);
      if (pair.request.body !== undefined && !isDeepStrictEqual(sent.body, pair.request.body)) mismatches.push(`body ${JSON.stringify(sent.body)}`);
      return new Response(JSON.stringify(pair.response.body), { status: pair.response.status, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch });
  const input = (pair.request.body ?? {}) as CreateMediaSession;
  const recordedCode = (pair.response.body as { error?: { code?: unknown } } | null)?.error?.code;
  let outcome: string;
  try {
    const grant = await client.createMediaSession(decodeURIComponent(match[1]!), input);
    outcome = `grant ${grant.direction} ${grant.codecs.join(',')}`;
    if (pair.response.status < 200 || pair.response.status > 299) mismatches.push('non-2xx response resolved');
  } catch (error) {
    if (!(error instanceof ChertApiError)) { outcome = `local ${(error as Error).name}: ${(error as Error).message}`; mismatches.push('rejected before HTTP'); }
    else {
      outcome = `error ${error.status} ${error.code}`;
      if (pair.response.status >= 200 && pair.response.status <= 299) mismatches.push('2xx grant failed SDK validation');
      else if (error.code !== recordedCode) mismatches.push(`code ${String(recordedCode)} surfaced as ${error.code}`);
    }
  }
  if (mismatches.length) failures++;
  console.log(`${mismatches.length ? 'FAIL' : 'ok  '} ${label} -> ${outcome}${mismatches.length ? ` (${mismatches.join('; ')})` : ''}`);
}
if (failures) { console.error(`${failures} replayed exchange(s) did not match the SDK contract.`); process.exit(1); }
