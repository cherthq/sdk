import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

test('actual sending pipeline preserves queue ownership, durable IDs and observed delivery', async () => {
  const child = Bun.spawn([process.execPath, '--no-install', fileURLToPath(new URL('./pipeline-http.fixture.mjs', import.meta.url)), '--require-durable-ids', '--require-observed-delivery', '--require-bridge-queue', '--require-bridge-dispatched-pending', '--require-outbound-observation'], {
    stdout: 'pipe', stderr: 'pipe', env: { ...process.env, NODE_PATH: fileURLToPath(new URL('../../control-plane/node_modules', import.meta.url)) },
  });
  const timeout = setTimeout(() => child.kill(), 15000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
    const report = JSON.parse(stdout);
    expect(report).toMatchObject({ outbound_callbacks:5,native_endpoints: ['/send','/api/v1/text-operations/v1'], device_posts:20, rpc_appends:1 });
    expect(report.cases).toHaveLength(20);
    expect(report.cases.every((row: { durable: boolean }) => row.durable)).toBe(true);
    expect(report.record_failures).toEqual([{ adapter: 'sendblue', http_status: 500, retryable: false, native_attempts: 0 }, { adapter: 'linq', http_status: 500, retryable: false, native_attempts: 0 }]);
    expect(report.cases.filter((row: { mode: string }) => row.mode === 'native-queue' && (row as {protocol?:string}).protocol==='legacy-send').every((row: { durable: boolean; native_outbox_id_recorded: boolean; convo_appended: boolean }) => row.durable && row.native_outbox_id_recorded && !row.convo_appended)).toBe(true);
    expect(report.cases.filter((row: { mode: string }) => ['bridge-queue', 'bridge-dispatched-pending'].includes(row.mode) && (row as {protocol?:string}).protocol==='legacy-send').every((row: { queued_accepted: boolean; durable: boolean; bridge_outbox_id_recorded: boolean; native_outbox_id_recorded: boolean; convo_appended: boolean }) => row.queued_accepted && row.durable && row.bridge_outbox_id_recorded && !row.native_outbox_id_recorded && !row.convo_appended)).toBe(true);
    const legacy=report.cases.filter((row:{protocol:string})=>row.protocol==='legacy-send');expect(legacy).toHaveLength(4);expect(legacy.map((row:{adapter:string;mode:string})=>[row.adapter,row.mode])).toEqual([['legacy-raw','bridge'],['legacy-raw','native-queue'],['legacy-raw','bridge-queue'],['legacy-raw','bridge-dispatched-pending']]);
    expect(report.cases.filter((row:{protocol:string})=>row.protocol==='strict-text')).toHaveLength(16);
    expect(report.cases.filter((row:{protocol:string})=>row.protocol==='strict-text').every((row:{lookup_status:string;queued_accepted:boolean;convo_appended:boolean;native_outbox_id_recorded:boolean})=>row.lookup_status==='queued'&&row.queued_accepted&&!row.convo_appended&&!row.native_outbox_id_recorded)).toBe(true);
    // Legacy ownership predicates and strict operation acceptance are independently enforced.
  } finally { clearTimeout(timeout); }
}, 20000);
