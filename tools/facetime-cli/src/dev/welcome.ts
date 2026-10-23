import { brailleMark, type MarkCell } from '../cli/logo.js';
import { CLEAR_SCREEN, fit, fits, frame, glyphs, header, INDENT, innerWidth, lookOf, palette, redraw, sizeOf, splitKeys, wrap, type Look, type Terminal } from './frame.js';
import { renderConnected } from './sign-in-screen.js';

export type { Terminal } from './frame.js';
export { CLEAR_SCREEN, splitKeys } from './frame.js';

export type SignInChoice = 'browser' | 'token';
/** The three choices on the welcome screen, in the order shown. The number is the key. */
export const signInOptions: readonly { id: SignInChoice | 'quit'; title: string; remoteTitle?: string }[] = [
  { id: 'browser', title: 'Sign in with browser', remoteTitle: 'Sign in with a code' },
  { id: 'token', title: 'Paste a token instead' },
  { id: 'quit', title: 'Quit' },
];
/**
 * `frame` advances the sheen that crosses the mark; leave it out for a still picture. `remote` is an SSH session.
 * `note` is one sentence shown inside the frame in place of the explanation, when the screen comes back after a choice could not be used.
 */
export interface WelcomeView extends Look { rows: number; frame?: number; remote?: boolean; selected?: number; version?: string; note?: string }
export interface HomeView extends Look { rows: number; email?: string; project?: string; device?: string; expiresAt?: number; now?: number; version?: string; note?: string }

export const MARK_WIDTH = 28;
const mark = brailleMark(MARK_WIDTH);
/** Frames in one pass of the sheen, most of them a rest between crossings. */
const SHEEN_FRAMES = 48;
/** The Chert mark runs from orange at the top to navy at the base. The navy is lifted so it shows on a dark terminal. */
const ORANGE = [245, 145, 50] as const, NAVY = [84, 92, 190] as const;

/** The nearest entry of the 6x6x6 colour cube every 256-colour terminal has. */
function cube([r, g, b]: readonly number[]): number {
  const level = (value: number) => value < 48 ? 0 : value < 115 ? 1 : Math.min(5, Math.round((value - 35) / 40));
  return 16 + 36 * level(r!) + 6 * level(g!) + level(b!);
}

/** The mark in colour. `band` is where the sheen is, in the mark's diagonal coordinate; far outside means none. */
function paintMark(cells: MarkCell[][], look: Look, band: number, indent: string): string[] {
  return cells.map((row, y) => {
    let line = '', current = '';
    row.forEach((cell, x) => {
      if (!look.color || cell.char === ' ') { line += cell.char; return; }
      // Mostly top to bottom, leaning a little to the right, as in the mark itself.
      const t = Math.min(1, Math.max(0, (y + x / row.length * 2 - 1) / (cells.length - 1)));
      const distance = Math.abs(x + y * 2 - band), lift = distance < 2 ? 0.75 : distance < 4 ? 0.3 : 0;
      const rgb = ORANGE.map((from, i) => { const base = from + (NAVY[i]! - from) * t; return Math.round(base + (255 - base) * lift); });
      const code = look.truecolor ? `\x1b[38;2;${rgb.join(';')}m` : `\x1b[38;5;${cube(rgb)}m`;
      if (code !== current) { line += code; current = code; }
      line += cell.char;
    });
    return `${indent}${line.trimEnd()}${current ? '\x1b[0m' : ''}`;
  });
}

/** The first-run screen: the mark when there is room, the CHERT header, and a SIGN IN frame with three numbered choices. */
export function renderWelcome(view: WelcomeView): string {
  const p = palette(view), g = glyphs(view), width = innerWidth(view), selected = view.selected ?? 0;
  const about = view.remote
    ? 'You will get an address to open on any device, and a code to approve there. This computer then stays signed in for 30 days.'
    : 'Your browser opens to approve it. This computer then stays signed in for 30 days.';
  const options = signInOptions.flatMap((option, index) => {
    const title = view.remote && option.remoteTitle ? option.remoteTitle : option.title, key = ` ${index + 1} `;
    const [first = '', ...rest] = wrap(title, Math.max(4, width - 7));
    return index === selected
      ? [`${p.accent(g.pointer)} ${p.badge(key)}  ${p.bold(first)}`, ...rest.map(line => `       ${p.bold(line)}`)]
      : [`  ${p.dim(key)}  ${p.dim(first)}`, ...rest.map(line => `       ${p.dim(line)}`)];
  });
  const docs = 'docs.trychert.com', help = 'chert --help';
  const footer = `Docs  ${docs}      Help  ${help}`.length + INDENT.length <= view.columns ? [`${INDENT}${p.dim('Docs')}  ${docs}      ${p.dim('Help')}  ${help}`]
    : `Docs  ${docs}`.length + INDENT.length <= view.columns ? [`${INDENT}${p.dim('Docs')}  ${docs}`, `${INDENT}${p.dim('Help')}  ${help}`] : [`${INDENT}${docs}`, `${INDENT}${help}`];
  // On a short window the blank rows and the explanation go first, then the subtitle and the sentence: the choices are what the person acts on.
  // A note is what the person acts on next, so it outlasts the explanation it replaces; only the choices outlast it.
  const build = (tight: boolean, bare: boolean, noted = true) => {
    const gap = tight ? [] : [''];
    const lead = view.note && noted ? wrap(view.note, width) : tight || view.note ? [] : wrap(about, width).map(line => p.dim(line));
    const body = [...(bare ? [] : wrap('Connect this computer to your Chert project.', width)), ...lead, ...(view.note && noted && tight ? [''] : gap), ...options];
    const top = bare ? [INDENT + p.title('CHERT')] : header('FaceTime for your AI agent', view.version, view);
    return [...top, ...gap, ...frame('SIGN IN', body, view, { tight }), ...gap, ...footer];
  };
  const levels = [build(false, false), build(true, false), build(true, true), ...(view.note ? [build(true, true, false)] : [])];
  const body = levels.find(lines => fits(['', ...lines], view.rows)) ?? levels.at(-1)!;
  // A narrow diagonal band of light that crosses the mark, then rests.
  const reach = MARK_WIDTH + mark.length * 2;
  const band = view.frame === undefined ? -99 : (view.frame % SHEEN_FRAMES) * (reach + 12) / (SHEEN_FRAMES / 2) - 6;
  const drawn = view.unicode !== false && view.columns >= MARK_WIDTH + 8 && view.rows >= mark.length + body.length + 4 ? paintMark(mark, view, band, '      ') : [];
  return fit(['', ...drawn, ...(drawn.length ? [''] : []), ...body], view.rows);
}

/** What a signed-in developer sees for a bare `chert`: who and where, then the commands they need. The mark stays on the first screen. */
export function renderHome(view: HomeView): string {
  return renderConnected({ ...view, subtitle: 'FaceTime for your AI agent', commands: homeCommands, footer: 'chert --help lists every command.' });
}
const homeCommands = [
  ['chert dev', 'Put your agent on the line (Ctrl+C releases it)'],
  ['chert doctor', 'Check sign-in, LiveKit keys, the line and your agent'],
  ['chert guide', 'How it works, video agents, sharing a line'],
  ['chert whoami', 'Who is signed in, and to which project'],
  ['chert logout', 'Disconnect this computer'],
] as const;

export type WelcomeKey = 'up' | 'down' | 'select' | 'leave' | '1' | '2' | '3';
/** What one key press on the welcome screen means: the arrows move, enter takes the row under the pointer, a number takes that row. */
export function welcomeKey(key: string): WelcomeKey | undefined {
  if (key === '\x1b[A' || key === '\x1bOA') return 'up';
  if (key === '\x1b[B' || key === '\x1bOB') return 'down';
  if (key === '\r' || key === '\n') return 'select';
  if (key === 'q' || key === 'Q' || key === '\x1b' || key === '\x03' || key === '\x04') return 'leave';
  if (key === '1' || key === '2' || key === '3') return key;
  return undefined;
}

/**
 * Take over the screen and show the welcome. Resolves the choice, or null for Quit, q, escape, Ctrl+C or Ctrl+D, or
 * when `signal` aborts (a SIGINT or SIGTERM from outside, which raw mode does not turn into a key). `start` is for a
 * screen that comes back: a note to show in the frame and the row the pointer starts on.
 */
export async function showWelcome(terminal: Terminal, remote: boolean, version?: string, signal?: AbortSignal, start: { note?: string; selected?: number } = {}): Promise<SignInChoice | null> {
  const { input, output } = terminal;
  let frame = 0, selected = Math.max(0, Math.min(signInOptions.length - 1, start.selected ?? 0));
  // Every line is rewritten in place from the top, so a redraw never flickers and a resized window repairs itself.
  const draw = () => redraw(output, renderWelcome({ ...lookOf(terminal), rows: sizeOf(output).rows, remote, frame, selected, ...(version ? { version } : {}), ...(start.note ? { note: start.note } : {}) }));
  input.setRawMode(true); input.resume(); input.setEncoding('utf8'); output.write('\x1b[?25l' + CLEAR_SCREEN);
  const ticker = terminal.color ? setInterval(() => { frame++; draw(); }, 70) : undefined;
  const resized = () => { output.write(CLEAR_SCREEN); draw(); };
  output.on('resize', resized);
  let onAbort: (() => void) | undefined;
  try {
    draw();
    if (signal?.aborted) return null;
    return await new Promise<SignInChoice | null>(resolve => {
      const onKey = (chunk: string) => {
        for (const key of splitKeys(chunk)) {
          const meaning = welcomeKey(key);
          if (meaning === undefined) continue;
          if (meaning === 'up' || meaning === 'down') {
            const next = Math.max(0, Math.min(signInOptions.length - 1, selected + (meaning === 'up' ? -1 : 1)));
            if (next !== selected) { selected = next; draw(); }
            continue;
          }
          input.off('data', onKey);
          if (meaning === 'leave') { resolve(null); return; }
          selected = meaning === 'select' ? selected : Number(meaning) - 1;
          const chosen = signInOptions[selected]!.id;
          resolve(chosen === 'quit' ? null : chosen);
          return;
        }
      };
      onAbort = () => { input.off('data', onKey); resolve(null); };
      signal?.addEventListener('abort', onAbort, { once: true });
      input.on('data', onKey);
    });
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    clearInterval(ticker); output.off('resize', resized); frame = SHEEN_FRAMES - 1; draw(); output.write('\x1b[?25h'); input.setRawMode(false); input.pause();
  }
}

/**
 * Read one line typed or pasted at the keyboard without showing it. Escape, Ctrl+C, Ctrl+D or an abort of `signal`
 * resolve null; other escape sequences (arrows, Delete, Home, a paste bracket) are ignored rather than taken as escape.
 */
export async function readHidden(terminal: Terminal, prompt: string, signal?: AbortSignal): Promise<string | null> {
  const { input, output } = terminal;
  output.write(prompt);
  input.setRawMode(true); input.resume(); input.setEncoding('utf8');
  let onAbort: (() => void) | undefined;
  try {
    if (signal?.aborted) { output.write('\n'); return null; }
    return await new Promise<string | null>(resolve => {
      let value = '';
      const finish = (result: string | null) => { input.off('data', onData); output.write('\n'); resolve(result); };
      const onData = (chunk: string) => {
        for (const key of splitKeys(chunk)) {
          if (key === '\r' || key === '\n') return finish(value.trim());
          if (key === '\x03' || key === '\x04' || key === '\x1b') return finish(null);
          if (key === '\x7f' || key === '\b') value = value.slice(0, -1);
          else if (key.length === 1 && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(key) && value.length + key.length <= 8192) value += key;
        }
      };
      onAbort = () => finish(null);
      signal?.addEventListener('abort', onAbort, { once: true });
      input.on('data', onData);
    });
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    input.setRawMode(false); input.pause();
  }
}
