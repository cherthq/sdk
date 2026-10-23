import { spawn } from 'node:child_process';
import { CLEAR_SCREEN, INDENT, fit, fits, frame, glyphs, header, innerWidth, lookOf, palette, pieces, printable, redraw, sizeOf, splitKeys, visible, wrap, type Look, type Terminal } from './frame.js';

export interface WaitingView extends Look {
  rows: number; code: string; url: string; secondsLeft: number;
  /** True when a browser was opened on this computer. */
  opened: boolean;
  /** An SSH session: there is no browser or clipboard here. */
  remote: boolean;
  /** Advances the spinner; leave it out for a still picture. */
  frame?: number;
  /** A line under the countdown: the browser could not be opened, the address was copied. */
  note?: string;
}

/** The code with its characters spaced out, so it is easy to compare with the browser: `K D T F  -  2 9 3 7`. */
export function spaced(code: string): string { return code.split('-').map(part => [...part].join(' ')).join('  -  '); }
/** `mm:ss`, never below zero. */
export function countdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** The screen while Chert waits for the approval: what is happening, the code, where to go if the browser did not open, and the keys. */
export function renderWaiting(view: WaitingView): string {
  const p = palette(view), g = glyphs(view), width = innerWidth(view);
  const spin = g.spinner[(view.frame ?? 0) % g.spinner.length]!;
  const doing = wrap(view.opened ? `Opening your browser${g.ellipsis}` : view.remote ? 'Open the address below on any device' : `Waiting for approval${g.ellipsis}`, Math.max(8, view.columns - INDENT.length - 2));
  const code = spaced(view.code), shown = code.length + 4 <= width ? `    ${code}` : code.length <= width ? code : view.code;
  const label = view.opened ? "Didn't open?" : 'Address';
  const address = visible(`${label}  ${view.url}`) <= width ? [`${p.dim(label)}  ${p.link(view.url)}`] : [p.dim(label), ...pieces(view.url, width).map(piece => p.link(piece))];
  const confirm = wrap(`Confirm this code matches the one ${view.opened ? 'in your browser' : 'on the approval page'}`, width);
  const keys: [string, string][] = view.remote ? [['esc', 'Cancel']] : [['esc', 'Cancel'], ['c', 'Copy URL']];
  const oneLine = `${INDENT}${keys.map(([key, what]) => `${key}  ${what}`).join('        ')}`;
  const hints = oneLine.length <= view.columns ? [`${INDENT}${keys.map(([key, what]) => `${key}  ${p.dim(what)}`).join('        ')}`] : keys.map(([key, what]) => `${INDENT}${key}  ${p.dim(what)}`);
  // On a short window the blank rows go first, then the sentence and the address label, so the code, the countdown and the keys stay in view.
  const build = (tight: boolean, bare: boolean) => {
    const gap = tight ? [] : [''];
    const where = bare ? (visible(view.url) <= width ? [p.link(view.url)] : pieces(view.url, width).map(piece => p.link(piece))) : address;
    const body = [...(bare ? [] : [...confirm, ...gap]), p.bold(shown), ...gap, ...where, `${p.dim('Expires in')} ${countdown(view.secondsLeft)}`,
      ...(view.note ? [...gap, ...wrap(view.note, width).map(line => p.dim(line))] : [])];
    // Bare: the frame's title says what this is, so the header goes before the keys do.
    return ['', ...(bare ? [] : header('Sign in', undefined, view)), ...gap, `${INDENT}${p.accent(spin)} ${doing[0] ?? ''}`, ...doing.slice(1).map(line => `${INDENT}  ${line}`), ...gap,
      ...frame('WAITING FOR APPROVAL', body, view, { tight }), ...gap, ...hints];
  };
  const levels = [build(false, false), build(true, false), build(true, true)];
  return fit(levels.find(lines => fits(lines, view.rows)) ?? levels[2]!, view.rows);
}

export interface WaitingInfo { code: string; url: string; urlComplete: string; expiresIn: number; opened: boolean; remote: boolean; note?: string }
export interface WaitingDeps { copy(text: string): Promise<boolean>; now(): number }
export interface WaitingScreen { stop(): void }

/** Puts text on the clipboard with the system's own tool, without a shell. False when none works. */
export async function copyToClipboard(text: string): Promise<boolean> {
  const tools: [string, string[]][] = process.platform === 'darwin' ? [['pbcopy', []]] : [['wl-copy', []], ['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]];
  for (const [command, args] of tools) {
    const ok = await new Promise<boolean>(resolve => {
      try {
        const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'ignore'] });
        child.once('error', () => resolve(false));
        child.once('close', code => resolve(code === 0));
        child.stdin.once('error', () => resolve(false));
        child.stdin.end(text);
      } catch { resolve(false); }
    });
    if (ok) return true;
  }
  return false;
}
export const waitingDeps: WaitingDeps = { copy: copyToClipboard, now: () => Date.now() };

/**
 * Take over the screen while Chert waits for the approval. The countdown is read from the clock on every tick, `c`
 * copies the address with the code in it, and escape or Ctrl+C calls `cancel`. `stop` clears the screen and puts the
 * terminal back; calling it twice is harmless.
 */
export function showWaiting(terminal: Terminal, info: WaitingInfo, cancel: () => void, deps: WaitingDeps = waitingDeps): WaitingScreen {
  const { input, output } = terminal;
  const started = deps.now();
  let frame = 0, note = info.note, stopped = false, noteTimer: NodeJS.Timeout | undefined;
  const draw = () => {
    if (stopped) return;
    redraw(output, renderWaiting({ ...lookOf(terminal), rows: sizeOf(output).rows, code: info.code, url: info.url, secondsLeft: info.expiresIn - (deps.now() - started) / 1000,
      opened: info.opened, remote: info.remote, frame, ...(note ? { note } : {}) }));
  };
  const say = (text: string) => {
    if (stopped) return;
    note = text; draw(); clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { note = info.note; draw(); }, 2500);
  };
  const couldNot = 'Could not copy on this computer. Type the address instead.';
  const onKey = (chunk: string) => {
    for (const key of splitKeys(chunk)) {
      if (key === '\x1b' || key === '\x03' || key === '\x04' || key === 'q' || key === 'Q') { cancel(); return; }
      if ((key === 'c' || key === 'C') && !info.remote) void deps.copy(info.urlComplete).then(ok => say(ok ? 'Copied the address to the clipboard.' : couldNot), () => say(couldNot));
    }
  };
  const resized = () => { output.write(CLEAR_SCREEN); draw(); };
  input.setRawMode(true); input.resume(); input.setEncoding('utf8'); output.write('\x1b[?25l' + CLEAR_SCREEN);
  const ticker = setInterval(() => { frame++; draw(); }, terminal.color ? 120 : 1000);
  output.on('resize', resized); input.on('data', onKey);
  draw();
  return {
    stop() {
      if (stopped) return;
      stopped = true; clearInterval(ticker); clearTimeout(noteTimer); output.off('resize', resized); input.off('data', onKey);
      output.write(CLEAR_SCREEN + '\x1b[?25h'); input.setRawMode(false); input.pause();
    },
  };
}

export interface ConnectedView extends Look {
  subtitle: string; version?: string; email?: string; project?: string; device?: string; expiresAt?: number;
  /** The clock the expiry is measured against; tests pin it. */
  now?: number;
  commands: readonly (readonly [string, string])[];
  /** A dim line under the frame, for a credential that needs a word of explanation. */
  note?: string;
  /** A line under the frame at full strength, for something the person should act on. */
  warning?: string;
  footer?: string;
}

/** When a credential runs out, in the words a person uses: a date for weeks, a time for hours, minutes for less than an hour. */
export function expiry(expiresAt: number, now: number): string {
  const date = new Date(expiresAt), hours = (expiresAt - now) / 3_600_000;
  if (hours >= 36) return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} (${Math.round(hours / 24)} days)`;
  if (hours >= 1.5) return `${date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} (about ${Math.round(hours)} hours)`;
  if (hours >= 0.75) return `${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} (about 1 hour)`;
  return `${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} (about ${Math.max(1, Math.round(hours * 60))} minutes)`;
}

/** The widest command column that lets the longest description sit on the same line. */
const COMMAND_COLUMN = 23;

/** Who is signed in, a CONNECTED box with what is known, then the commands to run next. Printed into the normal flow, not a takeover. */
export function renderConnected(view: ConnectedView): string {
  const p = palette(view), g = glyphs(view), width = innerWidth(view), labelWidth = 10, textWidth = Math.max(8, view.columns - INDENT.length - 2);
  const email = printable(view.email, 320), project = printable(view.project, 200), device = printable(view.device, 200);
  const facts: [string, string | undefined][] = [['Project', project], ['Device', device],
    ['Expires', view.expiresAt === undefined ? undefined : expiry(view.expiresAt, view.now ?? Date.now())]];
  const rows = facts.flatMap(([name, value]) => value === undefined ? []
    : wrap(value, Math.max(8, width - labelWidth)).map((line, i) => (i ? ' '.repeat(labelWidth) : p.dim(name.padEnd(labelWidth))) + p.bold(line)));
  const who = wrap(`Signed in${email ? ` as ${email}` : ''}`, Math.max(8, textWidth - 2)).map((line, i) => i ? `${INDENT}  ${line}` : `${INDENT}${p.accent(g.check)} ${email && line.endsWith(email) ? line.slice(0, -email.length) + p.bold(email) : line}`);
  const longest = Math.max(0, ...view.commands.map(([, what]) => what.length));
  const wide = INDENT.length + 2 + COMMAND_COLUMN + 1 + longest <= view.columns;
  const next = view.commands.length ? [`${INDENT}${p.dim('Next')}`, ...view.commands.flatMap(([command, what]) => wide
    ? [`${INDENT}  ${p.accent(command.padEnd(COMMAND_COLUMN))} ${what}`]
    : [`${INDENT}  ${p.accent(command)}`, ...wrap(what, Math.max(8, view.columns - 8)).map(line => `${INDENT}      ${p.dim(line)}`)])] : [];
  const box = rows.length ? frame('CONNECTED', rows, view) : [];
  const note = view.note ? wrap(view.note, textWidth).map(line => `${INDENT}${p.dim(line)}`) : [];
  const warning = view.warning ? wrap(view.warning, textWidth).map(line => INDENT + line) : [];
  const footer = view.footer ? wrap(view.footer, textWidth).map(line => `${INDENT}${p.dim(line)}`) : [];
  return ['', ...header(view.subtitle, view.version, view), '', ...who, '', ...box, ...(box.length ? [''] : []), ...(warning.length ? [...warning, ''] : []), ...(note.length ? [...note, ''] : []), ...next,
    ...(footer.length ? [...(next.length ? [''] : []), ...footer] : []), ''].join('\n');
}
