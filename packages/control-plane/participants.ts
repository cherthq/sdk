/** Gated public Add People contract; submission is not evidence of ringing or joining. */
export interface AddCallParticipant {
  recipient: { type: 'phone_number'; value: string };
}
export interface CallParticipantOperation {
  id: string;
  call_id: string;
  status: 'queued' | 'dispatching' | 'submitted' | 'already_present' | 'failed' | 'unknown';
}
export const participantErrorCodes = ['participant_failed', 'participant_outcome_unknown',
  'participant_receipt_missing', 'participant_unavailable', 'participant_call_unavailable',
  'participant_assignment_changed', 'participant_usage_expired', 'participant_idempotency_conflict',
  'participant_busy', 'participant_already_attempted'];

export function validateParticipant(input: AddCallParticipant): void {
  if (!input || Object.keys(input).join() !== 'recipient' || !input.recipient
    || Object.keys(input.recipient).sort().join() !== 'type,value'
    || input.recipient.type !== 'phone_number' || typeof input.recipient.value !== 'string'
    || !/^\+[1-9][0-9]{7,14}(?![\s\S])/.test(input.recipient.value))
    throw new TypeError('Use exactly one E.164 phone recipient.');
}
export function isParticipantOperation(value: unknown, callId: string): value is CallParticipantOperation {
  return !!value && typeof value === 'object' && 'id' in value && typeof value.id === 'string' && !!value.id
    && 'call_id' in value && value.call_id === callId && 'status' in value
    && typeof value.status === 'string'
    && ['queued', 'dispatching', 'submitted', 'already_present', 'failed', 'unknown'].includes(value.status);
}
