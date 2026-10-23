/** Ctrl+C handling for `chert dev`: the line must be released before the process ends,
 * so a second signal waits and only a third forces the exit. A closed terminal or a dropped SSH session counts as the
 * first Ctrl+C: its hangup (SIGHUP), or a write that fails because the output is gone (EIO, EPIPE), whichever comes first.
 * Returns a function that removes the listeners. */
type Signal = 'SIGINT' | 'SIGTERM' | 'SIGHUP';
interface Output { on(event: 'error', listener: () => void): unknown; off(event: 'error', listener: () => void): unknown }
export interface SignalSource {
  on(event: Signal, listener: () => void): unknown; off(event: Signal, listener: () => void): unknown; exit(code: number): void;
  stdout?: Output; stderr?: Output;
}
export function stopOnSignals(controller: AbortController, emit: (record: Record<string, unknown>) => void, source: SignalSource = process): () => void {
  let count = 0, gone = false;
  const listener = () => {
    count++;
    if (count === 1) { emit({ code: 'stopping', message: 'Stopping: releasing the line…' }); controller.abort(); }
    else if (count === 2) emit({ code: 'still_stopping', message: 'Still releasing the line. Press Ctrl+C once more to quit without releasing it.' });
    else source.exit(130);
  };
  // The terminal going away is one stop, however many ways it shows. Later write errors are ignored, so they cannot end the release.
  const terminalGone = () => { if (gone) return; gone = true; listener(); };
  const outputs = [source.stdout, source.stderr].filter(output => output !== undefined);
  for (const output of outputs) output.on('error', terminalGone);
  source.on('SIGINT', listener); source.on('SIGTERM', listener); source.on('SIGHUP', terminalGone);
  return () => {
    source.off('SIGINT', listener); source.off('SIGTERM', listener); source.off('SIGHUP', terminalGone);
    // Once the output is gone, a write after the session (the final record) must still not crash the process.
    if (!gone) for (const output of outputs) output.off('error', terminalGone);
  };
}
