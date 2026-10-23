import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ApplicationCall, ApplicationDecision, ApplicationEvent, RecoveryContext } from '@trychert/facetime/byor';

// Small application-owned ready-session mailbox. Substitute your application's
// existing transactional session store here. The package never reads this file.
// A separate application session owner provisions a ready room and updates state
// to cleaned ONLY after its own verified teardown. No room is created by example.
interface Session {
  session_ref: string; state: 'ready' | 'claimed' | 'cleaned';
  operation_id?: string; call_id?: string; cancel_requested?: boolean;
  session_expires_at: number; livekit_url: string; participant_token: string;
  remote_participant_identity: string; events?: ApplicationEvent[];
}
function path(): string {
  const p = process.env.BYOR_APPLICATION_SESSION_FILE;
  if (!p) throw Error('application_unconfigured');
  return p;
}
function read(): Session {
  const p = path(), stat = lstatSync(p);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || stat.size > 32768) throw Error('private_application_state_required');
  return JSON.parse(readFileSync(p, 'utf8')) as Session;
}
function save(value: Session): void {
  const p = path(); const fd = openSync(p + '.tmp', 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(p + '.tmp', p);
  const dir = openSync(dirname(p), 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
}
// This example's synchronous mutations assume a single application writer, as
// does its ready-session provisioning. Use transactional storage for concurrency.
export const sessions = {
  async health(): Promise<'available' | 'unavailable' | 'unknown'> {
    try { return read().state === 'ready' ? 'available' : 'unavailable'; } catch { return 'unknown'; }
  },
  async claim(call: ApplicationCall, context: { signal: AbortSignal; remaining_ms: number }): Promise<ApplicationDecision> {
    const s = read();
    if (context.signal.aborted || Date.now() >= call.prepare_deadline_at || context.remaining_ms <= 0 ||
      s.state !== 'ready' || s.operation_id || s.session_expires_at <= call.deadline_at) return { action: 'decline' };
    // Durable application ownership precedes returning any call credentials.
    save({ ...s, state: 'claimed', operation_id: call.operation_id, call_id: call.call_id });
    return { action: 'accept', ready: true, session_ref: s.session_ref, session_expires_at: s.session_expires_at,
      livekit_url: s.livekit_url, participant_token: s.participant_token, remote_participant_identity: s.remote_participant_identity };
  },
  async deliver(operation: string, event: ApplicationEvent): Promise<{ acknowledged: boolean }> {
    const s = read();
    if (s.operation_id !== operation) return { acknowledged: false };
    if (!(s.events ?? []).some(e => e.event_id === event.event_id)) save({ ...s, events: [...(s.events ?? []), event] });
    return { acknowledged: true }; // Only application delivery, never cleanup proof.
  },
  async recover(operation: string, context: RecoveryContext) {
    const s = read();
    if (s.operation_id !== operation) return { settled: false, cleanup: 'unknown' as const };
    if (context.cancel_requested && !s.cancel_requested) save({ ...s, cancel_requested: true });
    return { session_ref: s.session_ref, settled: true, cleanup: s.state === 'cleaned' ? 'clean' as const : 'pending' as const };
  },
};
