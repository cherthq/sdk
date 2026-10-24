import { expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { ChertClient, verifyWebhook } from '../src/index';

const row = { id: 'row-a', type: 'message.received', event_id: 'producer-b', lead_id: null, convo_id: 'conversation-c', payload: { text: 'hello 🌍' }, delivery_status: 'pending', created_at: '2026-10-24T00:00:00.000Z' };
const encode = (text: string) => new TextEncoder().encode(text);

test('authenticated event and subscription APIs preserve query, bodies and returned secret without provider conversion', async () => {
  const requests: { path: string; method: string; body: unknown }[] = [];
  const recorded = { ...row, delivery: { status: 'pending', url: null, attempts: [], delivered_at: null } };
  const subscription = { id: 'sub-a', url: 'https://receiver.example/events', events: ['message.received'], version: '2026-05-04', is_active: true, created_at: row.created_at };
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
    expect(request.headers.get('authorization')).toBe('Bearer fixture');
    expect(request.headers.get('x-chert-tenant')).toBe('tenant-a');
    const url = new URL(request.url);
    requests.push({ path: url.pathname + url.search, method: request.method, body: request.body ? await request.json() : null });
    if (url.pathname.endsWith('/events')) return Response.json({ events: [recorded], next_cursor: 'opaque|row-a', count: 1 });
    if (url.pathname.endsWith('/events/row-a')) return Response.json(recorded);
    if (request.method === 'DELETE') return Response.json({ id: 'sub-a', deleted: true });
    if (request.method === 'POST') return Response.json({ subscription: { ...subscription, secret: 'one-time-fixture' } }, { status: 201 });
    return Response.json(url.pathname.endsWith('/sub-a') ? { subscription } : { subscriptions: [subscription] });
  } });
  try {
    const client = new ChertClient({ baseURL: `http://127.0.0.1:${server.port}/custom/v1`, apiKey: 'fixture', tenant: 'tenant-a' });
    expect((await client.listEvents({ type: 'message.received', status: 'pending', lead_id: 'a&b', since: row.created_at, cursor: 'stamp|row', limit: 2 })).next_cursor).toBe('opaque|row-a');
    expect(await client.getEvent('row-a')).toEqual(recorded);
    expect((await client.createWebhookSubscription({ url: subscription.url, events: subscription.events })).subscription.secret).toBe('one-time-fixture');
    expect((await client.listWebhookSubscriptions()).subscriptions).toEqual([subscription]);
    expect((await client.getWebhookSubscription('sub-a')).subscription).toEqual(subscription);
    await client.updateWebhookSubscription('sub-a', { is_active: false });
    expect(await client.deleteWebhookSubscription('sub-a')).toEqual({ id: 'sub-a', deleted: true });
    expect(new URL('https://fixture.test' + requests[0]!.path).searchParams.get('lead_id')).toBe('a&b');
    expect(new URL('https://fixture.test' + requests[0]!.path).searchParams.get('cursor')).toBe('stamp|row');
    expect(requests.slice(1).map(r => [r.method, r.path])).toEqual([
      ['GET', '/custom/v1/events/row-a'], ['POST', '/custom/v1/webhook-subscriptions'], ['GET', '/custom/v1/webhook-subscriptions'],
      ['GET', '/custom/v1/webhook-subscriptions/sub-a'], ['PATCH', '/custom/v1/webhook-subscriptions/sub-a'], ['DELETE', '/custom/v1/webhook-subscriptions/sub-a'],
    ]);
    expect(requests[5]!.body).toEqual({ is_active: false });
    expect(() => client.listEvents({ limit: 201 })).toThrow();
    expect(() => client.getEvent('..')).toThrow();
  } finally { server.stop(true); }
});

test('SSE handles byte fragmentation, Unicode, multiline data, named errors and opaque reconnect tokens', async () => {
  const token = row.created_at + '|row-a';
  const frames = `: connected\r\n\r\ndata: ${JSON.stringify(row)}\r\n\r\nevent: error\ndata: {"error":"temporary",\ndata: "retryable":true}\n\nevent: close\rdata: ${JSON.stringify({ reason: 'ttl_reached', reconnect_with_since: token })}\r\r`;
  let requests = 0;
  const client = new ChertClient({ apiKey: 'fixture', tenant: 'tenant-a', fetch: async (url, init) => {
    const headers = new Headers(init!.headers);
    expect(headers.get('authorization')).toBe('Bearer fixture');
    expect(headers.get('accept')).toBe('text/event-stream');
    expect(headers.has('last-event-id')).toBe(false);
    expect(init!.redirect).toBe('error');
    expect(new URL(String(url)).searchParams.get('since')).toBe(requests++ === 0 ? 'start' : token);
    const bytes = encode(frames);
    let offset = 0;
    return new Response(new ReadableStream({ pull(controller) {
      if (offset < bytes.length) controller.enqueue(bytes.slice(offset, ++offset)); else controller.close();
    } }), { headers: { 'content-type': 'text/event-stream' } });
  } });
  const found = [];
  for await (const frame of client.streamEvents({ since: 'start', reconnect: true })) {
    found.push(frame);
    if (found.length === 4) break;
  }
  expect(requests).toBe(2);
  expect(found).toEqual([
    { event: 'message', data: row }, { event: 'error', data: { error: 'temporary', retryable: true } },
    { event: 'close', data: { reason: 'ttl_reached', reconnect_with_since: token } }, { event: 'message', data: row },
  ]);
});

test('SSE stops and releases the body on break, rejects bad/oversized frames and never retries failures', async () => {
  for (const payload of ['data: private-not-json\n\n', 'data: ' + 'x'.repeat(1024 * 1024 + 1), ':\r\n'.repeat(400_000) + 'data: {}\r\n\r\n']) {
    let requests = 0, cancelled = false;
    const client = new ChertClient({ apiKey: 'fixture', fetch: async () => {
      requests++;
      return new Response(new ReadableStream({ start(c) { c.enqueue(encode(payload)); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
    } });
    await expect(client.streamEvents({ reconnect: true }).next()).rejects.toMatchObject({ code: 'invalid_event_stream' });
    expect(requests).toBe(1); expect(cancelled).toBe(true);
  }
  let cancelled = false, signal: AbortSignal | undefined;
  const client = new ChertClient({ apiKey: 'fixture', fetch: async (_, init) => {
    signal = init!.signal!;
    return new Response(new ReadableStream({ start(c) { c.enqueue(encode(`data: ${JSON.stringify(row)}\n\n`)); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
  } });
  for await (const frame of client.streamEvents()) { expect(frame.data).toEqual(row); break; }
  expect(cancelled).toBe(true); expect(signal!.aborted).toBe(true);
});

test('SSE cancellation propagates and HTTP errors/redirects do not leak credentials or response content', async () => {
  let requests = 0;
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch(request) {
    requests++;
    const since = new URL(request.url).searchParams.get('since');
    if (since === 'redirect') return new Response(null, { status: 302, headers: { location: '/secret-target' } });
    if (since === 'denied') return new Response('PRIVATE', { status: 401 });
    return new Response(new ReadableStream({ start(c) { c.enqueue(encode(': connected\n\n')); } }), { headers: { 'content-type': 'text/event-stream' } });
  } });
  try {
    const client = new ChertClient({ baseURL: `http://127.0.0.1:${server.port}`, apiKey: 'fixture' });
    await expect(client.streamEvents({ since: 'denied', reconnect: true }).next()).rejects.toMatchObject({ status: 401, code: 'stream_unavailable' });
    await expect(client.streamEvents({ since: 'redirect' }).next()).rejects.toThrow();
    expect(requests).toBe(2);
    const abort = new AbortController();
    const pending = client.streamEvents({ signal: abort.signal }).next();
    setTimeout(() => abort.abort(new Error('caller-stop')), 30);
    await expect(pending).rejects.toThrow('caller-stop');
    const before = requests;
    await expect(client.streamEvents({ signal: abort.signal }).next()).rejects.toThrow('caller-stop');
    expect(requests).toBe(before);
  } finally { server.stop(true); }
});

test('SSE exact frame bounds survive consecutive CRLF frames and split delimiters', async () => {
  for (const ending of ['\n\n', '\r\n\r\n']) {
    const overhead = 8 + ending.length;
    const exact = 'data: "' + 'x'.repeat(1024 * 1024 - overhead) + '"' + ending;
    const prefix = 'data: {}\r\n\r\n';
    const client = new ChertClient({ apiKey: 'fixture', fetch: async () => {
      const bytes = encode(prefix + exact);
      return new Response(new ReadableStream({ start(c) {
        c.enqueue(bytes.slice(0, prefix.length - 1));
        c.enqueue(bytes.slice(prefix.length - 1)); c.close();
      } }), { headers: { 'content-type': 'text/event-stream' } });
    } });
    const frames = [];
    for await (const frame of client.streamEvents()) frames.push(frame);
    expect(frames).toHaveLength(2);
    expect((frames[1]!.data as string).length).toBe(1024 * 1024 - overhead);
  }
});

test('Chert webhook verification covers raw bytes, timestamp, secret and signature rather than header naming', async () => {
  const body = '{ "event":"message.received", "payload":"🌍" }';
  const secret = 'synthetic-secret';
  const now = Math.floor(Date.now() / 1000);
  const signature = (timestamp: number) => `v1,${timestamp},${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
  expect(await verifyWebhook(body, signature(now), secret)).toBe(true);
  expect(await verifyWebhook(JSON.stringify(JSON.parse(body)), signature(now), secret)).toBe(false);
  expect(await verifyWebhook(body, signature(now), 'wrong')).toBe(false);
  expect(await verifyWebhook(body, signature(now - 301), secret)).toBe(false);
  expect(await verifyWebhook(body, signature(now + 301), secret)).toBe(false);
  expect(await verifyWebhook(body, 'v1,' + now + ',bad', secret)).toBe(false);
  expect(await verifyWebhook(body, signature(now) + '\n', secret)).toBe(false);
  expect(await verifyWebhook(body, signature(now) + 'a', secret)).toBe(false);
});
