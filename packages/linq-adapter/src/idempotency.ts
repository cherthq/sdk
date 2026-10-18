const encoder = new TextEncoder();
export function validKey(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0')
    && [...value].length <= 255 && encoder.encode(value).length <= 1020
    && new TextDecoder().decode(encoder.encode(value)) === value;
}
export function canonicalChat(value: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(?![\s\S])/.test(value);
}
export async function linqRequestContext(chat: string, body: unknown) {
  const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted) : v !== null && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,sorted(x)])) : v;
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(sorted(body))));
  return {version:1,profile:'linq-v3',route:`/v3/chats/${chat}/messages`,body_sha256:Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('')};
}
