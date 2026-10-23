import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { Fault, id, key, callerPartySchema, ownerSchema, sameScope, scopeSchema, type Owner, type Scope } from '../protocol/v1.js';
import { privateFile } from '../cli/config.js';
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const applicationCallSchema = z.strictObject({ operation_id: id, project_id: id, line_id: id, call_id: id, request_id: id,
  from: callerPartySchema.nullable().optional(),
  deadline_at: integer, prepare_deadline_at: integer, maximum_session_expires_at: integer,
  media: z.strictObject({ audio: z.literal(true), video: z.boolean() }) });
export const applicationEventSchema = z.strictObject({ event_id: id,
  transition: z.enum(['started', 'ended', 'failed', 'cancelled', 'reconciled_terminal']) });
export const byorEntrySchema = z.strictObject({
  owner: ownerSchema, digest: z.string().regex(/^[a-f0-9]{64}$/), call: applicationCallSchema,
  invoked: z.boolean(), session_ref: id.optional(), session_expires_at: integer.optional(),
  acceptance: z.enum(['unknown', 'accept', 'decline']), authoritative_terminal: z.boolean(), version: integer,
  cancel_requested: z.boolean(), settled: z.boolean(), cleanup: z.enum(['clean', 'pending', 'unknown']),
  events: z.array(z.strictObject({ event: applicationEventSchema, acknowledged: z.boolean() })),
});
export type ByorEntry = z.infer<typeof byorEntrySchema>;
export const byorJournalSchema = z.strictObject({ schema_version: z.literal(2), mode: z.literal('byor'),
  handler: z.strictObject({ id, module: z.string() }), scope: scopeSchema,
  entries: z.record(z.string().max(600), byorEntrySchema),
  receipts: z.record(z.string(), z.string()),
});
export type ByorSnapshot = z.infer<typeof byorJournalSchema>;
export function complete(e: ByorEntry): boolean {
  return e.authoritative_terminal && e.settled && e.cleanup === 'clean' && e.events.every(x => x.acknowledged);
}
export class ByorJournal {
  healthy = true;
  private data: ByorSnapshot;
  private lock?: number;
  constructor(scope: Scope, handler: { id: string; module: string }, readonly path?: string) {
    this.data = { schema_version: 2, mode: 'byor', handler, scope, entries: {}, receipts: {} };
    if (!path) return;
    try {
      this.lock = openSync(`${path}.lock`, 'wx', 0o600);
      writeFileSync(this.lock, JSON.stringify({ pid: process.pid })); fsyncSync(this.lock);
      if (existsSync(path)) {
        privateFile(path);
        const data = byorJournalSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
        if (!sameScope(data.scope, scope, false) || data.handler.id !== handler.id || data.handler.module !== handler.module) throw new Error();
        for (const [k, e] of Object.entries(data.entries)) {
          if (key(e.owner) !== k || !sameScope(e.owner, scope, false) || e.call.project_id !== e.owner.project_id ||
            e.call.line_id !== e.owner.line_id || e.call.call_id !== e.owner.call_id || e.call.request_id !== e.owner.request_id) throw new Error();
        }
        this.data = data;
      } else this.persist(this.data);
    } catch { this.close(); throw new Fault('journal_unavailable'); }
  }
  snapshot(): ByorSnapshot { return structuredClone(this.data); }
  get(owner: Owner): ByorEntry | undefined { return this.snapshot().entries[key(owner)]; }
  private persist(data: ByorSnapshot): void {
    if (!this.path) return;
    const temp = `${this.path}.tmp`;
    const fd = openSync(temp, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(data)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, this.path);
    const dir = openSync(dirname(this.path), 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
  }
  private update(fn: (next: ByorSnapshot) => void): void {
    if (!this.healthy) throw new Fault('journal_unavailable');
    try { const next = this.snapshot(); fn(next); byorJournalSchema.parse(next); this.persist(next); this.data = next; }
    catch { this.healthy = false; throw new Fault('journal_unavailable'); }
  }
  write(entry: ByorEntry): void { this.update(next => { next.entries[key(entry.owner)] = entry; }); }
  receipt(cursor: number, event: string): void {
    this.update(next => {
      if (next.receipts[cursor] && next.receipts[cursor] !== event) throw new Fault('request_conflict');
      next.receipts[cursor] = event;
    });
  }
  close(): void {
    this.healthy = false;
    if (this.lock !== undefined) { closeSync(this.lock); this.lock = undefined; unlinkSync(`${this.path}.lock`); }
  }
}
