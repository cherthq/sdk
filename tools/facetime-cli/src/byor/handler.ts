import { lstatSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { Fault, id } from '../protocol/v1.js';
import { CLIError } from '../cli/errors.js';
import type { ByorHandler, ApplicationDecision } from './contract.js';
const accept = z.strictObject({ action: z.literal('accept'), ready: z.literal(true), session_ref: id,
  session_expires_at: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), livekit_url: z.string().max(2048),
  participant_token: z.string().max(16384), remote_participant_identity: z.string().trim().min(1).max(240) });
export function validateDecision(raw: unknown, now: number, maximum: number): ApplicationDecision {
  const parsed = z.union([z.strictObject({ action: z.literal('decline') }), accept]).safeParse(raw);
  if (!parsed.success) throw new Fault('readiness_invalid');
  const value = parsed.data;
  if (value.action === 'decline') return value;
  try {
    if (Buffer.byteLength(value.livekit_url) > 2048 || Buffer.byteLength(value.participant_token) > 16384 || Buffer.byteLength(value.remote_participant_identity) > 240) throw new Error();
    const url = new URL(value.livekit_url);
    if (url.protocol !== 'wss:' || !url.hostname || url.username || url.password || url.hash || (url.port && url.port !== '443')) throw new Error();
    const parts = value.participant_token.split('.');
    if (parts.length !== 3 || parts.some(p => !p)) throw new Error();
    const header: unknown = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString());
    if (!header || typeof header !== 'object' || Array.isArray(header)) throw new Error();
    const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString());
    const video = claims.video;
    const rooms = typeof video?.room === 'string' ? [video.room] : video?.room;
    if (!Number.isInteger(claims.nbf) || !Number.isInteger(claims.exp) || claims.nbf > now / 1000 || claims.exp <= now / 1000 ||
      claims.exp - claims.nbf > 7200 || typeof claims.sub !== 'string' || !claims.sub.trim() || Buffer.byteLength(claims.sub) > 240 ||
      claims.sub.trim() === value.remote_participant_identity || !Array.isArray(rooms) || rooms.length !== 1 || typeof rooms[0] !== 'string' || !rooms[0].trim() ||
      video.roomJoin !== true || video.canPublish !== true || video.canSubscribe !== true ||
      value.session_expires_at <= now || value.session_expires_at > Math.min(maximum, now + 7200000, claims.exp * 1000)) throw new Error();
  } catch { throw new Fault('credentials_invalid'); }
  return value;
}
export async function loadHandler(path: string): Promise<ByorHandler> {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || !/\.(m?js|cjs)$/.test(path)) throw new Error();
    // Explicit trusted code: no discovery, startup hook, child process or receiver server.
    const handler: unknown = (await import(pathToFileURL(path).href)).default;
    if (!handler || typeof handler !== 'object') throw new Error();
    const h = handler as ByorHandler;
    if (h.version !== 1 || typeof h.prepare !== 'function' || ['health', 'lifecycle', 'recover'].some(k => k in h && typeof h[k as keyof ByorHandler] !== 'function')) throw new Error();
    return h;
  } catch { throw new CLIError('handler_invalid', 2, 'Compile the explicitly configured trusted module to JavaScript and export a default version-1 ByorHandler. Module initialization must not allocate sessions.'); }
}
