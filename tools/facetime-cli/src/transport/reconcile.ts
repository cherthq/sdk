import { z } from 'zod';
import { receiptSchema, type Owner } from '../protocol/v1.js';
import type { Reconciliation } from '../runtime/reconciliation.js';
import { boundedText, loopbackOrigin, hostedOrigin } from './http.js';
const schema = z.union([
  z.strictObject({ status: z.enum(['unknown', 'forbidden', 'not_found']) }),
  z.strictObject({ status: z.literal('known'), receipt: receiptSchema, terminal: z.boolean() }),
]);
/** Development v1 contract only. Unknown and failed reads never authorize deletion. */
export function reconciliationClient(origin: string, credential: string, hosted = false): (owner: Owner) => Promise<Reconciliation> {
  const endpoint = new URL('/reconcile', hosted ? hostedOrigin(origin) : loopbackOrigin(origin));
  return async owner => {
    try {
      const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(1000),
        headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, body: JSON.stringify(owner) });
      if (!response.ok) { await response.body?.cancel(); return { status: response.status === 403 ? 'forbidden' : 'unknown' }; }
      const parsed = schema.safeParse(JSON.parse(await boundedText(response)));
      return parsed.success ? parsed.data : { status: 'unknown' };
    } catch { return { status: 'unknown' }; }
  };
}
