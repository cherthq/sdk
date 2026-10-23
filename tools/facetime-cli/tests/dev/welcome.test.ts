import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { renderWelcome, renderHome, welcomeKey, splitKeys, showWelcome, readHidden, signInOptions, CLEAR_SCREEN, MARK_WIDTH, type Terminal } from '../../src/dev/welcome.js';
import { brailleMark, logoLines, logoWidth } from '../../src/cli/logo.js';

// The home screen's expiry carries a calendar date; pin the zone so the pinned instant reads the same on every machine.
process.env.TZ = 'UTC';
const strip = (text: string) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const braille = /[⠁-⣿]/;
const view = { columns: 120, rows: 40, color: false, truecolor: false, unicode: true, remote: false };
const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);

test('logo: the source drawing is trimmed and the braille mark is small, the asked width and shaded', () => {
  assert.ok(logoLines.length > 30 && logoWidth <= 96);
  for (const line of logoLines) assert.equal(line, line.trimEnd());
  const mark = brailleMark(MARK_WIDTH);
  assert.ok(mark.length >= 12 && mark.length <= 18, `rows ${mark.length}`);
  for (const row of mark) { assert.equal(row.length, MARK_WIDTH); for (const cell of row) assert.ok(cell.char === ' ' || braille.test(cell.char)); }
  assert.ok(mark.every(row => row.some(cell => cell.char !== ' ')), 'no empty rows');
});

test('welcome: the mark, the CHERT header, a SIGN IN frame with three numbered choices, and where to read more', () => {
  const text = renderWelcome({ ...view, version: '0.1.0-beta.1' });
  assert.match(text, braille);
  assert.match(text, /CHERT\s+·\s+FaceTime for your AI agent\s+v0\.1\.0-beta\.1/);
  assert.match(text, /\+── SIGN IN ─+\+/, 'a titled frame with literal + corners');
  assert.match(text, /Connect this computer to your Chert project\./); assert.match(text, /Your browser opens to approve it/); assert.match(text, /30 days/);
  assert.match(text, /▸  1   Sign in with browser/, 'the pointer rests on the first choice');
  assert.match(text, /\n[^\n▸]*   2   Paste a token instead/); assert.match(text, /\n[^\n▸]*   3   Quit/);
  assert.match(text, /Docs  docs\.trychert\.com\s+Help  chert --help/);
  assert.doesNotMatch(text, /press enter|enter to/i, 'the keys are the numbers and the arrows, not a sentence');
  const lines = text.split('\n');
  const top = lines.find(line => line.includes('SIGN IN'))!, bottoms = lines.filter(line => /^\s*\+─+\+\s*$/.test(line));
  assert.ok(top.trim().startsWith('+') && top.trim().endsWith('+'), top); assert.equal(bottoms.length, 1);
  for (const line of lines.filter(line => /^\s*│/.test(line))) assert.equal(line.trimEnd().length, top.trimEnd().length, `a straight right edge: ${line}`);
  assert.deepEqual(signInOptions.map(option => option.id), ['browser', 'token', 'quit']);
});

test('welcome: the pointer follows the selection; a remote shell is told about the code instead of a browser', () => {
  assert.match(renderWelcome({ ...view, selected: 1 }), /▸  2   Paste a token instead/);
  assert.match(renderWelcome({ ...view, selected: 2 }), /▸  3   Quit/);
  assert.doesNotMatch(renderWelcome({ ...view, selected: 2 }), /▸  1 /);
  const remote = renderWelcome({ ...view, remote: true });
  assert.match(remote, /any device/i); assert.doesNotMatch(remote, /Your browser opens/); assert.match(remote, /▸  1   Sign in with a code/);
});

test('welcome: it never draws more lines or columns than the window has, drops the mark first and the frame on a narrow window', () => {
  for (const rows of [3, 6, 8, 10, 14, 20, 27, 28, 29, 60]) for (const columns of [20, 29, 30, 35, 36, 60, 200]) for (const remote of [false, true]) {
    const text = renderWelcome({ ...view, columns, rows, remote, version: '0.1.0-beta.1' });
    assert.ok(text.split('\n').length <= Math.max(1, rows - 1), `${columns}x${rows}: ${text.split('\n').length} lines`);
    for (const line of text.split('\n')) assert.ok(line.length <= columns, `${columns}x${rows}: ${JSON.stringify(line)}`);
  }
  const short = renderWelcome({ ...view, rows: 12 });
  assert.doesNotMatch(short, braille); assert.match(short, /SIGN IN/); assert.match(short, /Sign in with browser/);
  assert.match(short, /3   Quit/, 'on a short window the explanation goes before the choices'); assert.doesNotMatch(short, /30 days/);
  const tiny = renderWelcome({ ...view, columns: 30, rows: 12 });
  assert.match(tiny, /1 +Sign in with/); assert.match(tiny, /3 +Quit/, 'even at 30 by 12 all three choices are on screen');
  assert.match(renderWelcome({ ...view, rows: 10 }), /3   Quit/);
  const narrow = renderWelcome({ ...view, columns: 24 });
  assert.doesNotMatch(narrow, /[│]/, 'no box sides when they would not fit'); assert.match(narrow, /SIGN IN/); assert.match(narrow, /1 /);
  assert.doesNotMatch(renderWelcome({ ...view, unicode: false }), /[⠁-⣿─│▸]/, 'a terminal that is not UTF-8 gets no braille or box drawing');
  assert.match(renderWelcome({ ...view, unicode: false }), /\+-- SIGN IN -+\+/); assert.match(renderWelcome({ ...view, unicode: false }), />  1   Sign in with browser/);
});

test('welcome: a note is shown inside the SIGN IN frame in place of the explanation, and stays on a short window', () => {
  const note = 'This Chert server does not offer browser sign-in yet. Press 2 to paste a token.';
  const text = renderWelcome({ ...view, note, selected: 1 }), lines = text.split('\n');
  const top = lines.findIndex(line => line.includes('SIGN IN')), at = lines.findIndex(line => line.includes('does not offer browser sign-in yet')), first = lines.findIndex(line => /1   Sign in with browser/.test(line));
  assert.ok(top >= 0 && at > top && at < first, 'inside the frame, above the choices');
  assert.match(lines[at]!, /^\s*│  This Chert server does not offer browser sign-in yet\. Press 2 to\s+│$/); assert.match(lines[at + 1]!, /^\s*│  paste a token\.\s+│$/, 'one sentence, wrapped to the frame');
  assert.doesNotMatch(text, /Your browser opens to approve it/, 'the sentence it contradicts is gone'); assert.match(text, /▸  2   Paste a token instead/);
  const short = renderWelcome({ ...view, note, rows: 14 });
  assert.match(short.replace(/[│\s]+/g, ' '), /Press 2 to paste a token\./); assert.match(short, /3   Quit/);
  for (const rows of [3, 6, 8, 10, 14, 20, 60]) for (const columns of [20, 30, 36, 80, 200]) {
    const drawn = renderWelcome({ ...view, columns, rows, note });
    assert.ok(drawn.split('\n').length <= Math.max(1, rows - 1), `${columns}x${rows}`);
    for (const line of drawn.split('\n')) assert.ok(line.length <= columns, `${columns}x${rows}: ${JSON.stringify(line)}`);
  }
  assert.match(renderWelcome({ ...view, note, rows: 10 }), /3   Quit/, 'when there is no room for both, the choices win');
});

test('welcome: shown again with a note, it draws the note and starts with the pointer on the row it is given', async () => {
  const t = fakeTerminal(false);
  const going = showWelcome(t.terminal, false, undefined, undefined, { note: 'Press 2 to paste a token.', selected: 1 });
  t.input.write('\r');
  assert.equal(await going, 'token', 'enter takes the row the pointer starts on');
  assert.match(strip(t.written()), /Press 2 to paste a token\./); assert.match(strip(t.written()), /▸  2   Paste a token instead/);
});

test('welcome: the mark keeps the Chert orange to navy; everything else uses one steel-blue accent; no colour means no escape codes', () => {
  const plain = renderWelcome({ ...view, frame: 5 });
  assert.equal(plain, strip(plain));
  const rich = renderWelcome({ ...view, color: true, truecolor: true });
  // Only the mark's own lines: the badge and the accent below it have colours of their own.
  const markText = rich.split('\n').filter(line => braille.test(line)).join('\n');
  const colours = [...markText.matchAll(/38;2;(\d+);(\d+);(\d+)m/g)].map(m => m.slice(1, 4).map(Number));
  const first = colours[0]!, last = colours.at(-1)!;
  assert.ok(first[0]! > 200 && first[2]! < 110, `starts orange: ${first}`); assert.ok(last[2]! > last[0]!, `ends navy: ${last}`);
  assert.match(rich, /38;2;95;135;175m/, 'the steel-blue accent in 24-bit colour');
  const limited = renderWelcome({ ...view, color: true, truecolor: false });
  assert.doesNotMatch(limited, /38;2;/); assert.match(limited, /38;5;\d+m/); assert.match(limited, /38;5;67m/, 'the steel-blue accent from the 256-colour palette');
  assert.match(rich, /48;2;95;135;175/, 'the chosen number sits on an accent badge');
  const frames = [0, 6, 12, 40, 41].map(frame => renderWelcome({ ...view, color: true, truecolor: true, frame }));
  assert.notEqual(frames[1], frames[2]); assert.equal(frames[3], frames[4], 'between passes the picture is still');
  for (const frame of frames) assert.equal(strip(frame), plain, 'animation never changes the layout');
});

test('welcome keys: arrows move, enter selects, 1 2 3 pick a row, q, escape, Ctrl+C and Ctrl+D leave, everything else is ignored', () => {
  for (const key of ['\x1b[A', '\x1bOA']) assert.equal(welcomeKey(key), 'up');
  for (const key of ['\x1b[B', '\x1bOB']) assert.equal(welcomeKey(key), 'down');
  for (const key of ['\r', '\n']) assert.equal(welcomeKey(key), 'select');
  for (const key of ['q', 'Q', '\x1b', '\x03', '\x04']) assert.equal(welcomeKey(key), 'leave');
  assert.equal(welcomeKey('1'), '1'); assert.equal(welcomeKey('2'), '2'); assert.equal(welcomeKey('3'), '3');
  for (const key of ['x', ' ', '0', '4', 't', '\t', '\x1b[C', '\x1b[D', '\x1b[5~']) assert.equal(welcomeKey(key), undefined, JSON.stringify(key));
  assert.deepEqual(splitKeys('x\r'), ['x', '\r']); assert.deepEqual(splitKeys('\x1b[B\x1b[B\r'), ['\x1b[B', '\x1b[B', '\r']);
  assert.deepEqual(splitKeys('\x1bOA'), ['\x1bOA']); assert.deepEqual(splitKeys('\x1b'), ['\x1b']);
});

function fakeTerminal(color: boolean, size = { columns: 120, rows: 40 }) {
  const raw: boolean[] = []; let written = '';
  const input = Object.assign(new PassThrough(), { setRawMode(mode: boolean) { raw.push(mode); return input; } });
  const output = Object.assign(new PassThrough(), size);
  output.on('data', chunk => { written += String(chunk); });
  return { terminal: { input, output, color, truecolor: color, unicode: true } as unknown as Terminal, input, raw, written: () => written };
}

test('welcome: enter on the first row signs in with the browser; the screen is cleared first and the terminal is put back', async () => {
  const t = fakeTerminal(false);
  const going = showWelcome(t.terminal, false);
  t.input.write('x'); t.input.write('\r\x03');
  assert.equal(await going, 'browser', 'a stray key is ignored; the Ctrl+C after enter is too late to matter');
  const text = t.written();
  assert.ok(text.indexOf(CLEAR_SCREEN) >= 0 && text.indexOf(CLEAR_SCREEN) < text.indexOf('SIGN IN'), 'cleared before anything is drawn');
  assert.deepEqual(t.raw, [true, false]); assert.ok(text.endsWith('\x1b[?25h'), 'the cursor is shown again');
});

test('welcome: the arrows move the pointer and enter takes the row under it; a digit jumps straight to that row', async () => {
  const down = fakeTerminal(false); const second = showWelcome(down.terminal, false);
  down.input.write('\x1b[B'); down.input.write('\r');
  assert.equal(await second, 'token'); assert.match(strip(down.written()), /▸  2   Paste a token instead/, 'redrawn with the pointer on the second row');
  const bottom = fakeTerminal(false); const last = showWelcome(bottom.terminal, false);
  bottom.input.write('\x1b[B\x1b[B\x1b[B\x1b[B\r');
  assert.equal(await last, null, 'the pointer stops on the last row, Quit');
  const up = fakeTerminal(false); const first = showWelcome(up.terminal, false);
  up.input.write('\x1b[B\x1bOA\x1b[A\r');
  assert.equal(await first, 'browser', 'and on the first');
  const two = fakeTerminal(false); const picked = showWelcome(two.terminal, false); two.input.write('2'); assert.equal(await picked, 'token');
  const three = fakeTerminal(false); const quit = showWelcome(three.terminal, false); three.input.write('3'); assert.equal(await quit, null);
  const one = fakeTerminal(false); const browser = showWelcome(one.terminal, false); one.input.write('\x1b[B1'); assert.equal(await browser, 'browser');
});

test('welcome: with colour the mark animates until a key is pressed, then stops; q leaves', async () => {
  const t = fakeTerminal(true);
  const going = showWelcome(t.terminal, false);
  await new Promise(resolve => setTimeout(resolve, 260));
  t.input.write('q');
  assert.equal(await going, null); assert.deepEqual(t.raw, [true, false]);
  const length = t.written().length;
  assert.ok(t.written().split('SIGN IN').length > 3, 'redrawn several times');
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(t.written().length, length, 'nothing is drawn after leaving');
});

test('hidden prompt: what is typed or pasted is never echoed, backspace edits, enter returns it, escape gives null', async () => {
  const t = fakeTerminal(false);
  const reading = readHidden(t.terminal, 'Paste: ');
  t.input.write('abc\x7f'); t.input.write('d\r');
  assert.equal(await reading, 'abd');
  assert.equal(strip(t.written()), 'Paste: \n', 'only the prompt and a line break are shown'); assert.deepEqual(t.raw, [true, false]);
  const e = fakeTerminal(false); const escaped = readHidden(e.terminal, '');
  e.input.write('secret\x1b');
  assert.equal(await escaped, null); assert.ok(!e.written().includes('secret'));
  const c = fakeTerminal(false); const interrupted = readHidden(c.terminal, ''); c.input.write('\x03'); assert.equal(await interrupted, null);
});

test('hidden prompt: arrows, Delete, Home and paste brackets are ignored and control characters dropped; only escape alone cancels', async () => {
  const t = fakeTerminal(false); const reading = readHidden(t.terminal, '');
  t.input.write('eyJhb\x1b[D'); t.input.write('\x1b[3~\x1bOH\x1b[200~rest\x1b[201~\x85\x9b\r');
  assert.equal(await reading, 'eyJhbrest');
  const long = fakeTerminal(false); const bounded = readHidden(long.terminal, ''); long.input.write('x'.repeat(9000) + '\r');
  assert.equal((await bounded)!.length, 8192, 'bounded in the units the credential store counts');
});

test('screens: an abort from outside (a signal while in raw mode) takes the welcome and the prompt down and resolves null', async () => {
  const w = fakeTerminal(false); const first = new AbortController(); const welcome = showWelcome(w.terminal, false, undefined, first.signal);
  await new Promise(resolve => setTimeout(resolve, 10)); first.abort();
  assert.equal(await welcome, null); assert.deepEqual(w.raw, [true, false]); assert.ok(w.written().endsWith('\x1b[?25h'), 'the cursor comes back');
  const h = fakeTerminal(false); const second = new AbortController(); const hidden = readHidden(h.terminal, 'P: ', second.signal);
  h.input.write('abc'); await new Promise(resolve => setTimeout(resolve, 10)); second.abort();
  assert.equal(await hidden, null); assert.deepEqual(h.raw, [true, false]);
  const already = new AbortController(); already.abort();
  assert.equal(await showWelcome(fakeTerminal(false).terminal, false, undefined, already.signal), null);
  assert.equal(await readHidden(fakeTerminal(false).terminal, '', already.signal), null);
});

test('home: a signed-in developer sees who, a CONNECTED box and the four commands they need; the mark stays on the first screen', () => {
  const full = { ...view, email: 'dev@example.test', project: 'Clinic', device: 'Test MacBook', expiresAt: NOW + 30 * 86_400_000, now: NOW, version: '0.1.0-beta.1' };
  const text = renderHome(full);
  assert.doesNotMatch(text, braille);
  assert.match(text, /CHERT\s+·\s+FaceTime for your AI agent\s+v0\.1\.0-beta\.1/); assert.match(text, /✓ Signed in as dev@example\.test/);
  assert.match(text, /\+── CONNECTED ─+\+/); assert.match(text, /Project\s+Clinic/); assert.match(text, /Device\s+Test MacBook/); assert.match(text, /Expires\s+Nov 6, 2026 \(30 days\)/);
  for (const command of ['chert dev', 'chert doctor', 'chert guide', 'chert whoami', 'chert logout']) assert.ok(text.includes(command), command);
  assert.match(text, /Next/); assert.match(text, /chert --help/); assert.doesNotMatch(text, /enroll|activate|drain|create-room/, 'operator commands stay in --help');
  assert.equal(text, strip(text)); assert.notEqual(renderHome({ ...full, color: true }), strip(renderHome({ ...full, color: true })));
  const bare = renderHome({ ...view });
  assert.match(bare, /Signed in/); assert.doesNotMatch(bare, /CONNECTED/, 'no box when nothing more is known');
  for (const columns of [30, 44, 60, 80, 200]) for (const line of renderHome({ ...full, columns }).split('\n')) assert.ok(line.length <= columns, `${columns}: ${JSON.stringify(line)}`);
  assert.match(renderHome({ ...full, columns: 80 }), /\n    chert doctor +Check sign-in, LiveKit keys, the line and your agent\n/, 'at 80 columns every row still sits on one line');
});
