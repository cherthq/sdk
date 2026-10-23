import type { Scheduler } from '../../src/runtime/deadline.js';
export class ManualClock implements Scheduler {
  time = 100_000;
  elapsed = 0;
  private tasks = new Map<number, { at: number; fn: () => void }>();
  private next = 0;
  wall(): number { return this.time; }
  mono(): number { return this.elapsed; }
  schedule(ms: number, fn: () => void): () => void {
    const id = ++this.next; this.tasks.set(id, { at: this.elapsed + ms, fn });
    return () => { this.tasks.delete(id); };
  }
  advance(ms: number, wallMs = ms): void {
    this.elapsed += ms; this.time += wallMs;
    for (const [id, task] of [...this.tasks]) if (task.at <= this.elapsed) { this.tasks.delete(id); task.fn(); }
  }
}
export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export async function settle(): Promise<void> { for (let i = 0; i < 20; i++) await Promise.resolve(); }
