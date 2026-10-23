import type { Entry } from './journal.js';
import type { Budget } from './deadline.js';
export interface Ready { room: string; job: string; participant: string; nonce: string; publishers: string[]; prepared: boolean; bridge: { livekit_url: string; participant_token: string } }
export interface Agent {
  prepare(entry: Entry, budget: Budget, signal: AbortSignal): Promise<Ready>;
  // True only when this exact remote operation can produce no further effects.
  // Local promise rejection or a currently absent resource is not settlement.
  settled(entry: Entry): Promise<boolean>;
  inspect(entry: Entry): Promise<'owned' | 'absent' | 'unknown' | 'foreign'>;
  delete(entry: Entry): Promise<void>;
}
