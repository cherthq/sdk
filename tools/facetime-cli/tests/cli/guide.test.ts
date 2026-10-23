import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { guide, topics } from '../../src/cli/guide.js';

const executable = fileURLToPath(new URL('../../src/cli/main.js', import.meta.url));
const chert = (args: string[]) => spawnSync(process.execPath, [executable, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, CHERT_HOME: '/nonexistent/chert-guide-test' } });

test('guide: every page fits 80 columns, and lists the other topics under MORE', () => {
  for (const topic of topics) {
    const page = guide(topic.name)!;
    assert.match(page, new RegExp(`^chert guide${topic.name === 'start' ? '' : ` ${topic.name}`}: ${topic.title}$`, 'm'));
    for (const line of page.split('\n')) assert.ok(line.length <= 80, `${topic.name}: ${line}`);
    for (const other of topics.filter(entry => entry !== topic)) assert.match(page, new RegExp(`^  chert guide${other.name === 'start' ? '' : ` ${other.name}`} +${other.summary}$`, 'm'));
  }
  assert.equal(guide(), guide('start'));
  assert.equal(guide('nope'), undefined);
});

test('guide: the command prints the page, gives a record with --json, and names the topics when one is wrong', () => {
  const page = chert(['guide']);
  assert.equal(page.status, 0, page.stderr); assert.equal(page.stdout, guide() + '\n');
  assert.equal(chert(['guide', 'video']).stdout, guide('video') + '\n');
  const record = JSON.parse(chert(['guide', 'line', '--json']).stdout) as { code: string; topic: string; message: string };
  assert.equal(record.code, 'guide'); assert.equal(record.topic, 'line'); assert.equal(record.message, guide('line'));
  for (const args of [['guide', 'nope'], ['guide', 'video', 'line']]) {
    const refused = chert(args);
    assert.equal(refused.status, 2); assert.equal(refused.stderr, 'Choose one topic: chert guide, or chert guide agent, video, line, fix. (invalid_usage)\n');
  }
});

test('guide: the video page states the rule the Mac applies and what the caller sees without agent video', () => {
  const page = guide('video')!.replace(/\s+/g, ' ');
  assert.match(page, /Call the line with FaceTime Video/);
  assert.match(page, /Publish a camera track from the participant that speaks/);
  assert.match(page, /video only from that same participant/);
  assert.match(page, /the caller sees the line's default picture/);
});

test('guide: every error code the fix page names is one the CLI really reports', () => {
  const source = (dir: string): string => readdirSync(dir, { withFileTypes: true })
    .map(entry => entry.isDirectory() ? source(join(dir, entry.name)) : entry.name.endsWith('.js') ? readFileSync(join(dir, entry.name), 'utf8') : '').join('\n');
  const all = source(fileURLToPath(new URL('../../src/', import.meta.url)));
  const fix = topics.find(topic => topic.name === 'fix')!;
  const codes = fix.blocks.flatMap(block => 'rows' in block ? block.rows.map(([left]) => left) : []).filter(left => /^[a-z]+(_[a-z]+)+$/.test(left));
  assert.ok(codes.length >= 3);
  for (const code of codes) assert.ok(all.includes(`'${code}'`), code);
});

test('guide: the fix page names a line with a call in progress, and says to wait for the call to end', () => {
  const row = topics.find(topic => topic.name === 'fix')!.blocks.flatMap(block => 'rows' in block ? block.rows : []).find(([code]) => code === 'line_in_call');
  assert.ok(row, 'line_in_call is listed');
  assert.match(row[1], /wait for the call to end/i);
});

const steps = (name: string) => topics.find(topic => topic.name === name)!.blocks.flatMap(block => 'steps' in block ? block.steps : 'text' in block ? [block.text] : []).join(' ');

test('guide line: a session that is gone is replaced without --takeover, which is only for a live holder who agrees, between calls', () => {
  const text = steps('line');
  assert.match(text, /is no longer connected \(a closed laptop, a crash, a stop whose release failed\) is replaced without --takeover/);
  assert.match(text, /Use --takeover only for a live holder who agrees, and only with no call in progress\./);
  assert.doesNotMatch(text, /when their session died/, 'a dead session never needed --takeover');
  assert.match(text, /chert dev --until HH:MM/); assert.match(text, /--minutes N/);
});

/** The guides a team reads before its slot, as one line of text each. */
const teamGuides = ['STUDENT_GUIDE.md', 'QUICKSTART.md', 'DEVELOPER_GUIDE.md', 'WORKSHOP_INSTRUCTOR.md'];
const page = (file: string) => readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8').replace(/\s+/g, ' ');

test('guides: the same rule for a session that is gone and for --takeover, and the slot flags, in every guide a team reads', () => {
  for (const file of teamGuides) {
    const text = page(file);
    assert.match(text, /is no longer connected \(a closed laptop, a crash, a stop whose release failed\) is replaced without `--takeover`/, file);
    assert.match(text, /Use `--takeover` only for a live holder who agrees, and only with no call in progress\./, file);
    assert.doesNotMatch(text, /(free|frees) it with `chert dev --takeover`/, file);
    assert.match(text, /`(chert dev )?--until HH:MM`/, file);
  }
});

test('guides: teams install the latest published version, never a fixed beta', () => {
  for (const file of [...teamGuides, 'README.md']) {
    const text = page(file);
    assert.doesNotMatch(text, /0\.1\.0-beta\.\d/, `${file} pins a version`);
    assert.doesNotMatch(text, /npm install -g @trychert\/facetime(?!@beta\b)/, `${file}: install with the beta tag, which every release moves`);
  }
  for (const file of ['STUDENT_GUIDE.md', 'QUICKSTART.md', 'DEVELOPER_GUIDE.md']) assert.match(page(file), /npm install -g @trychert\/facetime@beta/, file);
});

// The Mac ends a call whose agent sends no audible audio within 10 s of bridge_ready. Teams were told to wait for the
// caller instead, and their calls were dropped; every guide now gives the rule and how to follow it.
const GREETING_RULE = /Greet the caller within 10 seconds of `?bridge_ready`?, or the call ends \(`?remote_audio_timeout`?\)\./;
const WAITING_ADVICE = [/let(s)? the caller speak first/i, /say hello first/i, /and speak first/i, /waits for you to speak first/i, /wait for the caller to speak first/i,
  /no greeting of its own/i, /deliberately does not greet/i, /silent until the caller speaks/i, /\| Speak first/i];

test('guides: every guide a team reads gives the greeting rule, and none tells an agent to wait for the caller', () => {
  for (const file of [...teamGuides, 'CLI_GUIDE.md']) {
    const text = page(file);
    assert.match(text, GREETING_RULE, file);
    assert.match(text, /chert_bridge_ready/, file);
    for (const advice of WAITING_ADVICE) assert.doesNotMatch(text, advice, `${file}: ${advice}`);
  }
});

test('guides: the developer guide shows the room signal in Python and Node, and the call API for a room chert dev does not run', () => {
  const text = page('DEVELOPER_GUIDE.md');
  assert.match(text, /`\{"chert_call":"<call id>","chert_bridge_ready":true,"at":"<ISO time>"\}`/);
  assert.match(text, /ctx\.room\.on\("room_metadata_changed", greet_once\)/);
  assert.match(text, /session\.generate_reply\(instructions="Greet the caller in one short sentence\."\)/);
  assert.match(text, /greet_once\(\) # the signal may have come before the session started/);
  assert.match(text, /greetOnBridgeReady\(ctx\.room, \(\) => session\.generateReply\(\{ instructions: 'Greet the caller in one short sentence\.' \}\)\)/);
  assert.match(text, /'roomMetadataChanged'/);
  assert.match(text, /poll the call API, `GET \/api\/v1\/calls\/<call id>`/);
  assert.match(text, /a `bridge_ready` event with `source` `worker`/);
  assert.match(text, /FaceTime is ready\. The room now carries chert_bridge_ready/, 'the call line chert dev prints');
});

test('guide agent: says when to greet; the fix page says why a silent call ends', () => {
  const agent = steps('agent');
  assert.match(agent, /Greet the caller within 10 seconds of bridge_ready, or the call ends \(remote_audio_timeout\)\./);
  assert.match(agent, /chert_bridge_ready/);
  assert.match(agent, /never because the caller joined/);
  assert.doesNotMatch(agent, /speak first/i);
  const silent = topics.find(topic => topic.name === 'fix')!.blocks.flatMap(block => 'rows' in block ? block.rows : []).find(([label]) => label === 'silent call');
  assert.ok(silent);
  assert.match(silent[1], /within 10 s of bridge_ready/);
  assert.doesNotMatch(silent[1], /^Speak first/);
});
