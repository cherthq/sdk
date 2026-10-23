/**
 * What every sign-in screen is drawn with: one steel-blue accent, dim text for what matters less, and titled frames
 * whose corners are literal + characters. Nothing here talks to the terminal except `redraw`; the screens build lines.
 */

export interface Look {
  columns: number;
  color: boolean;
  /** True when the terminal takes 24-bit colour; otherwise the 256-colour palette is used. */
  truecolor?: boolean;
  /** False on a terminal that cannot show braille or box drawing (not a UTF-8 locale). */
  unicode?: boolean;
  /** A Chinese, Japanese or Korean locale: such terminals often draw box-drawing and the middle dot two cells wide, so ASCII rules are used. */
  ambiguous?: boolean;
}
export interface Terminal {
  input: NodeJS.ReadStream; output: NodeJS.WriteStream; color: boolean;
  /** True when the terminal takes 24-bit colour; otherwise the 256-colour palette is used. */
  truecolor: boolean;
  /** True when the terminal can show braille and box drawing (a UTF-8 locale). */
  unicode: boolean;
  /** See Look.ambiguous. */
  ambiguous?: boolean;
}
/** The window size, or the classic 80 by 24 when the terminal does not say (a pseudo-terminal can report zero). */
export function sizeOf(output: NodeJS.WriteStream | undefined): { columns: number; rows: number } {
  return { columns: output?.columns && output.columns > 0 ? output.columns : 80, rows: output?.rows && output.rows > 0 ? output.rows : 24 };
}
/** The look of a terminal right now: its width and what it can show. */
export function lookOf(terminal: Terminal): Look {
  return { columns: sizeOf(terminal.output).columns, color: terminal.color, truecolor: terminal.truecolor, unicode: terminal.unicode, ...(terminal.ambiguous ? { ambiguous: true } : {}) };
}

/** Text that will be printed: no control characters, so it cannot move the cursor or retitle the window; bounded. */
export function printable(value: string | null | undefined, limit: number): string | undefined {
  // Also the characters that change reading direction, which can make one name read as another. The zero-width
  // joiners stay: joined emoji and several scripts need them.
  return value?.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, limit) || undefined;
}

/** Steel blue, the one accent on every screen; xterm colour 67 is its nearest 256-colour entry. */
export const ACCENT = { rgb: [95, 135, 175], index: 67 } as const;
/** Dark ink for text on an accent badge. */
const INK = { rgb: [23, 28, 38], index: 234 } as const;

export interface Palette {
  accent(text: string): string; title(text: string): string; dim(text: string): string;
  bold(text: string): string; badge(text: string): string; link(text: string): string;
}
export function palette(look: Look): Palette {
  const code = (open: string) => (text: string) => look.color ? `\x1b[${open}m${text}\x1b[0m` : text;
  const fg = look.truecolor ? `38;2;${ACCENT.rgb.join(';')}` : `38;5;${ACCENT.index}`;
  const bg = look.truecolor ? `48;2;${ACCENT.rgb.join(';')};38;2;${INK.rgb.join(';')}` : `48;5;${ACCENT.index};38;5;${INK.index}`;
  return { accent: code(fg), title: code(`1;${fg}`), dim: code('2'), bold: code('1'), badge: code(`1;${bg}`), link: code(`4;${fg}`) };
}

export interface Glyphs { h: string; v: string; pointer: string; check: string; dot: string; ellipsis: string; spinner: readonly string[] }
/** Box drawing and marks, with ASCII stand-ins for a terminal that is not UTF-8, and ASCII rules where box drawing may be drawn double width. */
export function glyphs(look: Look): Glyphs {
  if (look.unicode === false) return { h: '-', v: '|', pointer: '>', check: '*', dot: '-', ellipsis: '...', spinner: ['-', '\\', '|', '/'] };
  const marks = { pointer: '▸', check: '✓', spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] };
  return look.ambiguous ? { h: '-', v: '|', dot: '-', ellipsis: '...', ...marks } : { h: '─', v: '│', dot: '·', ellipsis: '…', ...marks };
}

/** Cells one code point takes: two for East Asian wide and full-width characters and most emoji, none for controls, combining marks, joiners and variation selectors. */
export function cellWidth(codePoint: number): number {
  if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
  if ((codePoint >= 0x300 && codePoint <= 0x36f) || (codePoint >= 0x200b && codePoint <= 0x200f) || (codePoint >= 0x20d0 && codePoint <= 0x20ff) || (codePoint >= 0xfe00 && codePoint <= 0xfe0f)) return 0;
  if ((codePoint >= 0x1100 && codePoint <= 0x115f) || (codePoint >= 0x2e80 && codePoint <= 0xa4cf) || (codePoint >= 0xac00 && codePoint <= 0xd7a3) || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe4f) || (codePoint >= 0xff00 && codePoint <= 0xff60) || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    || (codePoint >= 0x1f300 && codePoint <= 0x1f64f) || (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) || (codePoint >= 0x20000 && codePoint <= 0x3fffd)) return 2;
  return 1;
}
/** Cells a string takes on screen: colour codes are free, wide characters count twice. */
export function visible(text: string): number {
  let cells = 0;
  for (const character of text.replace(/\x1b\[[0-9;]*m/g, '')) cells += cellWidth(character.codePointAt(0)!);
  return cells;
}
export function padTo(text: string, width: number): string { const gap = width - visible(text); return gap > 0 ? text + ' '.repeat(gap) : text; }

/** Breaks a word without spaces, such as an address or a host name, into pieces no wider than `width` cells. */
export function pieces(text: string, width: number): string[] {
  const limit = Math.max(1, width), out: string[] = []; let piece = '', cells = 0;
  for (const character of text) {
    const w = cellWidth(character.codePointAt(0)!);
    if (piece && cells + w > limit) { out.push(piece); piece = ''; cells = 0; }
    piece += character; cells += w;
  }
  if (piece) out.push(piece);
  return out.length ? out : [''];
}
/** Word wrap to `width` cells; a word wider than the line is broken rather than let through. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = []; let line = '';
  for (const word of text.split(' ').flatMap(word => visible(word) > width ? pieces(word, width) : [word])) {
    if (line && visible(line) + 1 + visible(word) > width) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}
/** A window shorter than the text: give up the blank lines first, then cut, and never scroll. */
export function fit(lines: string[], rows: number): string {
  const room = Math.max(1, rows - 1);
  return (lines.length > room ? lines.filter(line => line !== '') : lines).slice(0, room).join('\n');
}
/** True when `lines` fit the window with the last row left for the cursor. */
export const fits = (lines: string[], rows: number): boolean => lines.length <= Math.max(1, rows - 1);

export const INDENT = '  ';
/** The frame is 74 cells in an 80-column window, as in the design, and shrinks with the window. */
export function frameWidth(columns: number): number { return Math.max(24, Math.min(74, columns - INDENT.length - 2)); }
/** Below this width the sides and corners are left out: the words matter more than the box. */
export const framed = (columns: number): boolean => columns >= 30;
/** The cells a body line may use inside a frame. */
export function innerWidth(look: Look): number { return framed(look.columns) ? frameWidth(look.columns) - 6 : Math.max(8, look.columns - INDENT.length - 2); }

/** A titled box: `+── TITLE ───+` over `│  body  │` rows and `+────+`. Body lines are already wrapped to `innerWidth`. `tight` drops the blank rows inside. */
export function frame(title: string, body: string[], look: Look, options: { tight?: boolean } = {}): string[] {
  const p = palette(look), g = glyphs(look);
  if (!framed(look.columns)) return [...wrap(title, Math.max(4, look.columns - INDENT.length)).map(line => INDENT + p.title(line)), ...body.map(line => INDENT + line)];
  const width = frameWidth(look.columns), inner = width - 6;
  const top = `+${p.accent(g.h.repeat(2))} ${p.title(title)} ${p.accent(g.h.repeat(Math.max(0, width - 6 - title.length)))}+`;
  const bottom = `+${p.accent(g.h.repeat(width - 2))}+`;
  const side = p.accent(g.v);
  const row = (text: string) => `${side}  ${padTo(text, inner)}  ${side}`;
  const pad = options.tight ? [] : [row('')];
  return [top, ...pad, ...body.map(row), ...pad, bottom].map(line => INDENT + line);
}

/** `CHERT  ·  subtitle`, with the version at the frame's right edge when there is room; on a narrow window the subtitle goes under the name. */
export function header(subtitle: string, version: string | undefined, look: Look): string[] {
  const p = palette(look), g = glyphs(look);
  const width = framed(look.columns) ? frameWidth(look.columns) : Math.max(8, look.columns - INDENT.length);
  const left = `CHERT  ${g.dot}  ${subtitle}`;
  if (visible(left) > width) return [INDENT + p.title('CHERT'), ...wrap(subtitle, width).map(line => INDENT + p.dim(line))];
  const line = `${p.title('CHERT')}  ${p.dim(g.dot)}  ${subtitle}`, tag = version ? `v${version}` : '';
  return [INDENT + (tag && visible(left) + 2 + tag.length <= width ? line + ' '.repeat(width - visible(left) - tag.length) + p.dim(tag) : line)];
}

/** Clears the visible screen and puts the cursor at the top left. The scrollback above is kept. */
export const CLEAR_SCREEN = '\x1b[2J\x1b[H';
/** One read from a raw terminal can hold several key presses: split it into escape sequences and single characters. */
export function splitKeys(chunk: string): string[] {
  return chunk.match(/\x1b\[[0-9;]*[A-Za-z~]|\x1bO[A-Za-z]|[\s\S]/gu) ?? [];
}
/**
 * Rewrites the whole screen from the top left so a redraw never flickers. Each line is cleared before it is written,
 * not after: a clear after a line that fills the window would wipe its last cell on terminals that hold the cursor there.
 */
export function redraw(output: NodeJS.WriteStream, text: string): void {
  output.write('\x1b[H' + text.split('\n').map(line => '\x1b[K' + line).join('\n') + '\n\x1b[J');
}
