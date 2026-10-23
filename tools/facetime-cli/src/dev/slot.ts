/**
 * A time slot on a shared line: `chert dev --until HH:MM` or `--minutes N`. Teams share a few lines in short slots, so a
 * session ends by itself at the end of its slot, the way the first Ctrl+C ends it, but never under a call in progress.
 */
import { setTimeout as pause } from 'node:timers/promises';
import { CLIError } from '../cli/errors.js';
import type { DevHandler } from './dispatch-handler.js';

/** When the slot ends, and the same time as a person reads it on this computer's clock (HH:MM, 24-hour). */
export interface Slot { endsAt: number; label: string }
const clockTime = (time: Date) => [time.getHours(), time.getMinutes()].map(part => String(part).padStart(2, '0')).join(':');

/** The slot asked for, judged before any network call. --until is today on this computer's clock; --minutes is 1 to 240. */
export function slotFrom(values: { until?: string; minutes?: string }, now: Date = new Date()): Slot | undefined {
  if (values.until !== undefined && values.minutes !== undefined) throw new CLIError('invalid_usage', 2, 'Use --until or --minutes, not both.');
  if (values.until !== undefined) {
    const time = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(values.until);
    if (!time) throw new CLIError('invalid_usage', 2, 'Give --until a time of day as HH:MM on the 24-hour clock, for example --until 14:30.');
    const end = new Date(now); end.setHours(Number(time[1]), Number(time[2]), 0, 0);
    if (end.getTime() <= now.getTime()) throw new CLIError('slot_time_passed', 2,
      `${clockTime(end)} has already passed today (it is ${clockTime(now)} on this computer). Give a later time with --until HH:MM, or a length with --minutes N.`);
    return { endsAt: end.getTime(), label: clockTime(end) };
  }
  if (values.minutes !== undefined) {
    const minutes = /^\d{1,3}$/.test(values.minutes) ? Number(values.minutes) : NaN;
    if (!(minutes >= 1 && minutes <= 240)) throw new CLIError('invalid_usage', 2, 'Give --minutes a whole number from 1 to 240.');
    // Rounded down to the minute it names, so 'until 14:13' is true and the next team can start at 14:13:00.
    const end = new Date(now.getTime() + minutes * 60_000); end.setSeconds(0, 0);
    return { endsAt: end.getTime(), label: clockTime(end) };
  }
  return undefined;
}

/** The calls this session is answering or serving. `decided` takes each decision Chert was sent for a call; only the first counts. */
export interface CallTracker { handler: DevHandler; busy(): boolean; decided(callId: string, action: unknown): void }
/**
 * Wraps the handler to see each call from its ring until Chert says it ended and its cleanup is done: stopping before then
 * would decline it or leave its work unfinished. A call that rings after the slot ended is declined at once, before the
 * agent is asked, as a drained line would decline it: answering it would drop it when the line is released a moment later. A call whose end never arrives stops counting once it can no longer last: past its answer deadline
 * while it rings, past the room token's expiry once answered.
 */
export function trackCalls(handler: DevHandler, slot: Slot, now: () => number, late?: (callId: string) => void): CallTracker {
  const live = new Map<string, number>(), told = new Set<string>();
  const over = (callId: string) => { live.delete(callId); told.delete(callId); };
  const tracked: DevHandler = { ...handler,
    async prepare(call, context) {
      if (now() >= slot.endsAt) { late?.(call.call_id); return { action: 'decline' }; }
      live.set(call.call_id, call.deadline_at);
      try {
        const decision = await handler.prepare(call, context);
        if (decision.action === 'accept' && live.has(call.call_id)) live.set(call.call_id, decision.session_expires_at); else over(call.call_id);
        return decision;
      } catch (error) { over(call.call_id); throw error; }
    } };
  const { lifecycle, recover } = handler;
  if (lifecycle) tracked.lifecycle = async (call, event, context) => {
    try { return await lifecycle.call(handler, call, event, context); }
    // With recovery the call's cleanup follows the event, and the call is over once that is done.
    finally { if (!recover && event.transition !== 'started') over(call.call_id); }
  };
  if (recover) tracked.recover = async (call, context) => {
    try { return await recover.call(handler, call, context); }
    finally { if (context.authoritative_terminal || context.cancel_requested) over(call.call_id); }
  };
  return {
    handler: tracked,
    busy() { const at = now(); for (const [callId, until] of live) if (until <= at) live.delete(callId); return live.size > 0; },
    // A call can be offered again after a relay reconnect, and a fresh connector then answers no while the call is up.
    decided(callId, action) { if (told.has(callId)) return; told.add(callId); if (action !== 'accept') over(callId); },
  };
}

export interface SlotWatch { busy(): boolean; emit(record: Record<string, unknown>): void; stop(): void; signal: AbortSignal; now(): number; checkMs: number }
/**
 * One warning a minute before the slot ends. At the end, `stop` runs, the same stop the first Ctrl+C makes, so the
 * session drains and releases the line; with a call in progress it says so once and stops when the call is over.
 * The wall clock is read on every check, so a computer that slept still stops at the time it showed.
 */
export async function watchSlot(slot: Slot, watch: SlotWatch): Promise<void> {
  let warned = false, waited = false;
  while (!watch.signal.aborted) {
    const left = slot.endsAt - watch.now();
    if (left <= 0) {
      if (!watch.busy()) {
        watch.emit({ code: 'slot_over', ends_at: slot.endsAt, message: waited ? 'The call ended and your slot is over. Stopping: releasing the line…' : `Your slot ended at ${slot.label}. Stopping: releasing the line…` });
        watch.stop();
        return;
      }
      if (!waited) {
        waited = true;
        watch.emit({ code: 'slot_waiting_for_call', ends_at: slot.endsAt, message: `Your slot ended at ${slot.label} during a call. The call can finish; chert dev then stops and releases the line.` });
      }
    } else if (!warned && left <= 60_000) {
      warned = true;
      watch.emit({ code: 'slot_ending', ends_at: slot.endsAt, message: `${left >= 55_000 ? 'One minute' : 'Less than a minute'} left: your slot ends at ${slot.label}. A call still in progress then can finish first.` });
    }
    await pause(watch.checkMs, undefined, { signal: watch.signal }).catch(() => {});
  }
}
