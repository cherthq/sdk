import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { hookSchema } from './livekit-hook.js';
import { auditSchema } from './livekit-operation.js';
import { entrySchema, type Entry } from '../runtime/journal.js';
const receiptSchema = z.strictObject({
  entry: entrySchema,
  target: z.strictObject({ project: z.string(), name: z.string(), deployment: z.string(), boot: z.string() }).optional(),
  phase: z.enum(['intent', 'room_pending', 'room_ack', 'dispatch_pending', 'dispatch_ack', 'ready', 'clean', 'room_not_sent', 'dispatch_not_sent']),
  audit: z.array(auditSchema).max(16).optional(),
  topology: z.literal('room_agent').optional(), dispatchDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  actualWorker: z.string().optional(),
  cleanup: z.array(z.strictObject({ kind: z.enum(['cancelled', 'ended', 'unassigned', 'dispatch_deleted', 'room_deleted', 'absent']),
    at: z.number().int().positive(), roomSid: z.string().optional(), dispatchId: z.string().optional(), observation: hookSchema.optional() })).max(6).optional(),
  roomSid: z.string().optional(), dispatchId: z.string().optional(), actualJob: z.string().optional(),
}).superRefine((receipt, context) => {
  if (!receipt.phase.endsWith('_not_sent')) return;
  const last = receipt.audit?.at(-1), previous = receipt.audit?.at(-2);
  const operation = receipt.phase === 'room_not_sent' ? 'room' : 'dispatch';
  if (last?.phase !== 'not_sent' || last.operation !== operation || !last.validation || !last.diagnostic ||
      previous?.phase !== 'pending' || previous.operation !== operation || previous.input_timeout_ms !== last.input_timeout_ms) {
    context.addIssue({ code: 'custom', message: 'Missing pre-send evidence' });
  }
});
export type AdapterReceipt = z.infer<typeof receiptSchema>;
// Uses the connector journal's exclusive writer lock; path must be in its
// owner-only directory. Pending phases remain uncertain across process restart.
export class AdapterReceipts {
  private values: Record<string, AdapterReceipt>;
  healthy = true;
  constructor(private path?: string) {
    this.values = path && existsSync(path) ? z.record(z.string(), receiptSchema).parse(JSON.parse(readFileSync(path, 'utf8'))) : {};
  }
  get(entry: Entry): AdapterReceipt | undefined { return structuredClone(this.values[entry.marker]); }
  put(value: AdapterReceipt): void {
    if (!this.healthy) throw new Error('adapter_receipts_unavailable');
    const parsed = receiptSchema.parse(value);
    const prior = this.values[parsed.entry.marker]?.audit ?? [];
    if (JSON.stringify(parsed.audit?.slice(0, prior.length) ?? []) !== JSON.stringify(prior)) throw new Error('adapter_audit_conflict');
    const previous = this.values[parsed.entry.marker];
    const cleanup = previous?.cleanup ?? [];
    if (JSON.stringify(parsed.cleanup?.slice(0, cleanup.length) ?? []) !== JSON.stringify(cleanup)) throw new Error('adapter_cleanup_conflict');
    for (const field of ['target', 'topology', 'dispatchDigest', 'roomSid', 'dispatchId', 'actualJob', 'actualWorker'] as const) {
      if (previous?.[field] !== undefined && JSON.stringify(previous[field]) !== JSON.stringify(parsed[field])) throw new Error('adapter_identity_conflict');
    }
    const next = { ...this.values, [parsed.entry.marker]: structuredClone(parsed) };
    if (!this.path) { this.values = next; return; }
    try {
      const fd = openSync(`${this.path}.tmp`, 'w', 0o600);
      try { writeFileSync(fd, JSON.stringify(next)); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(`${this.path}.tmp`, this.path);
      const dir = openSync(dirname(this.path), 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
    } catch {
      // Rename may already have committed newer evidence. Never retry from the
      // stale in-memory prefix and overwrite that evidence; require reopen.
      this.healthy = false; throw new Error('adapter_receipts_unavailable');
    }
    this.values = next;
  }
}
