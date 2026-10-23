import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { renderWaiting, showWaiting, renderConnected, spaced, countdown, expiry } from '../../src/dev/sign-in-screen.js';
import { frame, frameWidth, header, lookOf, sizeOf, visible, wrap, CLEAR_SCREEN, INDENT, type Terminal } from '../../src/dev/frame.js';

// The expiry strings carry a calendar date; pin the zone so the pinned instant reads the same on every machine.
process.env.TZ = 'UTC';
const strip = (text: string) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const look = { columns: 80, rows: 30, color: false, truecolor: false, unicode: true };
const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const info = { code: 'KDTF-2937', url: 'https://control.example/cli', secondsLeft: 581, opened: true, remote: false };
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('frame: 74 cells in an 80-column window, literal + corners, straight sides, and it shrinks with the window', () => {
  assert.equal(frameWidth(80), 74); assert.equal(frameWidth(60), 56); assert.equal(frameWidth(200), 74);
  const box = frame('SIGN IN', ['hello', '', 'world'], look);
  assert.equal(strip(box[0]!), `${INDENT}+── SIGN IN ${'─'.repeat(61)}+`);
  assert.equal(strip(box[2]!), `${INDENT}│  hello${' '.repeat(63)}  │`);
  assert.equal(strip(box.at(-1)!), `${INDENT}+${'─'.repeat(72)}+`);
  assert.equal(box.length, 7, 'top, a blank, three body lines, a blank, bottom');
  for (const line of box) assert.equal(visible(line), INDENT.length + 74, line);
  const coloured = frame('SIGN IN', ['hello'], { ...look, color: true });
  for (const line of coloured) assert.equal(visible(line), INDENT.length + 74, 'colour codes do not count');
  assert.match(coloured[0]!, /38;5;67m/, 'the frame is drawn in the accent');
  const narrow = frame('SIGN IN', ['hello'], { ...look, columns: 24 });
  assert.ok(narrow.every(line => !line.includes('│') && line.length <= 24), narrow.join('|')); assert.match(narrow.join('\n'), /SIGN IN/); assert.match(narrow.join('\n'), /hello/);
  const ascii = frame('X', ['a'], { ...look, unicode: false });
  assert.ok(ascii.every(line => !/[─│]/.test(line))); assert.match(ascii[0]!, /^\s*\+-- X -+\+$/);
  assert.equal(frame('X', ['a'], look, { tight: true }).length, 3, 'tight drops the blank rows');
  const cjk = frame('X', ['a'], { ...look, ambiguous: true });
  assert.ok(cjk.every(line => !/[─│]/.test(line)), 'a CJK locale gets ASCII rules'); assert.match(cjk[0]!, /^\s*\+-- X -+\+$/);
});

test('width: wide characters take two cells, combining marks none, and a word too long for the line is broken', () => {
  assert.equal(visible('東京'), 4); assert.equal(visible('é'), 1); assert.equal(visible('\x1b[1mab\x1b[0m'), 2); assert.equal(visible('✓ ▸ ⠋'), 5);
  for (const line of frame('CONNECTED', ['Project   東京クリニック'], look)) assert.equal(visible(line), INDENT.length + 74, line);
  assert.deepEqual(wrap('Anishs-MacBook-Pro', 8), ['Anishs-M', 'acBook-P', 'ro']);
  assert.deepEqual(wrap('a 東京クリニック b', 6), ['a', '東京ク', 'リニッ', 'ク b'], 'a wide word is cut into pieces that fit the line');
});

test('size: a terminal that reports no size, or zero (a pseudo-terminal), is treated as 80 by 24', () => {
  assert.deepEqual(sizeOf(undefined), { columns: 80, rows: 24 });
  assert.deepEqual(sizeOf({ columns: 0, rows: 0 } as NodeJS.WriteStream), { columns: 80, rows: 24 });
  assert.deepEqual(sizeOf({ columns: 132, rows: 50 } as NodeJS.WriteStream), { columns: 132, rows: 50 });
  assert.equal(lookOf({ output: { columns: 0 }, color: true, truecolor: false, unicode: true } as unknown as Terminal).columns, 80);
  assert.equal(lookOf({ color: false, truecolor: false, unicode: true } as Terminal).columns, 80, 'tests hand in a terminal without streams');
});

test('header: CHERT, a dot, the subtitle, and the version at the right edge of the frame when there is room', () => {
  const [line] = header('Sign in', '0.1.0-beta.1', look);
  assert.equal(visible(line!), INDENT.length + 74); assert.match(strip(line!), /^  CHERT  ·  Sign in\s+v0\.1\.0-beta\.1$/);
  const plain = header('Sign in', undefined, look);
  assert.equal(plain.length, 1); assert.equal(strip(plain[0]!), '  CHERT  ·  Sign in');
  const narrow = header('FaceTime for your voice agent', '0.1.0', { ...look, columns: 24 });
  assert.ok(narrow.length >= 2, 'the subtitle moves under the name'); assert.ok(narrow.every(line => line.length <= 24)); assert.doesNotMatch(narrow.join('\n'), /v0\.1/);
});

test('waiting: the spaced code, the address, the countdown and the two keys', () => {
  assert.equal(spaced('KDTF-2937'), 'K D T F  -  2 9 3 7');
  assert.equal(countdown(581), '09:41'); assert.equal(countdown(0), '00:00'); assert.equal(countdown(-5), '00:00'); assert.equal(countdown(3600), '60:00');
  const text = renderWaiting({ ...look, ...info });
  assert.match(text, /CHERT\s+·\s+Sign in/); assert.match(text, /Opening your browser…/);
  assert.match(text, /\+── WAITING FOR APPROVAL ─+\+/); assert.match(text, /Confirm this code matches the one in your browser/);
  assert.match(text, /K D T F  -  2 9 3 7/); assert.match(text, /Didn't open\?  https:\/\/control\.example\/cli/); assert.match(text, /Expires in 09:41/);
  assert.match(text, /\n  esc  Cancel {8}c  Copy URL/, 'the keys line up with everything else'); assert.match(text, /in your browser/);
  const remote = renderWaiting({ ...look, ...info, opened: false, remote: true });
  assert.match(remote, /Open the address below on any device/); assert.match(remote, /Address  https:\/\/control\.example\/cli/); assert.doesNotMatch(remote, /Copy URL|Didn't open|in your browser/);
  assert.match(remote, /on the approval page/);
  assert.match(renderWaiting({ ...look, ...info, opened: false }), /Waiting for approval…/);
  for (const [columns, rows] of [[30, 12], [80, 10], [80, 8]] as const) {
    const short = renderWaiting({ ...look, ...info, columns, rows });
    assert.match(short, /Expires in 09:41/, `${columns}x${rows} keeps the countdown`); assert.match(short, /esc/, `${columns}x${rows} keeps the keys`); assert.match(short, /KDTF-2937|K D T F/);
  }
  assert.match(renderWaiting({ ...look, ...info, note: 'Copied the address.' }), /Copied the address\./);
  const spin = [0, 1, 2].map(f => renderWaiting({ ...look, ...info, frame: f }));
  assert.notEqual(spin[0], spin[1]); assert.equal(strip(spin[0]!).length, strip(spin[1]!).length, 'the spinner changes one cell and nothing else moves');
  for (const columns of [20, 30, 50, 80, 160]) for (const rows of [4, 10, 30]) {
    const t = renderWaiting({ ...look, ...info, columns, rows });
    assert.ok(t.split('\n').length <= Math.max(1, rows - 1), `${columns}x${rows}`);
    for (const line of t.split('\n')) assert.ok(line.length <= columns, `${columns}x${rows}: ${JSON.stringify(line)}`);
  }
  assert.match(renderWaiting({ ...look, ...info, columns: 30, rows: 40 }), /KDTF-2937|K D T F/, 'the code is always there');
  assert.doesNotMatch(renderWaiting({ ...look, ...info, unicode: false }), /[─│…⠁-⣿]/);
});

function fakeTerminal(color: boolean, size = { columns: 80, rows: 30 }) {
  const raw: boolean[] = []; let written = '';
  const input = Object.assign(new PassThrough(), { setRawMode(mode: boolean) { raw.push(mode); return input; } });
  const output = Object.assign(new PassThrough(), size);
  output.on('data', chunk => { written += String(chunk); });
  return { terminal: { input, output, color, truecolor: color, unicode: true } as unknown as Terminal, input, raw, written: () => written };
}
const waiting = { code: 'KDTF-2937', url: 'https://control.example/cli', urlComplete: 'https://control.example/cli?code=KDTF-2937', expiresIn: 600, opened: true, remote: false };

test('waiting screen: it draws at once, counts down, copies on c, cancels on escape or Ctrl+C, and stop puts the terminal back', async () => {
  const t = fakeTerminal(true); const copied: string[] = []; let cancelled = 0; let clock = NOW;
  const screen = showWaiting(t.terminal, waiting, () => { cancelled++; }, { copy: async text => { copied.push(text); return true; }, now: () => clock });
  const first = t.written();
  assert.ok(first.indexOf(CLEAR_SCREEN) >= 0 && first.indexOf(CLEAR_SCREEN) < first.indexOf('WAITING'), 'cleared before anything is drawn');
  assert.ok(first.includes('\x1b[H\x1b[K'), 'each line is cleared before it is written, never after');
  assert.match(strip(first), /Expires in 10:00/); assert.deepEqual(t.raw, [true]);
  clock += 19_000; await pause(250);
  assert.match(strip(t.written()), /Expires in 09:41/, 'the clock is read on every tick');
  t.input.write('c'); await pause(30);
  assert.deepEqual(copied, [waiting.urlComplete], 'the address with the code is what goes on the clipboard'); assert.match(strip(t.written()), /Copied/);
  t.input.write('\x1b'); await pause(10); assert.equal(cancelled, 1);
  t.input.write('\x03'); await pause(10); assert.equal(cancelled, 2);
  screen.stop();
  const length = t.written().length;
  assert.deepEqual(t.raw, [true, false]); assert.ok(t.written().endsWith(CLEAR_SCREEN + '\x1b[?25h'), 'the screen is cleared and the cursor shown');
  await pause(250); assert.equal(t.written().length, length, 'nothing is drawn after stop');
  screen.stop(); assert.deepEqual(t.raw, [true, false], 'a second stop does nothing');
});

test('waiting screen: over a remote shell c does nothing; a copy that fails says so', async () => {
  const remote = fakeTerminal(false); const copied: string[] = [];
  const r = showWaiting(remote.terminal, { ...waiting, opened: false, remote: true }, () => {}, { copy: async text => { copied.push(text); return true; }, now: () => NOW });
  remote.input.write('c'); await pause(20);
  assert.deepEqual(copied, []); assert.doesNotMatch(strip(remote.written()), /Copied/); r.stop();
  const failing = fakeTerminal(false);
  const f = showWaiting(failing.terminal, waiting, () => {}, { copy: async () => false, now: () => NOW });
  failing.input.write('c'); await pause(20);
  assert.match(strip(failing.written()), /Could not copy/); f.stop();
});

test('connected: who, the CONNECTED box with project, device and expiry, then the next commands', () => {
  const commands = [['chert dev --agent NAME', 'Put your agent on the line'], ['chert logout', 'Disconnect this computer']] as const;
  const text = renderConnected({ ...look, subtitle: 'Sign in', email: 'dev@example.test', project: 'Clinic', device: 'Test MacBook', expiresAt: NOW + 30 * 86_400_000, now: NOW, commands });
  assert.match(text, /CHERT\s+·\s+Sign in/); assert.match(text, /✓ Signed in as dev@example\.test/);
  assert.match(text, /\+── CONNECTED ─+\+/);
  assert.match(text, /│  Project   Clinic\s+│/); assert.match(text, /│  Device    Test MacBook\s+│/); assert.match(text, /│  Expires   Nov 6, 2026 \(30 days\)\s+│/);
  assert.match(text, /Next\n\s+chert dev --agent NAME\s+Put your agent on the line\n\s+chert logout\s+Disconnect this computer/);
  assert.equal(text, strip(text));
  const rich = renderConnected({ ...look, color: true, subtitle: 'Sign in', email: 'dev@example.test', project: 'Clinic', commands });
  assert.match(rich, /38;5;67m/); assert.equal(strip(rich).replace(/\s+$/gm, ''), renderConnected({ ...look, subtitle: 'Sign in', email: 'dev@example.test', project: 'Clinic', commands }).replace(/\s+$/gm, ''), 'colour never changes the layout');
  const bare = renderConnected({ ...look, subtitle: 'Sign in', commands: [] });
  assert.match(bare, /✓ Signed in\n/); assert.doesNotMatch(bare, /CONNECTED|Next/);
  assert.match(renderConnected({ ...look, subtitle: 'Sign in', commands: [], footer: 'chert --help lists every command.' }), /chert --help lists every command\./);
  assert.match(renderConnected({ ...look, subtitle: 'Sign in', commands: [], note: 'A dashboard session token.' }), /\n  A dashboard session token\.\n/);
  const warned = renderConnected({ ...look, color: true, subtitle: 'Sign in', project: 'Clinic', commands, note: 'A dashboard session token.', warning: 'The earlier credential could not be revoked.' });
  assert.match(warned, /\n  The earlier credential could not be revoked\.\n/, 'a warning is not dimmed'); assert.match(warned, /\n  \x1b\[2mA dashboard session token\.\x1b\[0m\n/);
  assert.ok(strip(warned).indexOf('CONNECTED') < strip(warned).indexOf('The earlier credential') && strip(warned).indexOf('The earlier credential') < strip(warned).indexOf('Next'), 'between the box and the next steps');
  const doctor = [['chert doctor', 'Check sign-in, LiveKit keys, the line and your agent']] as const;
  for (const columns of [24, 30, 40, 79, 80, 120]) for (const line of renderConnected({ ...look, columns, subtitle: 'Sign in', email: 'dev@example.test', project: 'Clinic', device: 'Anishs-MacBook-Pro', expiresAt: NOW + 30 * 86_400_000, now: NOW,
    commands: doctor }).split('\n')) assert.ok(line.length <= columns, `${columns}: ${JSON.stringify(line)}`);
  assert.match(renderConnected({ ...look, columns: 80, subtitle: 'Sign in', commands: doctor }), /\n    chert doctor +Check sign-in, LiveKit keys, the line and your agent\n/, 'one line at exactly 80 columns');
  for (const [columns, project, device] of [[80, '東京クリニック', 'Test MacBook'], [30, 'Clinic', 'Anishs-MacBook-Pro'], [44, 'fableroom-production-voice-agents', 'x']] as const) {
    const sides = renderConnected({ ...look, columns, subtitle: 'Sign in', project, device, commands: [] }).split('\n').filter(line => line.includes('│'));
    assert.ok(sides.length >= 3); for (const line of sides) assert.equal(visible(line), visible(sides[0]!), `${columns}: a straight right edge: ${line}`);
  }
  const hostile = renderConnected({ ...look, subtitle: 'Sign in', email: 'dev@example.test\x1b]0;owned\x07', project: 'Clinic\x1b[2J', commands: [] });
  assert.doesNotMatch(hostile, /\x1b\]|\x07|\x1b\[2J/, 'control characters from a token or a server never reach the screen');
});

test('expiry: days when far off, hours when close, minutes for a session token', () => {
  assert.equal(expiry(NOW + 30 * 86_400_000, NOW), 'Nov 6, 2026 (30 days)');
  assert.match(expiry(NOW + 2 * 86_400_000, NOW), /\(2 days\)$/);
  assert.match(expiry(NOW + 5 * 3_600_000, NOW), /\(about 5 hours\)$/);
  assert.match(expiry(NOW + 3_600_000, NOW), /\(about 1 hour\)$/); assert.match(expiry(NOW + 50 * 60_000, NOW), /\(about 1 hour\)$/);
  assert.match(expiry(NOW + 20 * 60_000, NOW), /\(about 20 minutes\)$/);
  assert.match(expiry(NOW + 90_000, NOW), /\(about 2 minutes\)$/);
});
