import { Fault, MAX_FRAME } from '../protocol/v1.js';
export function loopbackOrigin(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Fault('forbidden'); }
  if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:' || !url.port || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Fault('forbidden');
  return url;
}
export async function boundedText(response: Response, limit = MAX_FRAME): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Fault('invalid_frame');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > limit) throw new Fault('frame_too_large');
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { await reader.cancel().catch(() => {}); }
}

/** Hosted transport is encrypted and cannot embed credentials or redirect. */
export function hostedOrigin(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Fault('forbidden'); }
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Fault('forbidden');
  return url;
}
