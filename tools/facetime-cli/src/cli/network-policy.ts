import { loopbackOrigin } from '../transport/http.js';
import { Fault } from '../protocol/v1.js';
/** Standalone CLI process policy: pinned SDK has no public fetch injection.
 * Restore on exit; never install this in a library consumer or shared server. */
export function loopbackFetchPolicy(origins: string[]): () => void {
  const allowed = new Set(origins.map(origin => loopbackOrigin(origin).origin));
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (!allowed.has(url.origin) || url.username || url.password) return Promise.reject(new Fault('forbidden'));
    return original(input, { ...init, redirect: 'error' });
  };
  return () => { globalThis.fetch = original; };
}
