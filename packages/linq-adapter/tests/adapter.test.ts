import { describe, expect, test, mock } from 'bun:test';
import LinqAPIV3 from '@linqapp/sdk';
import ChertLinqAdapter, { LinqAPIV3 as NamedAdapter } from '../src/index';

const text = { message: { parts: [{ type: 'text' as const, value: 'hello' }] } };
const fixture = { message: { id: 'actual-message-id', chat_id: 'chat-id', created_at: '2026-10-17T00:00:00Z', status: 'queued', parts: text.message.parts } };
function setup(response: unknown = fixture, status = 200) {
  const fetch = Object.assign(mock(async (_input: unknown, _init?: RequestInit) => Response.json(response, { status })), { preconnect() {} });
  const client = new ChertLinqAdapter({ apiKey: 'unused-vendor-secret', chert: { baseURL: 'https://chert.test', apiKey: 'chert-secret', fetch } });
  return { client, fetch };
}
describe('Linq 0.78 restricted chat send', () => {
  test('requires explicit Chert configuration and disables unsafe retries', () => {
    expect(NamedAdapter).toBe(ChertLinqAdapter);
    expect(() => new ChertLinqAdapter({ chert: { baseURL: 'https://chert.test', apiKey: '' } })).toThrow('Explicit Chert');
    expect(() => new ChertLinqAdapter({ chert: { baseURL: 'https://chert.test', apiKey: 'key' }, maxRetries: 1 })).toThrow('maxRetries: 0');
  });
  test('sends actual plain text with Chert credentials and preserves unknown evidence as null', async () => {
    const { client, fetch } = setup();
    const result = await client.chats.messages.send('chat-id', text);
    expect(result).toEqual({ chat_id: 'chat-id', message: { id: 'actual-message-id', created_at: fixture.message.created_at,
      delivery_status: 'queued', is_read: false, sent_at: null, parts: [{ type: 'text', value: 'hello', reactions: null }] } });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [input, init] = fetch.mock.calls[0];
    const request = new Request(input as RequestInfo, init);
    expect(request.url).toBe('https://chert.test/api/v1/chats/chat-id/messages');
    expect(request.headers.get('authorization')).toBe('Bearer chert-secret');
    expect(await request.json()).toEqual(text);
    expect(JSON.stringify(fetch.mock.calls)).not.toContain('unused-vendor-secret');
  });
  test('rejects unsupported methods and fields before a side effect', async () => {
    const { client, fetch } = setup();
    for (const operation of [
      () => client.chats.create({ from: '+15551234567', to: ['+15557654321'], ...text }),
      () => client.messages.create({ to: ['+15557654321'], ...text }),
      async () => await client.chats.messages.list('chat-id', { order: 'asc' } as never),
      () => client.chats.messages.send('chat-id', { message: { ...text.message, preferred_service: 'SMS' } }),
      () => client.chats.messages.send('chat-id', { ...text, override_optout: true }),
    ]) await expect((async () => await operation())()).rejects.toMatchObject({ status: 501 });
    expect(fetch).not.toHaveBeenCalled();
  });
  test('rejects retry overrides before send and never retries uncertain outcomes', async () => {
    const { client, fetch } = setup({ message: { status: 'sent' } });
    await expect((async () => await client.chats.messages.send('chat-id', text, { maxRetries: 2 }))()).rejects.toThrow('maxRetries: 0');
    await expect((async () => await client.chats.messages.send('chat-id', text, { idempotencyKey: 'not-supported' }))()).rejects.toThrow('idempotency');
    expect(fetch).not.toHaveBeenCalled();
    try { await client.chats.messages.send('chat-id', text); throw new Error('Expected invalid response'); }
    catch (error) { expect(error).toBeInstanceOf(LinqAPIV3.APIError); expect(error).toMatchObject({ status: 502, code: 'outcome_unknown' }); }
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  test('preserves upstream APIError construction for Chert failures without retry', async () => {
    const { client, fetch } = setup({ error: { code: 'forbidden', message: 'No access' } }, 403);
    await expect((async () => await client.chats.messages.send('chat-id', text))()).rejects.toMatchObject({ status: 403 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

 test('withOptions keeps Chert configuration and mutable retry settings cannot bypass guards', async () => {
  const { client, fetch } = setup();
  const copy = client.withOptions({ apiKey: 'changed-vendor-key', baseURL: 'https://vendor.invalid' });
  await copy.chats.messages.send('chat-id', text);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(() => client.withOptions({ maxRetries: 2 })).toThrow('maxRetries: 0');
  client.maxRetries = 3;
  await expect((async () => await client.chats.messages.send('chat-id', text))()).rejects.toThrow('maxRetries: 0');
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('low-level request cannot re-enable explicit retry attempts', async () => {
  const { client, fetch } = setup({ error: { code: 'temporary' } }, 500);
  const options = { method: 'post' as const, path: '/v3/chats/chat-id/messages', body: text };
  expect(() => client.request(options, 1)).toThrow('retry attempts');
  expect(fetch).not.toHaveBeenCalled();
  await expect((async () => await client.request(options, 0))()).rejects.toMatchObject({ status: 500 });
  expect(fetch).toHaveBeenCalledTimes(1);
});

describe('Linq direct-chat typing acknowledgements', () => {
  test('official start/stop methods return void and dispatch only authenticated Chert POSTs', async () => {
    for (const operation of ['start', 'stop'] as const) {
      const state = operation === 'start' ? 'typing' : 'stopped';
      const { client, fetch } = setup({ chat_id: 'chat-id', state });
      expect(await client.chats.typing[operation]('chat-id')).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(1);
      const [input, init] = fetch.mock.calls[0];
      const request = new Request(input as RequestInfo, init);
      expect(request.url).toBe('https://chert.test/api/v1/chats/chat-id/typing');
      expect(request.method).toBe('POST');
      expect(request.headers.get('authorization')).toBe('Bearer chert-secret');
      expect(await request.json()).toEqual({ state });
      expect(JSON.stringify(fetch.mock.calls)).not.toContain('unused-vendor-secret');
    }
  });
  test('preserves group unsupported and native failures without retries or success conversion', async () => {
    for (const status of [403, 404, 501, 502]) {
      const { client, fetch } = setup({ success: false, error: { code: 'native-error', message: 'unsupported or unavailable' } }, status);
      await expect((async () => await client.chats.typing.start('chat-id'))()).rejects.toMatchObject({ status });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
  test('invalid or mismatched acknowledgement is unknown outcome, never void success', async () => {
    for (const response of [null, {}, { chat_id: 'other', state: 'typing' }, { chat_id: 'chat-id', state: 'stopped' },
      { chat_id: 'chat-id', state: 'typing', success: false }, { chat_id: 'chat-id', state: 'typing', error: 'failure' }]) {
      const { client, fetch } = setup(response);
      await expect((async () => await client.chats.typing.start('chat-id'))()).rejects.toMatchObject({ status: 502 });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
  test('rejects unsafe IDs and request overrides before Chert dispatch', async () => {
    const { client, fetch } = setup();
    for (const id of ['a/b', 'a\\b', '%2f', 'a\nb', 'a b', '..']) {
      await expect((async () => await client.chats.typing.start(id))()).rejects.toThrow();
    }
    for (const options of [{ maxRetries: 1 }, { idempotencyKey: 'key' }, { headers: { 'x-extra': 'ignored' } }, { query: { extra: 1 } }, { body: { extra: true } }, { stream: true }]) {
      await expect((async () => await client.chats.typing.start('chat-id', options as any))()).rejects.toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  test('abort reaches Chert transport and is never automatically retried', async () => {
    const controller = new AbortController();
    let calls = 0; let signal: AbortSignal | undefined;
    const client = new ChertLinqAdapter({ chert: { baseURL: 'https://chert.test', apiKey: 'key', fetch: async (_url, init) => {
      calls++;signal=init?.signal ?? undefined;
      controller.abort();
      expect(signal?.aborted).toBe(true);
      throw new DOMException('Aborted', 'AbortError');
    } } });
    await expect((async () => await client.chats.typing.stop('chat-id', { signal: controller.signal }))()).rejects.toThrow();
    expect(calls).toBe(1);expect(signal?.aborted).toBe(true);
  });
});

describe('Linq mark-as-read application acknowledgement', () => {
  test('official markAsRead path maps to a single Chert POST and void response', async () => {
    const { client, fetch } = setup({ chat_id: 'chat-id', applied: true });
    expect(await client.chats.markAsRead('chat-id')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [input, init] = fetch.mock.calls[0]; const request = new Request(input as RequestInfo, init);
    expect(request.url).toBe('https://chert.test/api/v1/chats/chat-id/mark-read');
    expect(request.method).toBe('POST'); expect(request.body).toBeNull();
    expect(request.headers.get('authorization')).toBe('Bearer chert-secret');
    expect(JSON.stringify(fetch.mock.calls)).not.toContain('unused-vendor-secret');
    expect(client.maxRetries).toBe(0);
  });
  test('missing, false, nonboolean or wrong-chat acknowledgement cannot become success', async () => {
    for (const response of [null, {}, { chat_id: 'chat-id' }, { chat_id: 'chat-id', applied: false },
      { chat_id: 'chat-id', applied: 1 }, { chat_id: 'chat-id', applied: 'true' },
      { chat_id: 'wrong', applied: true }, { chat_id: 'chat-id', applied: true, success: false },
      { chat_id: 'chat-id', applied: true, error: 'failure' }]) {
      const { client, fetch } = setup(response);
      await expect((async () => await client.chats.markAsRead('chat-id'))()).rejects.toMatchObject({ status: 502 });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
  test('preserves sanitized cloud errors and never retries', async () => {
    for (const status of [403, 404, 501, 502]) {
      const { client, fetch } = setup({ error: { code: 4103, message: 'private native detail' } }, status);
      try { await client.chats.markAsRead('chat-id'); throw new Error('Expected failure'); }
      catch (error) { expect(error).toBeInstanceOf(LinqAPIV3.APIError); expect(error).toMatchObject({ status, code: '4103' }); expect(JSON.stringify(error)).not.toContain('private native detail'); }
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
  test('rejects unsafe IDs and all unsupported request overrides before contacting Chert', async () => {
    const { client, fetch } = setup({ chat_id: 'chat-id', applied: true });
    for (const id of ['a/b', 'a\\b', '%2f', '%250a', 'a\nb', 'a b', '..', '.']) {
      await expect((async () => await client.chats.markAsRead(id))()).rejects.toThrow();
    }
    for (const options of [{ maxRetries: 1 }, { idempotencyKey: 'key' }, { headers: { 'x-extra': 'ignored' } }, { query: {} }, { body: {} }, { stream: true }, { __binaryResponse: true }]) {
      await expect((async () => await client.chats.markAsRead('chat-id', options as Parameters<typeof client.chats.markAsRead>[1]))()).rejects.toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  test('propagates cancellation without another attempt or an invented acknowledgement', async () => {
    let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
    const fetch = mock(async (_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }); started();
    }));
    const client = new ChertLinqAdapter({ chert: { baseURL: 'https://chert.test', apiKey: 'key', fetch } });
    const controller = new AbortController(); const pending = (async () => await client.chats.markAsRead('chat-id', { signal: controller.signal }))();
    await ready; controller.abort(); await expect(pending).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1);
    await expect((async () => await client.chats.markAsRead('chat-id', { signal: controller.signal }))()).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1);
  });
});

test('inherited absolute send URLs cannot bypass the virtual origin boundary', async () => {
  const { client, fetch } = setup();
  await expect((async () => await client.post('https://foreign.invalid/v3/chats/chat-id/messages', { body: text }))()).rejects.toMatchObject({ status: 501 });
  expect(fetch).not.toHaveBeenCalled();
});

test('single-text sends reject unsafe encoded chat identifiers before Chert dispatch', async () => {
  for (const id of ['a/b', 'a\\b', '%2F', '%252F', 'a?query=1', 'a#fragment', '..', '.', 'a b', 'a\nb']) {
    const { client, fetch } = setup();
    await expect((async () => await client.chats.messages.send(id, text))()).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  }
});

test('inherited send requests reject encoded separators and malformed escapes before Chert', async () => {
  for (const segment of ['a%2Fb', 'a%5Cb', '%252F', '%', 'a%3Fquery', 'a%23fragment', 'a%0Ab']) {
    const { client, fetch } = setup();
    await expect((async () => await client.post(`/v3/chats/${segment}/messages`, { body: text }))()).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  }
});

test('validated UUID and colon IDs use one canonical send path for official and inherited methods', async () => {
  for (const id of ['182bd5e5-6e1a-4fe4-a799-aa6d9a6ab26e', 'chat:existing']) {
    for (const inherited of [false, true]) {
      const { client, fetch } = setup({ message: { ...fixture.message, chat_id: id } });
      const result = inherited
        ? await client.post<{ chat_id: string }>(`/v3/chats/${encodeURIComponent(id)}/messages`, { body: text })
        : await client.chats.messages.send(id, text);
      expect(result.chat_id).toBe(id);
      expect(fetch).toHaveBeenCalledTimes(1);
      const [input, init] = fetch.mock.calls[0]; const request = new Request(input as RequestInfo, init);
      expect(request.url).toBe(`https://chert.test/api/v1/chats/${encodeURIComponent(id)}/messages`);
      expect(await request.json()).toEqual(text);
    }
  }
});
test('all controls and sends share bounded decoded ID validation', async () => {
  const { client, fetch } = setup();
  for (const id of ['a?query', 'a#fragment', 'a'.repeat(129)]) {
    for (const operation of [
      () => client.chats.messages.send(id, text),
      () => client.chats.typing.start(id), () => client.chats.typing.stop(id),
      () => client.chats.markAsRead(id),
    ]) await expect((async () => await operation())()).rejects.toThrow();
  }
  expect(fetch).not.toHaveBeenCalled();
});
test('strict plaintext unknown outcome exposes only actual public reconciliation headers once',async()=>{
 const messageID='a'.repeat(32),data={message_id:messageID,chat_id:'chat-id',error:{status:502,code:4103,retryable:false,message:'private-native-error'}};
 const {client,fetch}=setup(data,502);const failure=await client.chats.messages.send('chat-id',text).catch(error=>error);
 expect(failure).toBeInstanceOf(LinqAPIV3.APIError);expect(failure.headers.get('x-chert-message-id')).toBe(messageID);expect(failure.headers.get('x-chert-chat-id')).toBe('chat-id');expect(JSON.stringify(failure.error)).not.toContain('private-native-error');expect(JSON.stringify(failure.error)).not.toContain(messageID);expect(fetch).toHaveBeenCalledTimes(1);
});
test('plaintext reconciliation headers reject mismatched identity/classification without retry',async()=>{
 const base={message_id:'a'.repeat(32),chat_id:'chat-id',error:{status:502,code:4103,retryable:false}};
 for(const [data,status] of [[{...base,chat_id:'foreign'},502],[{...base,message_id:'550e8400-e29b-41d4-a716-446655440000'},502],[{...base,message_id:'A'.repeat(32)},502],[{...base,error:{...base.error,retryable:true}},502],[{...base,error:{...base.error,code:4006}},502],[{...base,error:{...base.error,status:500}},502],[base,500]] as const){const {client,fetch}=setup(data,status);const failure=await client.chats.messages.send('chat-id',text).catch(error=>error);expect(failure).toBeInstanceOf(LinqAPIV3.APIError);expect(failure.headers.get('x-chert-message-id')).toBeNull();expect(failure.headers.get('x-chert-chat-id')).toBeNull();expect(fetch).toHaveBeenCalledTimes(1);}
});
