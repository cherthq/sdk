import { expect, mock, test } from 'bun:test';
import Linq from '../src/index';
import type { PhonenumberListResponse } from '@linqapp/sdk/resources/phonenumbers';
const rows = { phone_numbers: [{ id: 'line-a', phone_number: '+15550000001' }] } satisfies PhonenumberListResponse;
function fixture(body: unknown = rows, status = 200) {
  const fetch = mock(async (_input: unknown, _init?: RequestInit) => Response.json(body, { status }));
  const client = new Linq({ apiKey: 'unused-provider-secret', chert: { baseURL: 'https://chert.test', apiKey: 'chert-secret', fetch } });
  return { client, fetch };
}
test('actual deprecated SDK resource returns only assigned identities; newer reputation method stays unsupported', async () => {
  const { client, fetch } = fixture({ phone_numbers: [{ ...rows.phone_numbers[0], capabilities: ['invented'], api_key: 'private', reputation: { status: 'invented' } }] });
  const response = await client.phonenumbers.list().withResponse();
  expect(response.data).toEqual(rows);expect(response.response.status).toBe(200);
  const [input, init] = fetch.mock.calls[0]!;const request = new Request(input as RequestInfo, init);
  expect(request.url).toBe('https://chert.test/api/v1/phone-numbers');expect(request.method).toBe('GET');expect(request.headers.get('authorization')).toBe('Bearer chert-secret');
  expect(JSON.stringify(fetch.mock.calls)).not.toContain('unused-provider-secret');
  await expect((async () => await client.phoneNumbers.list())()).rejects.toMatchObject({ status: 501 });expect(fetch).toHaveBeenCalledTimes(1);
});
test('missing, malformed and duplicate assigned identities reject without guessing', async () => {
  for (const body of [null, {}, { phone_numbers: [null] }, { phone_numbers: [{ phone_number: '+15550000001' }] },
    { phone_numbers: [{ id: 'line-a', phone_number: '5550000001' }] }, { phone_numbers: [{ id: '../line-a', phone_number: '+15550000001' }] },
    { phone_numbers: [rows.phone_numbers[0], rows.phone_numbers[0]] },
    { phone_numbers: [rows.phone_numbers[0], { id: 'line-b', phone_number: '+15550000001' }] }]) {
    const { client, fetch } = fixture(body);await expect((async () => await client.phonenumbers.list())()).rejects.toMatchObject({ status: 502 });expect(fetch).toHaveBeenCalledTimes(1);
  }
  const { client } = fixture({ phone_numbers: [] });expect(await client.phonenumbers.list()).toEqual({ phone_numbers: [] });
});
test('read overrides reject before transport, upstream error classes survive and cancellation propagates', async () => {
  const { client, fetch } = fixture();
  for (const options of [{ body: {} }, { query: { from: '+15550000001' } }, { headers: { x: 'y' } }, { idempotencyKey: 'unsupported' }, { stream: true }, { maxRetries: 1 }]) {
    await expect((async () => await client.phonenumbers.list(options as never))()).rejects.toThrow();
  }
  const controller = new AbortController();controller.abort();await expect((async () => await client.phonenumbers.list({ signal: controller.signal }))()).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
  const failed = fixture({ error: 'forbidden' }, 403);await expect((async () => await failed.client.phonenumbers.list())()).rejects.toMatchObject({ status: 403 });expect(failed.fetch).toHaveBeenCalledTimes(1);
});
