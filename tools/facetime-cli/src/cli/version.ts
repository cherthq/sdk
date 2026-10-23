import { readFileSync } from 'node:fs';

/** The version in this package's package.json, or nothing when it cannot be read: a screen must not fail over a label. */
export function cliVersion(): string | undefined {
  try {
    const { version } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version?: unknown };
    return typeof version === 'string' ? version : undefined;
  } catch { return undefined; }
}
