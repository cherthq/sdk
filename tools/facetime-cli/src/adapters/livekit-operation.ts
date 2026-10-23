import { z } from 'zod';
import { supportedNode } from '../cli/node-version.js';
import { Fault } from '../protocol/v1.js';

export const errorCodeSchema = z.enum(['ERR_OUT_OF_RANGE', 'deadline_exceeded', 'unsupported_runtime', 'invalid_config',
  'invalid_argument', 'not_found', 'unauthenticated', 'permission_denied', 'unavailable', 'resource_exhausted',
  'internal', 'unknown', 'cancelled', 'ABORT_ERR', 'UND_ERR_CONNECT_TIMEOUT', 'unclassified']);
export const diagnosticSchema = z.strictObject({
  error_class: z.enum(['RangeError', 'TypeError', 'Error', 'Fault']), error_code: errorCodeSchema,
});
export function sanitizedFailure(error: unknown): z.infer<typeof diagnosticSchema> {
  const code = errorCodeSchema.safeParse(error && typeof error === 'object' && 'code' in error ? error.code : undefined);
  return { error_class: error instanceof RangeError ? 'RangeError' : error instanceof TypeError ? 'TypeError' : error instanceof Fault ? 'Fault' : 'Error',
    error_code: code.success ? code.data : 'unclassified' };
}
export function assertSupportedRuntime(version = process.versions.node): void {
  if (!supportedNode(version)) throw Object.assign(new Error('unsupported_test_runtime'), { code: 'unsupported_runtime' });
}
export function validateLiveKitConfig(url: string, key: string, secret: string): void {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw Object.assign(new Error('invalid_config'), { code: 'invalid_config' }); }
  if (!['https:', 'wss:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/' || !key || !secret) {
    throw Object.assign(new Error('invalid_config'), { code: 'invalid_config' });
  }
}
export type Operation = 'room' | 'dispatch';
const proof = new WeakMap<object, { operation: Operation; room: string; reason: 'timeout' | 'runtime'; timeout: number }>();

// Only this known synchronous validation boundary certifies non-invocation.
// Error names/codes thrown by an SDK, fetch, or an arbitrary caller are not proof.
export function validateBeforeSDK(operation: Operation, room: string, remaining: number): number {
  let reason: 'timeout' | 'runtime' = 'runtime';
  try {
    assertSupportedRuntime(); reason = 'timeout';
    return sdkTimeoutSeconds(remaining);
  } catch (error) {
    const diagnostic = sanitizedFailure(error);
    const safe = Object.assign(error instanceof Fault ? new Fault(error.code) : new Error(diagnostic.error_code), diagnostic, { code: diagnostic.error_code });
    proof.set(safe, { operation, room, reason, timeout: remaining }); throw safe;
  }
}
export function preSendProof(error: unknown, operation: Operation, room: string, timeout: number): { reason: 'timeout' | 'runtime' } | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = proof.get(error);
  return value?.operation === operation && value.room === room && value.timeout === timeout ? { reason: value.reason } : undefined;
}
export function preSendDiagnostic(error: unknown): z.infer<typeof diagnosticSchema> {
  // Called only for a branded local validation failure; never copy arbitrary fields.
  return diagnosticSchema.parse(error && typeof error === 'object' ? {
    error_class: 'error_class' in error ? error.error_class : undefined,
    error_code: 'error_code' in error ? error.error_code : undefined,
  } : undefined);
}
// SDK 2.19.0 multiplies seconds directly in AbortSignal.timeout. Rounding down
// avoids fractional milliseconds and never gives the request more input budget.
export function sdkTimeoutSeconds(ms: number): number {
  const seconds = Math.floor(ms / 1000);
  if (!Number.isFinite(seconds) || seconds < 1) throw new Fault('deadline_exceeded');
  return seconds;
}
export const auditSchema = z.strictObject({
  operation: z.enum(['room', 'dispatch']),
  phase: z.enum(['pending', 'acknowledged', 'not_sent', 'uncertain']),
  at: z.number().int().positive(), runtime: z.string().regex(/^v\d+\.\d+\.\d+$/),
  input_timeout_ms: z.number().finite().nonnegative(),
  effective_timeout_ms: z.number().int().nonnegative(),
  validation: z.enum(['timeout', 'runtime']).optional(),
  diagnostic: diagnosticSchema.optional(),
});
export type OperationAudit = z.infer<typeof auditSchema>;
