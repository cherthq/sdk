#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { main as adopt } from '../adopt/src/main.js';
import { SDK_VERSION } from '../adopt/src/providers.js';

const DOCS = 'https://github.com/cherthq/sdk/blob/main';

const help = `chert-sdk — unified Chert SDK CLI
  chert-sdk imessage send --phone +COUNTRYNUMBER --body TEXT --idempotency-key KEY --confirm
  chert-sdk facetime status | lines | workers
  chert-sdk billing status
  chert-sdk billing card | cancel --idempotency-key KEY --confirm
  chert-sdk billing buy | switch --plan shared|dedicated --idempotency-key KEY --confirm
  chert-sdk adopt [path] [--write] [--install] [--json]
  chert-sdk context [--offline]

context prints SDK, credential, account and documentation context for coding
agents. It reads FaceTime identity and lines (read-only) when CHERT_FACETIME_TOKEN
and CHERT_PROJECT_ID are set; --offline skips every request.
Setup guide: ${DOCS}/docs/SETUP.md
For browser login and putting a LiveKit voice or video agent on a FaceTime line,
use the separate @trychert/facetime CLI (chert).

Both channels use CHERT_PROJECT_ID as application context.
Set CHERT_API_KEY for iMessage; CHERT_FACETIME_TOKEN for FaceTime.
iMessage defaults to https://console.trychert.com; CHERT_BASE_URL optionally overrides it.
FaceTime defaults to https://facetime.trychert.com; CHERT_FACETIME_URL optionally
overrides the origin. Credentials are service-specific, not interchangeable.
FaceTime commands inspect existing access/lines; no calls, media relay,
concierge onboarding or automatic shared-line allocation is implemented.
Billing (draft backend contract) uses CHERT_FACETIME_TOKEN with the billing scope;
the backend refuses CLI credentials for billing until it ships.
buy/switch charge the saved card; when a card or authentication is needed the
output carries a Stripe-hosted url to open, then rerun billing status. A pending
status means rerun the same command with the same idempotency key.
Use --help on any channel without credentials. iMessage send requires an
explicit --confirm and a caller-supplied stable idempotency key. Output is JSON.`;

function safeErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : undefined;
}

async function main() {
  const [channel, command, ...args] = process.argv.slice(2);
  if (channel === 'adopt') { process.exitCode = adopt(process.argv.slice(3)); return; }
  if (!channel || process.argv.includes('--help') || process.argv.includes('-h')) { console.log(help); return; }
  // Reject unknown commands before asking for credentials, so typos are not reported as missing configuration.
  const unknown = channel === 'context' ? (command !== undefined && command !== '--offline') || args.length > 0
    : channel === 'imessage' ? command !== 'send'
    : channel === 'facetime' ? args.length > 0 || !['status', 'lines', 'workers'].includes(command!)
    : channel === 'billing' ? !['status', 'card', 'buy', 'switch', 'cancel'].includes(command!) || (command === 'status' && args.length > 0)
    : true;
  if (unknown) throw Object.assign(new Error(), { code: 'unknown_command' });
  const env = process.env;
  const required = (name: string) => { const value = env[name]; if (!value?.trim()) throw new Error(`Set ${name}.`); return value; };
  if (channel === 'context') { console.log(JSON.stringify(await context(env, command === '--offline'))); return; }
  const projectId = required('CHERT_PROJECT_ID');
  // Instantiate only the selected transport; unrelated channel secrets are not required.
  const { ChertClient } = await import('@cherthq/imessage');
  const { ChertControlPlane } = await import('@cherthq/control-plane');
  let result: unknown;
  if (channel === 'imessage') {
    const { values } = parseArgs({ args, options: { phone: { type: 'string' }, body: { type: 'string' }, 'idempotency-key': { type: 'string' }, confirm: { type: 'boolean' } } });
    if (!values.phone?.trim() || !values.body?.trim()) throw Object.assign(new Error(), { code: 'invalid_request' });
    if (values['idempotency-key'] === undefined) throw Object.assign(new Error(), { code: 'idempotency_key_required' });
    if (!/^[\x21-\x7e]{8,200}$/.test(values['idempotency-key'])) throw Object.assign(new Error(), { code: 'invalid_idempotency_key' });
    if (!values.confirm) throw Object.assign(new Error(), { code: 'send_confirmation_required' });
    const client = new ChertClient({ baseURL: env.CHERT_BASE_URL, apiKey: required('CHERT_API_KEY'), ...(env.CHERT_TENANT ? { tenant: env.CHERT_TENANT } : {}) });
    result = await client.sendText({ phone: values.phone, body: values.body, idempotency_key: values['idempotency-key'] });
  } else if (channel === 'billing') {
    const { values } = parseArgs({ args, options: { plan: { type: 'string' }, 'idempotency-key': { type: 'string' }, confirm: { type: 'boolean' } } });
    const mutation = command !== 'status';
    if (mutation) {
      if ((command === 'buy' || command === 'switch') !== (values.plan !== undefined) || (values.plan !== undefined && !['shared', 'dedicated'].includes(values.plan)))
        throw Object.assign(new Error(), { code: 'invalid_request' });
      if (values['idempotency-key'] === undefined) throw Object.assign(new Error(), { code: 'idempotency_key_required' });
      if (!/^[\x21-\x7e]{8,200}$/.test(values['idempotency-key'])) throw Object.assign(new Error(), { code: 'invalid_idempotency_key' });
      if (!values.confirm) throw Object.assign(new Error(), { code: 'billing_confirmation_required' });
    }
    const client = new ChertControlPlane({ baseUrl: env.CHERT_FACETIME_URL, token: required('CHERT_FACETIME_TOKEN'), projectId });
    const key = values['idempotency-key']!, plan = values.plan as 'shared' | 'dedicated';
    result = command === 'status' ? await client.billingStatus()
      : command === 'card' ? await client.paymentMethodSetup(key)
      : command === 'buy' ? await client.purchase({ plan }, key)
      : command === 'switch' ? await client.changePlan({ plan }, key)
      : await client.cancelSubscription(key);
  } else {
    const client = new ChertControlPlane({ baseUrl: env.CHERT_FACETIME_URL, token: required('CHERT_FACETIME_TOKEN'), projectId });
    result = command === 'lines' ? await client.listLines() : command === 'workers' ? await client.listWorkers() : await client.whoami();
  }
  console.log(JSON.stringify({ projectId, channel, data: result }));
}
/** Report only a plain origin: a URL carrying userinfo, a query or a fragment may hold a credential. */
function safeOrigin(value: string | undefined, fallback: string): string {
  if (!value?.trim()) return fallback;
  try { const url = new URL(value.trim()); return url.username || url.password || url.search || url.hash ? 'invalid' : url.origin; }
  catch { return 'invalid'; }
}

/** Never includes credential values: only whether each variable is set. */
async function context(env: NodeJS.ProcessEnv, offline: boolean) {
  const set = (name: string) => Boolean(env[name]?.trim());
  const projectId = set('CHERT_PROJECT_ID') ? env.CHERT_PROJECT_ID!.trim() : null;
  const llmsFile = fileURLToPath(new URL('../../llms.txt', import.meta.url));
  let facetimeAccount: unknown = null;
  if (!offline && projectId && set('CHERT_FACETIME_TOKEN')) {
    const { ChertControlPlane } = await import('@cherthq/control-plane');
    const failed = (error: unknown) => ({ error: safeErrorCode(error) ?? 'request_failed' });
    try {
      const client = new ChertControlPlane({ baseUrl: env.CHERT_FACETIME_URL, token: env.CHERT_FACETIME_TOKEN!, projectId });
      const read = <T>(request: Promise<T>) => request.then(data => ({ data }), failed);
      const [identity, lines] = await Promise.all([read(client.whoami()), read(client.listLines())]);
      facetimeAccount = { identity, lines };
    } catch (error) { facetimeAccount = failed(error); }
  }
  return {
    projectId, channels: ['imessage', 'facetime'], credentials: 'service-specific', sdk: { package: '@trychert/sdk', version: SDK_VERSION },
    configured: {
      imessage: { CHERT_API_KEY: set('CHERT_API_KEY'), CHERT_TENANT: set('CHERT_TENANT'), origin: safeOrigin(env.CHERT_BASE_URL, 'https://console.trychert.com') },
      facetime: { CHERT_FACETIME_TOKEN: set('CHERT_FACETIME_TOKEN'), origin: safeOrigin(env.CHERT_FACETIME_URL, 'https://facetime.trychert.com') },
    },
    missing: ['CHERT_PROJECT_ID', 'CHERT_API_KEY', 'CHERT_FACETIME_TOKEN'].filter(name => !set(name)),
    account: { facetime: offline ? 'skipped' : facetimeAccount ?? 'not_configured', imessage: 'not_inspected' },
    commands: ['imessage send', 'facetime status', 'facetime lines', 'facetime workers', 'billing status (draft)', 'billing card (draft)', 'billing buy (draft)', 'billing switch (draft)', 'billing cancel (draft)', 'adopt', 'context'],
    docs: { setup: `${DOCS}/docs/SETUP.md`, llms: `${DOCS}/llms.txt`, ...(existsSync(llmsFile) ? { llmsFile } : {}), readme: `${DOCS}/README.md`,
      compatibility: `${DOCS}/COMPATIBILITY.md` },
    agentCli: { package: '@trychert/facetime', bin: 'chert', use: 'Browser login and putting a LiveKit voice or video agent on a FaceTime line' },
    media: 'FaceTime calls can carry audio and video. Video depends on the line (supports_video) and on your agent publishing a camera track; this SDK does not relay media.',
  };
}

main().catch(error => {
  // Do not expose server response bodies or credentials.
  const code = safeErrorCode(error);
  const message = code === 'unknown_command' ? 'Unknown command. Use --help.'
    : error instanceof Error && error.message.startsWith('Set CHERT_') ? error.message : 'Command failed. Check arguments, credentials and service access; no success is claimed.';
  console.error(JSON.stringify({ error: message, ...(code ? { code } : {}) }));
  process.exitCode = 1;
});
