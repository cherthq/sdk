export const callbackScaffold = `import type { ByorHandler } from '@trychert/facetime/byor';

// Connect these callbacks to YOUR application session owner. No HTTP server needed.
// No allocation or paid preparation at module load or in health().
const handler: ByorHandler = {
  version: 1,
  async health() { return 'unknown'; },
  async prepare(call, { signal, remaining_ms }) {
    // Persist call.operation_id in your application BEFORE preparing/selecting a
    // call-scoped session. Honor signal, prepare_deadline_at and remaining_ms.
    // Return accept only when ready, with session_ref, session_expires_at,
    // livekit_url, participant_token and remote_participant_identity.
    void call; void signal; void remaining_ms;
    return { action: 'decline' };
  },
  async lifecycle(call, event, context) {
    // Apply event once by event.event_id to the SAME application operation.
    // Set acknowledged:true only after your application durably handles it.
    void call; void event; void context;
    return { acknowledged: false };
  },
  async recover(call, context) {
    // Lookup the original operation_id (even if preparation never returned).
    // Cancel it idempotently if context.cancel_requested. Never re-prepare here.
    // Return settled:true only when no late session can appear, and cleanup:clean
    // only when your application verifies absence/cleanup of its own resources.
    void call; void context;
    return { settled: false, cleanup: 'unknown' };
  },
};
export default handler;
`;
