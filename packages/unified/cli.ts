#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { main as adopt } from '../adopt/src/main.js';

const help = `chert-sdk — unified Chert SDK CLI
  chert-sdk imessage send --phone +COUNTRYNUMBER --body TEXT --idempotency-key KEY --confirm
  chert-sdk facetime status | lines | workers
  chert-sdk adopt [path] [--write] [--install] [--json]
  chert-sdk context

Both channels use CHERT_PROJECT_ID as application context.
Set CHERT_API_KEY for iMessage; CHERT_FACETIME_TOKEN for FaceTime.
iMessage defaults to https://console.trychert.com; CHERT_BASE_URL optionally overrides it.
FaceTime defaults to https://facetime.trychert.com; CHERT_FACETIME_URL optionally
overrides the origin. Credentials are service-specific, not interchangeable.
FaceTime commands inspect existing access/lines; no calls, media relay, billing,
concierge onboarding or automatic shared-line allocation is implemented.
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
  const unknown = channel === 'context' ? command !== undefined
    : channel === 'imessage' ? command !== 'send'
    : channel === 'facetime' ? args.length > 0 || !['status', 'lines', 'workers'].includes(command!)
    : true;
  if (unknown) throw Object.assign(new Error(), { code: 'unknown_command' });
  const env = process.env;
  const required = (name: string) => { const value = env[name]; if (!value?.trim()) throw new Error(`Set ${name}.`); return value; };
  const projectId = required('CHERT_PROJECT_ID');
  if (channel === 'context') {
    console.log(JSON.stringify({ projectId, channels: ['imessage', 'facetime'], credentials: 'service-specific' })); return;
  }
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
  } else {
    const client = new ChertControlPlane({ baseUrl: env.CHERT_FACETIME_URL, token: required('CHERT_FACETIME_TOKEN'), projectId });
    result = command === 'lines' ? await client.listLines() : command === 'workers' ? await client.listWorkers() : await client.whoami();
  }
  console.log(JSON.stringify({ projectId, channel, data: result }));
}
main().catch(error => {
  // Do not expose server response bodies or credentials.
  const code = safeErrorCode(error);
  const message = code === 'unknown_command' ? 'Unknown command. Use --help.'
    : error instanceof Error && error.message.startsWith('Set CHERT_') ? error.message : 'Command failed. Check arguments, credentials and service access; no success is claimed.';
  console.error(JSON.stringify({ error: message, ...(code ? { code } : {}) }));
  process.exitCode = 1;
});
