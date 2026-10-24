/** Recorded messaging events. Event names and payloads depend on the connected service. */
export interface MessagingEvent {
  id: string;
  type: string;
  event_id: string;
  lead_id: string | null;
  convo_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}
export interface StreamedMessagingEvent extends MessagingEvent { delivery_status: string }
/** Chert callback fields; additional payload fields depend on the event type. */
export interface MessagingWebhookEvent { event: string; event_id: string; timestamp: string; [key: string]: unknown }
export interface RecordedMessagingEvent extends MessagingEvent {
  delivery: {
    status: string;
    url: string | null;
    attempts: { at: string; status: number | null; duration_ms: number; error?: string }[];
    delivered_at: string | null;
  };
  updated_at?: string;
}
export interface MessagingEventPage { events: RecordedMessagingEvent[]; next_cursor: string | null; count: number }
export interface EventListOptions { type?: string; status?: string; lead_id?: string; since?: string; cursor?: string; limit?: number }
export interface WebhookSubscription {
  id: string; url: string; events: string[]; version: string; is_active: boolean; created_at: string;
  consecutive_failures?: number; last_success_at?: string | null; last_failure_at?: string | null; updated_at?: string;
}
export interface CreateWebhookSubscription { url: string; events?: string[]; version?: string }
export interface UpdateWebhookSubscription { url?: string; events?: string[]; version?: string; is_active?: boolean }
/** Named SSE frames are preserved. A stream error frame need not close the connection. */
export interface MessagingStreamFrame { event: string; data: unknown }
export interface StreamEventsOptions {
  since?: string;
  signal?: AbortSignal;
  /** Reconnect only after a server close frame with a continuation token. Never retry an uncertain disconnect. */
  reconnect?: boolean;
}

/** Bounded SSE decoding, independent of HTTP and authentication. Comments are heartbeats, not events. */
export async function* readEventStream(body: ReadableStream<Uint8Array>): AsyncGenerator<MessagingStreamFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let line = '', data: string[] = [], event = '', size = 0, afterCR = false;
  const maxFrameBytes = 1024 * 1024;
  function consumeLine(): MessagingStreamFrame | undefined {
    const current = line; line = '';
    if (!current) {
      const frame = data.length ? { event: event || 'message', data: JSON.parse(data.join('\n')) as unknown } : undefined;
      data = []; event = ''; size = 0;
      return frame;
    }
    if (current.startsWith(':')) return;
    const colon = current.indexOf(':');
    const field = colon < 0 ? current : current.slice(0, colon);
    let value = colon < 0 ? '' : current.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    else if (field === 'event') event = value;
  }
  try {
    for (;;) {
      const { value, done } = await reader.read();
      const text = decoder.decode(value, { stream: !done });
      for (const character of text) {
        if (afterCR) {
          afterCR = false;
          if (character === '\n' && ++size > maxFrameBytes) throw new Error('Event frame exceeds 1 MiB');
          const frame = consumeLine();
          if (frame) yield frame;
          if (character === '\n') continue;
        }
        const point = character.codePointAt(0)!;
        size += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
        if (size > maxFrameBytes) throw new Error('Event frame exceeds 1 MiB');
        if (character === '\r') afterCR = true;
        else if (character === '\n') {
          const frame = consumeLine();
          if (frame) yield frame;
        } else line += character;
      }
      if (done) {
        if (afterCR) { const frame = consumeLine(); if (frame) yield frame; }
        break; // An unterminated frame is not an SSE event.
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Verify the Chert v1 signature over timestamp + '.' + the exact raw body, before JSON parsing. */
export async function verifyWebhook(rawBody: string, signature: string, secret: string): Promise<boolean> {
  const match = /^v1,([0-9]{1,16}),([a-fA-F0-9]{64})(?![\s\S])/.exec(signature);
  if (!match || !secret || !Number.isSafeInteger(Number(match[1]))
    || Math.abs(Date.now() / 1000 - Number(match[1])) > 300) return false;
  const bytes = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', bytes.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const digest = Uint8Array.from(match[2]!.match(/../g)!, byte => parseInt(byte, 16));
  return crypto.subtle.verify('HMAC', key, digest, bytes.encode(`${match[1]}.${rawBody}`));
}
