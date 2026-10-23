export class CLIError extends Error {
  constructor(readonly code: string, readonly exit: number, readonly action: string) { super(code); }
}
export function failure(error: unknown): CLIError {
  return error instanceof CLIError ? error : new CLIError('operation_failed', 1, 'Operation failed. Inspect local permissions and configuration; retained state has not been reset.');
}
