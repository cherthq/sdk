#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { main as adopt } from '../adopt/src/main.js';

const help = `chert-sdk — unified Chert SDK CLI
  chert-sdk imessage send --phone +COUNTRYNUMBER --body TEXT [--idempotency-key KEY]
  chert-sdk facetime status | lines | workers
  chert-sdk adopt [path] [--write] [--install] [--json]
  chert-sdk context

Both channels use CHERT_PROJECT_ID as application context.
Set CHERT_BASE_URL and CHERT_API_KEY for iMessage; CHERT_FACETIME_URL and
CHERT_FACETIME_TOKEN for FaceTime. Credentials are service-specific, not interchangeable.
FaceTime commands inspect existing access/lines; no calls, media relay, billing,
concierge onboarding or automatic shared-line allocation is implemented.
Use --help on any channel without credentials. Output is JSON.`;

async function main() {
  const [channel, command, ...args] = process.argv.slice(2);
  if (channel === 'adopt') { process.exitCode = adopt(process.argv.slice(3)); return; }
  if (!channel || process.argv.includes('--help') || process.argv.includes('-h')) { console.log(help); return; }
  const env = process.env;
  const required = (name: string) => { const value = env[name]; if (!value?.trim()) throw new Error(`Set ${name}.`); return value; };
  const projectId = required('CHERT_PROJECT_ID');
  if (channel === 'context') {
    if (command) throw new Error('context takes no arguments');
    console.log(JSON.stringify({ projectId, channels: ['imessage', 'facetime'], credentials: 'service-specific' })); return;
  }
  if (!['imessage', 'facetime'].includes(channel!)) throw new Error('Unknown channel. Use --help.');
  // Instantiate only the selected transport; unrelated channel secrets are not required.
  const { ChertClient } = await import('@cherthq/imessage');
  const { ChertControlPlane } = await import('@cherthq/control-plane');
  let result: unknown;
  if (channel === 'imessage') {
    if (command !== 'send') throw new Error('Use imessage send.');
    const { values } = parseArgs({ args, options: { phone: { type: 'string' }, body: { type: 'string' }, 'idempotency-key': { type: 'string' } } });
    const client = new ChertClient({ baseURL: required('CHERT_BASE_URL'), apiKey: required('CHERT_API_KEY'), ...(env.CHERT_TENANT ? { tenant: env.CHERT_TENANT } : {}) });
    result = await client.sendText({ phone: values.phone!, body: values.body!, ...(values['idempotency-key'] ? { idempotency_key: values['idempotency-key'] } : {}) });
  } else {
    if (args.length || !['status', 'lines', 'workers'].includes(command!)) throw new Error('Use facetime status, lines or workers.');
    const client = new ChertControlPlane({ baseUrl: required('CHERT_FACETIME_URL'), token: required('CHERT_FACETIME_TOKEN'), projectId });
    result = command === 'lines' ? await client.listLines() : command === 'workers' ? await client.listWorkers() : await client.whoami();
  }
  console.log(JSON.stringify({ projectId, channel, data: result }));
}
main().catch(error => {
  // Do not expose server response bodies or credentials.
  console.error(JSON.stringify({ error: error instanceof Error && error.message.startsWith('Set CHERT_') ? error.message : 'Command failed. Check arguments, credentials and service access; no success is claimed.' }));
  process.exitCode = 1;
});
