import { createHmac, timingSafeEqual } from 'node:crypto';
import { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Fault, MAX_FRAME } from '../../src/protocol/v1.js';
export const INTERNAL = 'SYNTHETIC_INTERNAL_SECRET_SENTINEL';
export function localUrl(value: string, websocket = false): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Fault('forbidden'); }
  if (url.hostname !== '127.0.0.1' || url.protocol !== (websocket ? 'ws:' : 'http:') || url.username || url.password || !url.port) throw new Fault('forbidden');
  return url;
}
export function sign(bytes: Buffer | string): string { return createHmac('sha256', INTERNAL).update(bytes).digest('hex'); }
export function verify(bytes: Buffer, signature: unknown): void {
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(sign(bytes), 'hex'), Buffer.from(signature, 'hex'))) throw new Fault('invalid_signature');
}
export async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []; let length = 0;
  for await (const data of req) {
    const chunk = Buffer.from(data); length += chunk.length;
    if (length > MAX_FRAME) throw new Fault('frame_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function reply(res: ServerResponse, value: unknown, status = 200): void {
  if (!res.destroyed && !res.writableEnded) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); }
}
export function bearer(req: IncomingMessage): string {
  const value = req.headers.authorization;
  if (!value?.startsWith('Bearer ')) throw new Fault('forbidden');
  return value.slice(7);
}
export async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  const addr = server.address(); if (!addr || typeof addr === 'string') throw new Fault('transport_failure');
  return `http://127.0.0.1:${addr.port}`;
}
export async function closeServer(server: Server): Promise<void> {
  await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
}
export async function post(url: string, value: unknown, token: string, signal?: AbortSignal): Promise<Response> {
  const bytes = JSON.stringify(value);
  return fetch(localUrl(url), { method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${token}`, 'x-signature': sign(bytes), 'content-type': 'application/json' }, body: bytes, signal: signal ?? AbortSignal.timeout(6000) });
}
