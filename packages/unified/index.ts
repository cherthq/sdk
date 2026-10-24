import { ChertClient, type ChertClientOptions } from '@cherthq/imessage';
import { ChertControlPlane, type ClientOptions } from '@cherthq/control-plane';

export interface ChertSDKOptions {
  /** Shared application context; service credentials remain explicitly separate. */
  projectId: string;
  imessage: ChertClientOptions;
  facetime: Omit<ClientOptions, 'projectId'>;
}

export interface UnifiedSessionOptions {
  accessToken: string;
  projectId: string;
  /** Explicitly trusted service origins; the descriptor cannot redirect credentials elsewhere. */
  imessageBaseURL?: string;
  facetimeBaseURL?: string;
  fetch?: typeof globalThis.fetch;
}
export const UNIFIED_CONTRACT = 'chert-unified-v1';
export const UNIFIED_SCOPES = ['imessage:events:read', 'imessage:webhooks:manage', 'imessage:messages:send',
  'facetime:calls:read', 'facetime:calls:create', 'facetime:calls:control'] as const;
export type UnifiedScope = typeof UNIFIED_SCOPES[number];
export class UnsupportedUnifiedBackend extends Error {
  readonly code = 'unsupported_unified_backend';
  constructor() { super('The configured services do not support the required unified contract.'); this.name = 'UnsupportedUnifiedBackend'; }
}

function serviceOrigin(value: string): string {
  // Reuse the existing strict origin validation without sending a request.
  new ChertControlPlane({ baseUrl: value });
  return new URL(value).origin;
}

async function unifiedTransport(options: Pick<UnifiedSessionOptions, 'imessageBaseURL' | 'facetimeBaseURL' | 'fetch'>) {
  const imessage = serviceOrigin(options.imessageBaseURL === undefined ? 'https://console.trychert.com' : options.imessageBaseURL);
  const facetime = serviceOrigin(options.facetimeBaseURL === undefined ? 'https://facetime.trychert.com' : options.facetimeBaseURL);
  const fetcher = options.fetch ?? globalThis.fetch;
  let response: Response;
  let envelope: any;
  try {
    response = await fetcher(`${imessage}/api/v1/sdk/capabilities`, {
      headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15_000), cache: 'no-store',
    });
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new UnsupportedUnifiedBackend(); }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        length += part.value.length; if (length > 65_536) throw new UnsupportedUnifiedBackend();
        chunks.push(part.value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { throw new UnsupportedUnifiedBackend(); }
  const data = envelope?.data;
  if (data?.contract !== 'chert-unified' || data.contract_version !== 1
    || data.auth?.scheme !== 'Bearer' || data.auth?.token_prefix !== 'chu_'
    || data.auth?.audience !== 'chert.unified-api:v1'
    || data.auth?.login_url !== `${facetime}/api/v1/cli/logins`
    || data.services?.imessage?.base_url !== `${imessage}/api/v1`
    || data.services?.facetime?.base_url !== `${facetime}/api/v1`
    || !Array.isArray(data.scopes) || !data.scopes.every((scope: unknown) => typeof scope === 'string')
    || new Set(data.scopes).size !== data.scopes.length
    || !UNIFIED_SCOPES.every(scope => data.scopes.includes(scope))) throw new UnsupportedUnifiedBackend();
  const guardedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (![imessage, facetime].includes(url.origin) || !url.pathname.startsWith('/api/v1/')) throw new UnsupportedUnifiedBackend();
    const headers = new Headers(init?.headers);
    headers.set('X-Chert-Contract', UNIFIED_CONTRACT);
    const result = await fetcher(input, { ...init, headers, redirect: 'error' });
    if (result.headers.get('X-Chert-Contract') !== UNIFIED_CONTRACT) {
      await result.body?.cancel().catch(() => {}); throw new UnsupportedUnifiedBackend();
    }
    return result;
  }) as typeof globalThis.fetch;
  return { imessage, facetime, fetch: guardedFetch };
}

/** One project context, two existing transports. No credential conversion or provisioning. */
export class ChertSDK {
  readonly projectId: string;
  readonly imessage: ChertClient;
  readonly facetime: ChertControlPlane;
  /** Opt in to the new backend contract; never reinterpret an existing channel credential. */
  static async connect(options: UnifiedSessionOptions): Promise<ChertSDK> {
    if (!/^chu_[A-Za-z0-9_-]{43}(?![\s\S])/.test(options.accessToken)
      || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}(?![\s\S])/i.test(options.projectId)) throw new TypeError('A unified session token and project UUID are required');
    const transport = await unifiedTransport(options);
    return new ChertSDK({ projectId: options.projectId,
      imessage: { apiKey: options.accessToken, baseURL: transport.imessage, fetch: transport.fetch },
      facetime: { token: options.accessToken, baseUrl: transport.facetime, fetch: transport.fetch },
    });
  }
  constructor(options: ChertSDKOptions) {
    if (!options.projectId.trim()) throw new TypeError('An explicit projectId is required');
    this.projectId = options.projectId;
    this.imessage = new ChertClient(options.imessage);
    this.facetime = new ChertControlPlane({ ...options.facetime, projectId: options.projectId });
  }
}
