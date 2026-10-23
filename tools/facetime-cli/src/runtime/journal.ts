import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { Fault, id, key, ownerSchema, scopeSchema, sameScope, type Owner, type Scope } from '../protocol/v1.js';

export const entrySchema = z.strictObject({
  owner: ownerSchema, digest: z.string().regex(/^[a-f0-9]{64}$/),
  room: id, job: id, marker: id, nonce: id, participant: id,
  resource_expires_at: z.number().int().positive(),
  state: z.enum(['intent', 'prepared', 'decision_sent', 'accepted', 'declined', 'terminal']),
  version: z.number().int().nonnegative(), terminal: z.boolean(),
  cleanup_debt: z.boolean(), reconcile_debt: z.boolean(), create_pending: z.boolean(),
  bridge_seen: z.boolean(),
});
export type Entry = z.infer<typeof entrySchema>;
export const journalSchema = z.strictObject({
  schema_version: z.literal(1), scope: scopeSchema, entries: z.record(z.string().max(600), entrySchema),
  tombstones: z.record(z.string().max(600), z.strictObject({ owner: ownerSchema, version: z.number().int().nonnegative() })),
  cursor: z.number().int().nonnegative(), receipts: z.record(z.string().regex(/^\d+$/), id),
});
export type Snapshot = z.infer<typeof journalSchema>;
export interface Journal {
  healthy: boolean;
  snapshot(): Snapshot;
  get(owner: Owner): Entry | undefined;
  write(entry: Entry): void;
  receipt(cursor: number, event: string): void;
  tombstone(owner: Owner, version: number): void;
  close(): void;
}
export class MemoryJournal implements Journal {
  healthy = true;
  protected data: Snapshot;
  constructor(scope: Scope, initial?: Snapshot) {
    this.data = initial ? journalSchema.parse(initial) : { schema_version: 1, scope, entries: {}, tombstones: {}, cursor: 0, receipts: {} };
  }
  snapshot(): Snapshot { return structuredClone(this.data); }
  get(owner: Owner): Entry | undefined { return this.snapshot().entries[key(owner)]; }
  protected persist(_data: Snapshot): void { /* Memory fixture. */ }
  protected update(mutator: (data: Snapshot) => void): void {
    if (!this.healthy) throw new Fault('journal_unavailable');
    try {
      const next = this.snapshot(); mutator(next);
      const checked = journalSchema.parse(next); this.persist(checked); this.data = checked;
    } catch { this.healthy = false; throw new Fault('journal_unavailable'); }
  }
  write(entry: Entry): void { this.update(data => { data.entries[key(entry.owner)] = entry; }); }
  tombstone(owner: Owner, version: number): void {
    this.update(data => {
      const old = data.tombstones[key(owner)];
      data.tombstones[key(owner)] = { owner, version: Math.max(old?.version ?? 0, version) };
    });
  }
  receipt(cursor: number, event: string): void {
    this.update(data => {
      if (data.receipts[cursor] && data.receipts[cursor] !== event) throw new Fault('journal_unavailable');
      data.receipts[cursor] = event;
      while (data.receipts[data.cursor + 1]) data.cursor++;
    });
  }
  close(): void { this.healthy = false; }
}

/** POSIX proof only. Dead writer recovery is explicit and never rewrites data. */
export class FileJournal extends MemoryJournal {
  private lockFd: number;
  private closed = false;
  failAt?: 'before_rename' | 'after_rename';
  constructor(readonly path: string, scope: Scope) {
    super(scope);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    try { this.lockFd = openSync(`${path}.lock`, 'wx', 0o600); } catch { throw new Fault('journal_unavailable'); }
    try {
      writeFileSync(this.lockFd, JSON.stringify({ pid: process.pid })); fsyncSync(this.lockFd);
      if (existsSync(path)) {
        const parsed = journalSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
        const { connection_generation: _oldGeneration, ...old } = parsed.scope;
        if (!sameScope(parsed.scope, scope, false)) throw new Error();
        for (const [k, entry] of [...Object.entries(parsed.entries), ...Object.entries(parsed.tombstones)]) {
          if (k !== key(entry.owner) || !Object.entries(old).every(([name, value]) => entry.owner[name as keyof Owner] === value)) throw new Error();
        }
        this.data = parsed;
      } else this.persist(this.data);
    } catch {
      this.close(); throw new Fault('journal_unavailable');
    }
  }
  protected override persist(data: Snapshot): void {
    const tmp = `${this.path}.tmp`;
    let fd: number | undefined;
    try {
      fd = openSync(tmp, 'w', 0o600); writeFileSync(fd, JSON.stringify(data)); fsyncSync(fd); closeSync(fd); fd = undefined;
      if (this.failAt === 'before_rename') throw new Error();
      renameSync(tmp, this.path);
      if (this.failAt === 'after_rename') throw new Error();
      const dir = openSync(dirname(this.path), 'r');
      try { fsyncSync(dir); } finally { closeSync(dir); }
    } finally {
      if (fd !== undefined) closeSync(fd);
      if (existsSync(tmp)) unlinkSync(tmp);
    }
  }
  override close(): void {
    if (this.closed) return;
    this.closed = true; this.healthy = false;
    closeSync(this.lockFd); unlinkSync(`${this.path}.lock`);
  }
  static recoverDeadWriter(path: string): void {
    let recovery: number;
    try { recovery = openSync(`${path}.recovery`, 'wx', 0o600); } catch { throw new Fault('journal_unavailable'); }
    try {
      const parsed = z.strictObject({ pid: z.number().int().positive() }).parse(JSON.parse(readFileSync(`${path}.lock`, 'utf8')));
      try { process.kill(parsed.pid, 0); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') { unlinkSync(`${path}.lock`); return; }
      }
      throw new Fault('journal_unavailable');
    } catch { throw new Fault('journal_unavailable'); }
    finally { closeSync(recovery); unlinkSync(`${path}.recovery`); }
  }
}
