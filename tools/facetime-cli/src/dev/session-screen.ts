import { frame, header, INDENT, innerWidth, palette, printable, wrap, type Look } from './frame.js';

export interface SessionView extends Look { version?: string; agent: string; line?: string; project?: string;
  /** The line's FaceTime address as Chert masks it. */
  address?: string;
  /** Where the LiveKit keys were read from, when it was a file in the current folder. */
  keys?: string }

/**
 * What opens a `chert dev` session in a terminal, in the same dress as the sign-in screens: the CHERT header and an
 * ON THE LINE box saying which agent answers which line. It is printed once; the call lines follow under it.
 */
export function renderSession(view: SessionView): string {
  const p = palette(view), width = innerWidth(view), labelWidth = 10;
  const facts: [string, string | undefined][] = [['Agent', view.agent], ['Line', printable(view.line, 80)], ['Address', printable(view.address, 80)], ['Project', printable(view.project, 200)], ['Keys', printable(view.keys, 200)]];
  const rows = facts.flatMap(([name, value]) => value === undefined ? []
    : wrap(value, Math.max(8, width - labelWidth)).map((line, i) => (i ? ' '.repeat(labelWidth) : p.dim(name.padEnd(labelWidth))) + p.bold(line)));
  return ['', ...header('dev', view.version, view), '', ...frame('ON THE LINE', rows, view, { tight: true }), '', `${INDENT}${p.dim('Ctrl+C releases the line.')}`, ''].join('\n');
}
