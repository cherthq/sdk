import type { CallerParty } from '../protocol/v1.js';
/** Application-owned sessions. These callbacks never implement the Chert receiver. */
export interface ApplicationCall {
  from?: CallerParty | null;
  operation_id: string;
  project_id: string; line_id: string; call_id: string; request_id: string;
  deadline_at: number; prepare_deadline_at: number; maximum_session_expires_at: number;
  media: { audio: true; video: boolean };
}
export type ApplicationDecision = { action: 'decline' } | {
  action: 'accept'; ready: true; session_ref: string; session_expires_at: number;
  livekit_url: string; participant_token: string; remote_participant_identity: string;
};
export interface ApplicationEvent {
  event_id: string;
  transition: 'started' | 'ended' | 'failed' | 'cancelled' | 'reconciled_terminal';
}
export interface RecoveryContext {
  session_ref?: string;
  authoritative_terminal: boolean;
  acceptance: 'unknown' | 'accept' | 'decline';
  cancel_requested: boolean;
}
export interface ByorHandler {
  version: 1;
  /** Non-allocating. Unknown permits per-call preparation, but never means ready. */
  health?(): Promise<'available' | 'unavailable' | 'unknown'>;
  /** Persist operation_id in the application before performing any side effect. */
  prepare(call: ApplicationCall, context: { signal: AbortSignal; remaining_ms: number }): Promise<ApplicationDecision>;
  /** Idempotent by event_id. Acknowledgment is NOT cleanup proof. */
  lifecycle?(call: ApplicationCall, event: ApplicationEvent, context: RecoveryContext): Promise<{ acknowledged: boolean }>;
  /** Idempotent lookup/cancel of the original operation, never repeat preparation.
   * Also called during routine reconciliation of active or uncertain calls:
   * preserve resources unless authoritative_terminal or cancel_requested permits cleanup.
   * settled means this operation can produce no further session-creation effects.
   * clean means the application's resources are verifiably cleaned/absent. */
  recover?(call: ApplicationCall, context: RecoveryContext): Promise<{
    settled: boolean; cleanup: 'clean' | 'pending' | 'unknown'; session_ref?: string;
  }>;
}
