/** Development acceptance declarations; no import performs SSH or a send. */
export const approval: 'one-reviewed-blooio-production-pipeline-send';
export type PipelineProvider = 'blooio' | 'linq' | 'sendblue' | 'blooio-v4' | 'python' | 'rust' | 'cpp';
export type PipelineConfig = {
  approval: `one-reviewed-${PipelineProvider}-production-pipeline-send`;
  provider?: PipelineProvider;
  run: string;
  marker: string;
  mode: 'bridge';
  from: string;
  to: string;
  version?: string;
};
export type PipelineReceipt = {
  attempted: boolean;
  [field: string]: unknown;
};
export type ReceiptJournal = {
  path: string;
  receipt: PipelineReceipt;
  save(update: Record<string, unknown>): void;
  close(): void;
};
export type NativeSendRequest = {
  action: 'send';
  provider: PipelineProvider;
  from: string;
  to: string;
  marker: string;
  body: { to: string; message: string; idempotency_key: string; native_sms_disabled: true };
};
export type RemoteRequest = NativeSendRequest | { action: 'preflight' } | {
  action: 'observe'; from: string; to: string; marker: string;
  message_id: string; idempotency_key: string; guid?: string;
};
export function providerForPlan(config: unknown): PipelineProvider;
export function planFromArgs(args: string[]): { provider: PipelineProvider; approval: PipelineConfig['approval'] };
export function validateConfig(value: unknown): PipelineConfig;
export function createReceipt(path: string, config: unknown, claim?: boolean): ReceiptJournal;
export function nativeEvidence(value: unknown): Record<string, unknown>;
export function observationEvidence(value: unknown): Record<string, unknown>;
export function assertLocalFixtureRequest(input: RequestInfo | URL, init: RequestInit | undefined,
  origin: string | null, routePath: string): void;
export function createBroker(config: unknown, journal: ReceiptJournal,
  execute: (payload: NativeSendRequest) => Promise<{ status: number; body: unknown }>):
  (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export function remote(payload: RemoteRequest, timeout?: number): Promise<unknown>;
