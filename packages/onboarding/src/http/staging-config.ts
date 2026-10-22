import { isAbsolute } from 'node:path';

export interface StagingConfig {
  publicOrigin: string;
  workerOrigin: string;
  mainLine: string;
  recipients: string[];
  dataDirectory: string;
  encryptionKey: Uint8Array;
  proxySecret: string;
  inboundSecret: string;
  outboundSecret: string;
  stripeSecret: string;
  stripeWebhookSecret: string;
  stripePrices: { shared: string; dedicated: string };
  port: number;
  faceTimeEnabled: boolean;
}
/** Configuration errors identify the field, never its secret value. */
export class StagingConfigError extends Error {
  constructor(field: string) { super(`Invalid or missing staging setting: ${field}`); }
}
function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (!value || value !== value.trim()) throw new StagingConfigError(name);
  return value;
}
function url(value: string, name: string, loopback: boolean): string {
  let parsed: URL; try { parsed = new URL(value); } catch { throw new StagingConfigError(name); }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/' ||
    !(parsed.protocol === 'https:' || (loopback && parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)))) throw new StagingConfigError(name);
  return parsed.origin;
}
export function readStagingConfig(env: Record<string, string | undefined>): StagingConfig {
  if (env.CHERT_DEPLOYMENT_ENV !== 'staging') throw new StagingConfigError('CHERT_DEPLOYMENT_ENV');
  const key = required(env, 'CHERT_ONBOARDING_KEY');
  const encryptionKey = new Uint8Array(Buffer.from(key, 'base64url'));
  if (!/^[A-Za-z0-9_-]{43}$/.test(key) || encryptionKey.length !== 32 || Buffer.from(encryptionKey).toString('base64url') !== key) throw new StagingConfigError('CHERT_ONBOARDING_KEY');
  const inboundSecret = required(env, 'CHERT_WORKER_INBOUND_SECRET'), outboundSecret = required(env, 'CHERT_WORKER_OUTBOUND_SECRET');
  if (Buffer.byteLength(inboundSecret) < 32) throw new StagingConfigError('CHERT_WORKER_INBOUND_SECRET');
  if (Buffer.byteLength(outboundSecret) < 32 || outboundSecret === inboundSecret || outboundSecret === key || inboundSecret === key) throw new StagingConfigError('CHERT_WORKER_OUTBOUND_SECRET');
  const proxySecret=required(env,'CHERT_PROXY_SECRET');
  if(Buffer.byteLength(proxySecret)<32||[key,inboundSecret,outboundSecret].includes(proxySecret))throw new StagingConfigError('CHERT_PROXY_SECRET');
  const mainLine = required(env, 'CHERT_MAIN_LINE');
  if (!/^\+[1-9]\d{7,14}$/.test(mainLine)) throw new StagingConfigError('CHERT_MAIN_LINE');
  const recipients = [...new Set(required(env, 'CHERT_STAGING_RECIPIENTS').split(',').map(v => v.trim()))];
  if (recipients.length > 20 || recipients.some(v => !/^\+[1-9]\d{7,14}$/.test(v) || v === mainLine)) throw new StagingConfigError('CHERT_STAGING_RECIPIENTS');
  const dataDirectory = required(env, 'CHERT_ONBOARDING_DATA_DIR');
  if (!isAbsolute(dataDirectory) || /[\x00-\x1f]/.test(dataDirectory)) throw new StagingConfigError('CHERT_ONBOARDING_DATA_DIR');
  const stripeSecret = required(env, 'STRIPE_SECRET_KEY'), stripeWebhookSecret = required(env, 'STRIPE_WEBHOOK_SECRET');
  if (!/^sk_test_[A-Za-z0-9_]+$/.test(stripeSecret)) throw new StagingConfigError('STRIPE_SECRET_KEY');
  if (!/^whsec_[A-Za-z0-9_]+$/.test(stripeWebhookSecret)) throw new StagingConfigError('STRIPE_WEBHOOK_SECRET');
  const stripePrices = { shared: required(env, 'STRIPE_SHARED_PRICE_ID'), dedicated: required(env, 'STRIPE_DEDICATED_PRICE_ID') };
  if (Object.values(stripePrices).some(v => !/^price_[A-Za-z0-9_]+$/.test(v)) || stripePrices.shared === stripePrices.dedicated) throw new StagingConfigError('STRIPE_SHARED_PRICE_ID/STRIPE_DEDICATED_PRICE_ID');
  const portText = env.CHERT_ONBOARDING_PORT ?? '4193';
  if (!/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) throw new StagingConfigError('CHERT_ONBOARDING_PORT');
  if (env.CHERT_FACETIME_ENABLED !== undefined && !['true', 'false'].includes(env.CHERT_FACETIME_ENABLED)) throw new StagingConfigError('CHERT_FACETIME_ENABLED');
  return { publicOrigin: url(required(env, 'CHERT_PUBLIC_ORIGIN'), 'CHERT_PUBLIC_ORIGIN', false), workerOrigin: url(required(env, 'CHERT_WORKER_ORIGIN'), 'CHERT_WORKER_ORIGIN', true), mainLine, recipients, dataDirectory, encryptionKey, proxySecret, inboundSecret, outboundSecret, stripeSecret, stripeWebhookSecret, stripePrices, port: Number(portText), faceTimeEnabled: env.CHERT_FACETIME_ENABLED === 'true' };
}
