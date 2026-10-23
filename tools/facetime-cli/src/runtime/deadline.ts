import { Fault } from '../protocol/v1.js';
export interface Clock { wall(): number; mono(): number }
export interface Scheduler extends Clock { schedule(ms: number, fn: () => void): () => void }
export const systemClock: Scheduler = {
  wall: () => Date.now(), mono: () => performance.now(),
  schedule(ms, fn) { const timer = setTimeout(fn, Math.max(0, ms)); return () => clearTimeout(timer); },
};
export interface Timing { created_at: number; sent_at: number; deadline_at: number; prepare_deadline_at: number; remaining_ms: number }
/** The control plane's incoming decision window is 5 s by default and 10 s when configured; the Mac worker allows 10 s. */
export const MAX_DECISION_WINDOW_MS = 10_000;
export class Budget {
  private readonly started: number;
  private readonly cap: number;
  private readonly prepCap: number;
  constructor(private clock: Clock, private timing: Timing) {
    const t = timing;
    if (![t.created_at, t.sent_at, t.deadline_at, t.prepare_deadline_at, t.remaining_ms].every(Number.isFinite) || t.deadline_at - t.created_at > MAX_DECISION_WINDOW_MS ||
        t.deadline_at <= t.created_at || t.prepare_deadline_at <= t.created_at ||
        t.prepare_deadline_at > t.created_at + MAX_DECISION_WINDOW_MS - 1000 || t.deadline_at - t.prepare_deadline_at < 1000 ||
        t.sent_at < t.created_at || t.sent_at - clock.wall() > 250 ||
        t.remaining_ms < 0 || t.remaining_ms > t.deadline_at - t.sent_at) throw new Fault('invalid_deadline');
    this.started = clock.mono();
    this.cap = Math.max(0, Math.min(t.deadline_at - clock.wall(), t.remaining_ms - Math.max(0, clock.wall() - t.sent_at)));
    this.prepCap = Math.max(0, Math.min(t.prepare_deadline_at - clock.wall(), this.cap - (t.deadline_at - t.prepare_deadline_at)));
  }
  remaining(prepare = false): number {
    return Math.max(0, Math.min(
      (prepare ? this.timing.prepare_deadline_at : this.timing.deadline_at) - this.clock.wall(),
      (prepare ? this.prepCap : this.cap) - Math.max(0, this.clock.mono() - this.started),
    ));
  }
  resourceRemaining(expiresAt: number): number {
    return Math.max(0, Math.min(expiresAt - this.clock.wall(), this.cap + (expiresAt - this.timing.deadline_at) - Math.max(0, this.clock.mono() - this.started)));
  }
  assert(prepare = false): void { if (this.remaining(prepare) <= 0) throw new Fault('deadline_exceeded'); }
}
