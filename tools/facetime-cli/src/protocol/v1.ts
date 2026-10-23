import { createHash } from 'node:crypto';
import { z } from 'zod';

export const MAX_FRAME = 32 * 1024;
export const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const scopeSchema = z.strictObject({
  project_id: id, line_id: id, binding_id: id, binding_epoch: integer,
  instance_id: id, connection_generation: integer, session_mode: z.enum(['byor', 'create-room']).optional(),
});
export type Scope = z.infer<typeof scopeSchema>;
export const ownerSchema = scopeSchema.extend({ call_id: id, request_id: id });
export type Owner = z.infer<typeof ownerSchema>;
const header = { v: z.literal(1), message_id: id };
export const callerPartySchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('phone_number'), value: z.string().regex(/^\+[1-9][0-9]{7,14}$/) }),
  z.strictObject({ type: z.literal('email'), value: z.string().max(254).refine(value => {
    const local = value.split('@')[0]!;
    return local.length <= 64 && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..')
      && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(value);
  }) }),
]);
export type CallerParty = z.infer<typeof callerPartySchema>;
export const incomingSchema = ownerSchema.extend({
  ...header, type: z.literal('call.incoming'), integration_revision_id: id,
  from: callerPartySchema.nullable().optional(),
  created_at: integer, sent_at: integer, deadline_at: integer,
  prepare_deadline_at: integer, remaining_ms: integer, resource_expires_at: integer,
  media: z.strictObject({ audio: z.literal(true), video: z.boolean() }),
});
export type Incoming = z.infer<typeof incomingSchema>;
export const codes = z.enum([
  'agent_unavailable', 'agent_availability_unknown', 'agent_availability_stale',
  'agent_capacity_exhausted', 'agent_draining', 'binding_standby', 'binding_draining',
  'relay_unavailable', 'cleanup_pending', 'journal_unavailable', 'deadline_exceeded',
  'invalid_deadline', 'forbidden', 'stale_generation', 'request_conflict',
  'acceptance_uncertain', 'terminal', 'readiness_invalid', 'preparation_failed',
  'invalid_frame', 'unsupported_protocol', 'frame_too_large', 'transport_failure',
  'not_found', 'binding_conflict', 'health_replay', 'invalid_signature',
  'credentials_invalid', 'application_recovery_missing', 'application_lifecycle_pending', 'mode_mismatch',
]);
export type Code = z.infer<typeof codes>;
export class Fault extends Error {
  constructor(public readonly code: Code) { super(code); this.name = 'Fault'; }
}
export function safeCode(error: unknown): Code { return error instanceof Fault ? error.code : 'transport_failure'; }
export const decisionSchema = z.discriminatedUnion('action', [
  ownerSchema.extend({ ...header, type: z.literal('call.decision'), action: z.literal('accept'),
    livekit_url: z.string().max(2048).refine(value => { try { const url = new URL(value); return url.protocol === 'wss:' && !url.username && !url.password && !url.hash; } catch { return false; } }), participant_token: z.string().min(1).max(16384),
    remote_participant_identity: z.string().min(1).max(240), session_expires_at: integer.optional() }),
  ownerSchema.extend({ ...header, type: z.literal('call.decision'), action: z.literal('decline'), reason: codes }),
]);
export type Decision = z.infer<typeof decisionSchema>;
export const receiptSchema = ownerSchema.extend({
  ...header, type: z.literal('decision.committed'), action: z.enum(['accept', 'decline']),
  call_version: integer, resource_expires_at: integer,
});
export type Receipt = z.infer<typeof receiptSchema>;
export const lifecycleSchema = ownerSchema.extend({
  ...header, type: z.literal('call.lifecycle'), event_id: id, cursor: integer,
  call_version: integer, transition: z.enum(['started', 'ended', 'failed']),
});
export type Lifecycle = z.infer<typeof lifecycleSchema>;
export const cancelSchema = ownerSchema.extend({
  ...header, type: z.literal('call.cancel'), call_version: integer,
  terminal: z.boolean(), reason: z.enum(['deadline', 'caller_cancelled', 'revoked', 'superseded', 'terminal']),
});
export type Cancel = z.infer<typeof cancelSchema>;
export const ackSchema = ownerSchema.extend({
  ...header, type: z.enum(['lifecycle.ack', 'cancel.ack']), event_id: id, cursor: integer,
});
export type Ack = z.infer<typeof ackSchema>;
export const welcomeSchema = scopeSchema.extend({ ...header, type: z.literal('connection.welcome'), role: z.enum(['active', 'standby', 'draining']) });
export const frameSchema = z.union([incomingSchema, decisionSchema, receiptSchema, lifecycleSchema, cancelSchema, ackSchema, welcomeSchema]);
export type Frame = z.infer<typeof frameSchema>;
export function parseFrame(bytes: Buffer | string): Frame {
  if (Buffer.byteLength(bytes) > MAX_FRAME) throw new Fault('frame_too_large');
  let value: unknown;
  try { value = JSON.parse(bytes.toString()); } catch { throw new Fault('invalid_frame'); }
  if (typeof value === 'object' && value !== null && 'v' in value && value.v !== 1) throw new Fault('unsupported_protocol');
  const result = frameSchema.safeParse(value);
  if (!result.success) throw new Fault('invalid_frame');
  return result.data;
}
export const scopeKeys = Object.keys(scopeSchema.shape) as (keyof Scope)[];
export function scopeOf(owner: Scope): Scope { return scopeSchema.parse(Object.fromEntries(scopeKeys.map(k => [k, owner[k]]))); }
export function ownerOf(owner: Owner): Owner { return { ...scopeOf(owner), call_id: owner.call_id, request_id: owner.request_id }; }
export function sameScope(a: Scope, b: Scope, generation = true): boolean {
  return scopeKeys.every(k => (!generation && k === 'connection_generation') || a[k] === b[k]);
}
export function sameOwner(a: Owner, b: Owner, generation = true): boolean {
  return sameScope(a, b, generation) && a.call_id === b.call_id && a.request_id === b.request_id;
}
export function key(owner: Owner): string {
  return [owner.project_id, owner.binding_id, owner.binding_epoch, owner.call_id, owner.request_id].join(':');
}
export function digest(incoming: Incoming): string {
  const value = incomingSchema.parse(incoming);
  // Explicit semantic projection; strict parser strips no attacker-controlled fields.
  const { message_id: _message, remaining_ms: _remaining, sent_at: _sent, connection_generation: _generation, ...semantic } = value;
  return createHash('sha256').update(JSON.stringify(semantic)).digest('hex');
}
