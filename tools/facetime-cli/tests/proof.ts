import { parseArgs } from 'node:util';
import { network, type Sample } from './fixtures/network.js';
import { Fault, safeCode } from '../src/protocol/v1.js';

try {
  const { values } = parseArgs({ options: { host: { type: 'string', default: '127.0.0.1' }, json: { type: 'boolean', default: false } }, strict: true });
  if (values.host !== '127.0.0.1') throw new Fault('forbidden');
  const n = await network();
  try {
    for (let i = 0; i < 20; i++) {
      const committed = n.frame('decision.committed');
      const call = await n.call(); await committed;
      if (call.action !== 'accept') throw new Fault('preparation_failed');
      await n.end(call.owner);
    }
    const latency: Record<string, { count: number; p50: number; p95: number; max: number }> = {};
    for (const stage of ['request_ms', 'preparation_ms', 'response_ms', 'commit_ms', 'total_ms'] as (keyof Sample)[]) {
      const sorted = n.samples.map(s => s[stage]).sort((a, b) => a - b);
      const round = (value: number) => Number(value.toFixed(3));
      latency[stage] = { count: sorted.length, p50: round(sorted[Math.ceil(sorted.length * 0.5) - 1]!), p95: round(sorted[Math.ceil(sorted.length * 0.95) - 1]!), max: round(sorted.at(-1)!) };
    }
    const result = { schema_version: 1, ok: true, kind: 'private_synthetic_loopback', node: process.version,
      sample_count: n.samples.length, commits: n.authority.commitCount, effects: n.agent.counts,
      remaining_resources: n.agent.resources.size, remaining_debt: n.connector.debt(),
      configured_budgets_ms: { preparation: 4000, authority_commit: 5000, real_mac_context_only: 6000 }, latency,
      limitations: ['No real LiveKit, provider, Mac, TLS, database or deployed relay verification.'] };
    if (result.remaining_resources !== 0 || result.remaining_debt !== 0) throw new Fault('cleanup_pending');
    console.log(values.json ? JSON.stringify(result) : JSON.stringify(result, null, 2));
  } finally { await n.close(); }
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: safeCode(error) })); process.exitCode = 1;
}
