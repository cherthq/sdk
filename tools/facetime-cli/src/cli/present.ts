/**
 * How one record of `chert dev` is drawn in a terminal: a mark in the first column, and the time of day on call lines,
 * so a long session reads as a list of calls. `--json` prints the records themselves and never comes through here.
 * Like the help, it loads only frame.ts, which loads nothing, so the entry point stays as fast as Node itself.
 */
import { ACCENT } from '../dev/frame.js';

const marks: Record<string, string> = {
  dev_connected: '✓', dev_reconnected: '✓', agent_warm: '✓', call_accepted: '✓',
  agent_not_warm: '✗', prewarm_off: '!', session_expiring: '!', reconnecting: '!', displaced: '!', frame_rejected: '!', cleanup_pending: '!', still_stopping: '!',
  slot_ending: '!', slot_waiting_for_call: '!', slot_call_declined: '!',
  call_declined: '✗', release_failed: '✗',
};
/** Colour for a terminal that takes it: steel blue for done, yellow for attention, red for a failure, dim for what matters less. */
export interface Style { color: boolean }
const paint = (style: Style | undefined, code: string, text: string) => style?.color && text.trim() ? `\x1b[${code}m${text}\x1b[0m` : text;
const tones: Record<string, string> = { '✓': `38;5;${ACCENT.index}`, '!': '33', '✗': '31' };
/** True when a stream is a terminal that should get colour and the two-space margin of the other screens. */
export function styleFor(stream: { isTTY?: boolean }, env: NodeJS.ProcessEnv): Style | undefined {
  return stream.isTTY === true && env.TERM !== 'dumb' ? { color: !env.NO_COLOR } : undefined;
}
function clock(at: unknown): string {
  const time = typeof at === 'string' ? new Date(at) : undefined;
  if (!time || Number.isNaN(time.getTime())) return '';
  return `${[time.getHours(), time.getMinutes(), time.getSeconds()].map(part => String(part).padStart(2, '0')).join(':')}  `;
}
export function sessionLine(record: Record<string, unknown>, style?: Style): string | undefined {
  if (typeof record.message !== 'string') return undefined;
  // A whole screen, already drawn for this terminal.
  if (record.screen === true) return record.message;
  const code = String(record.code);
  const mark = code === 'dev_stopped' ? (record.retained ? '!' : '✓')
    : code === 'call_media' ? (record.state === 'ok' ? '✓' : record.state === 'several_audio' || record.state === 'several_tracks' ? '✗' : '!')
    : code === 'call_bridge_ready' ? (record.room_signal === false ? '!' : '✓')
    : code === 'line_state' ? (record.ok === false ? '!' : '✓') : marks[code] ?? ' ';
  const time = code.startsWith('call_') ? clock(record.at) : '';
  return `${style ? '  ' : ''}${paint(style, tones[mark] ?? '', mark)} ${paint(style, '2', time)}${record.message}`;
}
/** An error as a person reads it: what to do, then the code, for the troubleshooting tables and for searching. */
export function errorLine(code: string, action: string, style?: Style): string {
  return style ? `  ${paint(style, '31', '✗')} ${action} ${paint(style, '2', `(${code})`)}` : `${action} (${code})`;
}
