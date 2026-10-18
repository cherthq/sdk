/** Request identity only: no authorization, persistence, native IDs or network. */
export type V4IdempotencyRequest = Readonly<{
  version: 1;
  profile: 'blooio-v4';
  route: string;
  body_sha256: string;
}>;
function canonical(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]));
  throw new TypeError('A JSON request is required');
}
export async function createV4IdempotencyRequest(route: string, body: Record<string, unknown>): Promise<V4IdempotencyRequest> {
  if (route !== '/v4/messages') {
    const match = /^\/v4\/chats\/([^/]+)\/messages$/.exec(route);
    if (!match) throw new TypeError('Unsupported send route');
    const chat = decodeURIComponent(match[1]!);
    if (!chat || chat.length > 160 || chat === '.' || chat === '..' || /[\\/%?#\u0000-\u0020\u007f]/.test(chat)
      || encodeURIComponent(chat) !== match[1]) throw new TypeError('Noncanonical send route');
  }
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(body)));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Object.freeze({version: 1, profile: 'blooio-v4', route, body_sha256: [...hash].map(v=>v.toString(16).padStart(2,'0')).join('')});
}
