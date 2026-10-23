import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { ChertSDK } from './index';
import { ChertClient } from '../imessage/src/index';
import { ChertControlPlane } from '../control-plane/index';
import Linq from '../linq-adapter/src/index';
import Sendblue from '../sendblue-adapter/index';
import { createBlooioV4Fetch } from '../blooio-v4-adapter/index';

const receipt = { success: true, message_id: 'a'.repeat(32), chat_id: 'test_chat', status: 'queued' };
const body = { phone: '+61412345678', body: 'hello' };

test('provider adapters use the messaging default for requests and owned media', async () => {
  for (const baseURL of [undefined, 'https://override.test']) {
    const origin = baseURL ?? 'https://console.trychert.com';
    const requests: Request[] = [];
    const id = 'a'.repeat(48), message = 'b'.repeat(32), chat = '11000000-0000-4000-8000-000000000001';
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const mediaURL = `${origin}/api/v1/attachments/${id}/download?tenant=21000000-0000-4000-8000-000000000001&expires=${expires}&signature=${'f'.repeat(64)}`;
    const attachment = { attachment_id: id, filename: 'image.png', content_type: 'image/png', size_bytes: 70,
      download_url: mediaURL, download_url_expires_at: new Date(expires * 1000).toISOString() };
    const fetcher = async (url: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(url, init); requests.push(request);
      return Response.json(request.url.endsWith('/phone-numbers') ? { phone_numbers: [{ id: 'line-a', phone_number: '+15550000001' }] } : {
        id: message, lead_id: chat, direction: 'outbound', status: 'queued', phone: '+15550000002',
        request: { message: { parts: [{ type: 'media', attachment_id: id }] } }, response: { attachments: [attachment] },
      });
    };
    const chert = { baseURL, apiKey: 'owned-key', fetch: fetcher };
    expect(await new Linq({ chert }).phonenumbers.list()).toEqual({ phone_numbers: [{ id: 'line-a', phone_number: '+15550000001' }] });
    expect((await new Sendblue({ chert }).messages.retrieve(message)).data?.media_url).toBe(mediaURL);
    const response = await createBlooioV4Fetch({ chert })(`https://api.blooio.com/v4/chats/${chat}/messages/${message}`);
    expect(response.status).toBe(200);
    expect((await response.json()).data.attachments[0].url).toBe(mediaURL);
    expect(requests.map(r => r.url)).toEqual([`${origin}/api/v1/phone-numbers`, `${origin}/api/v1/messages/${message}`, `${origin}/api/v1/messages/${message}`]);
    for (const request of requests) expect(request.headers.get('authorization')).toBe('Bearer owned-key');
  }
});

test('canonical defaults keep channel credentials isolated and refuse redirects', async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetcher = async (url: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(url), init: init! });
    return String(url).includes('console.') ? Response.json(receipt, { status: 202 }) : Response.json({ data: {} });
  };
  const sdk = new ChertSDK({ projectId: 'project', imessage: { apiKey: 'message-key', tenant: 'tenant', fetch: fetcher }, facetime: { token: 'face-token', fetch: fetcher as typeof fetch } });
  await sdk.imessage.sendText(body);
  await sdk.facetime.whoami();
  expect(requests.map(r => r.url)).toEqual(['https://console.trychert.com/api/v1/text-operations/v1', 'https://facetime.trychert.com/api/v1/cli/whoami']);
  const [message, face] = requests.map(r => new Headers(r.init.headers));
  expect(message!.get('Authorization')).toBe('Bearer message-key');
  expect(message!.get('x-chert-tenant')).toBe('tenant');
  expect(message!.has('x-chert-project-id')).toBe(false);
  expect(face!.get('Authorization')).toBe('Bearer face-token');
  expect(face!.get('x-chert-project-id')).toBe('project');
  expect(face!.has('x-chert-tenant')).toBe(false);
  for (const request of requests) expect(request.init.redirect).toBe('error');
});

test('messaging overrides preserve root, trailing slash and deployment prefixes', async () => {
  for (const [baseURL, prefix] of [[undefined, 'https://console.trychert.com/api/v1'], ['https://override.test', 'https://override.test/api/v1'], ['https://override.test/', 'https://override.test/api/v1'], ['https://override.test/api/v1/', 'https://override.test/api/v1'], ['https://override.test/deployment/', 'https://override.test/deployment']]) {
    let requested = '';
    const client = new ChertClient({ baseURL, apiKey: 'fixture', fetch: async url => { requested = String(url); return Response.json(receipt, { status: 202 }); } });
    await client.sendText(body);
    expect(requested).toBe(`${prefix}/text-operations/v1`);
  }
});

test('invalid explicit overrides fail locally rather than selecting a default', () => {
  let calls = 0;
  const fetcher = (async () => { calls++; return Response.json({}); }) as unknown as typeof fetch;
  for (const base of [null, '', ' ', 'http://public.test', 'https://user:pass@host.test', 'https://host.test/?q=secret', 'https://host.test/#fragment',
    'https://host.test/a/../', 'https://host.test/%2e%2e', 'https://host.test/a%2fb', 'https://host.test/\\escape', 'https://host.test?', 'https://host.test\n']) {
    expect(() => new ChertClient({ baseURL: base as string, apiKey: 'fixture', fetch: fetcher })).toThrow();
    expect(() => new ChertControlPlane({ baseUrl: base as string, fetch: fetcher })).toThrow();
  }
  expect(calls).toBe(0);
});

test('CLI defaults and explicit overrides use only selected channel credentials', async () => {
  const preload = `globalThis.fetch = async (url, init) => {
    console.log(JSON.stringify({ intercepted: String(url), headers: Object.fromEntries(new Headers(init.headers)), redirect: init.redirect }));
    return String(url).includes('text-operations') ? Response.json(${JSON.stringify(receipt)}, {status:202}) : Response.json({data:{}});
  };`;
  for (const channel of ['imessage', 'facetime']) {
    for (const override of [undefined, 'https://override.test', '']) {
      const env = Object.fromEntries(Object.entries(process.env).filter(([name, value]) => !name.startsWith('CHERT_') && value !== undefined)) as Record<string, string>;
      env.CHERT_PROJECT_ID = 'project';
      env[channel === 'imessage' ? 'CHERT_API_KEY' : 'CHERT_FACETIME_TOKEN'] = 'selected-secret';
      if (override !== undefined) env[channel === 'imessage' ? 'CHERT_BASE_URL' : 'CHERT_FACETIME_URL'] = override;
      const args = channel === 'imessage' ? ['send', '--phone', body.phone, '--body', body.body] : ['status'];
      const child = Bun.spawn(['node', '--import', `data:text/javascript,${encodeURIComponent(preload)}`, resolve(import.meta.dir, '../../dist/unified/cli.js'), channel, ...args], { env, stdout: 'pipe', stderr: 'pipe' });
      const output = await new Response(child.stdout).text();
      expect(await child.exited).toBe(override === '' ? 1 : 0);
      if (override === '') { expect(output).toBe(''); continue; }
      const request = JSON.parse(output.split('\n')[0]!);
      const origin = override ?? (channel === 'imessage' ? 'https://console.trychert.com' : 'https://facetime.trychert.com');
      expect(request.intercepted).toBe(`${origin}/api/v1/${channel === 'imessage' ? 'text-operations/v1' : 'cli/whoami'}`);
      expect(request.headers.authorization).toBe('Bearer selected-secret');
      expect(request.headers['x-chert-project-id']).toBe(channel === 'facetime' ? 'project' : undefined);
      expect(request.redirect).toBe('error');
    }
  }
}, 20_000);
