import type { Receipt } from '../protocol/v1.js';
export type Reconciliation = { status: 'unknown' | 'forbidden' | 'not_found' } |
  { status: 'known'; receipt: Receipt; terminal: boolean };
