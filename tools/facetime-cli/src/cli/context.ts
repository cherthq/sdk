// `chert context`: Chert's rules for a coding agent, as one Markdown block for an AGENTS.md. It is rendered from the same
// help entries and guide pages the terminal prints, so it cannot say something the CLI does not, and a sentence that
// leaves the guide makes this module throw rather than go quietly out of date. Stays under 150 lines and 12 KiB: Codex
// reads at most 32 KiB of AGENTS.md files and Claude Code aims at 200 lines per file. Never a key value: names only.
import { allEnvironment, commands, exitCodes } from './help.js';
import { topics, type GuideTopic } from './guide.js';
import { cliVersion } from './version.js';
import { CLIError } from './errors.js';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** The first line of the block starts with this; the version and the refresh command follow in the same comment. */
export const BEGIN_MARK = '<!-- chert:begin context v1';
/** The last line of the block. User text outside the two marks is never touched by `chert context --write`. */
export const END_MARK = '<!-- chert:end -->';

/** The guide sentence that matches `pattern`, from the steps and rows of a topic. Missing means the guide changed: fail. */
function sentence(topic: string, pattern: RegExp): string {
  const page = topics.find(entry => entry.name === topic);
  const texts = (page?.blocks ?? []).flatMap((block: GuideTopic['blocks'][number]) => 'steps' in block ? block.steps : 'rows' in block ? block.rows.map(([left, right]: [string, string]) => `${left}: ${right}`) : 'text' in block ? [block.text] : []);
  const found = texts.find(text => pattern.test(text));
  if (!found) throw new Error(`chert context: the guide topic "${topic}" no longer has a sentence matching ${pattern}`);
  return found;
}
const lower = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);
const summary = (name: string): string => { const command = commands.find(entry => entry.name === name); if (!command) throw new Error(`chert context: no help entry for ${name}`); return command.summary; };
const flag = (name: string, text: string): string => { const found = commands.find(entry => entry.name === name)?.advancedFlags?.concat(commands.find(entry => entry.name === name)?.flags ?? []).find(([left]) => left.startsWith(text)); if (!found) throw new Error(`chert context: no flag ${text} on ${name}`); return found[1]; };

/** The block: `{ markdown, version }`. The version is the CLI's, stamped in the first line and the Commands heading. */
export function context(): { markdown: string; version: string } {
  const version = cliVersion() ?? 'unknown';
  const dev = commands.find(entry => entry.name === 'dev')!;
  const livekit = allEnvironment(dev).map(([name]) => name).filter(name => name.startsWith('LIVEKIT_'));
  const fix = topics.find(entry => entry.name === 'fix')!.blocks.flatMap(block => 'rows' in block ? block.rows : []);
  const lines = [
    `${BEGIN_MARK} (chert ${version}; refresh: chert context --write) -->`,
    '# Chert: this agent answers FaceTime calls', '',
    '## What this folder is',
    '- A LiveKit agent. `chert dev` connects it to this project\'s Chert FaceTime line; each call joins a LiveKit room with the agent already in it (the "waiting room").',
    '- Sign-in and project: `chert whoami --json`. A line answers one call at a time and may be shared with other teams in time slots (see Shared line).', '',
    `## Commands (chert ${version})`,
    `- \`chert onboard --json\`: ${summary('onboard')}. Give the user the browser address when they need to act, and wait; if it stops, run the same command again, and never pass \`--restart\` while a session is active.`,
    `- \`chert login --device --json\`: ${summary('login')}. Show the user \`verification_url_complete\` and \`user_code\` from the \`login_code\` record and wait; never approve it yourself.`,
    `- \`chert new <dir> [--video]\`: ${summary('new')}. Then \`npm install\`; the user fills \`.env.local\`.`,
    `- \`chert doctor --agent "$AGENT_NAME" --json\`: ${summary('doctor')}. Exit 0 means ready; each failed check says what to fix.`,
    `- \`chert dev --json\`: ${summary('dev')}. Run it in the background after \`npm start\`; wait for \`agent_warm\`; add \`--minutes N\` or \`--until HH:MM\` for a bounded run.`,
    '- Stop `chert dev` with SIGINT or SIGTERM and wait for `dev_stopped`; never SIGKILL (the line would stay held until its lease lapses).',
    `- \`chert whoami\`: ${summary('whoami')}. \`chert logout\`: ${summary('logout')}. \`chert guide [TOPIC]\`: ${summary('guide')}. \`chert context\`: ${summary('context')}.`,
    `- Never pass \`--takeover\` (${lower(flag('dev', '--takeover'))}), \`--force\` (${lower(flag('dev', '--force').split('.')[0]!)}) or \`--no-prewarm\` unless the user asks for it by name.`, '',
    '## Rules the Mac enforces',
    `- ${sentence('agent', /^Register with a name/)}`,
    `- ${sentence('agent', /^Use the LiveKit project/)}`,
    `- ${sentence('agent', /^Join the room at once/)}`,
    `- ${sentence('agent', /^Greet the caller within 10 seconds of bridge_ready/)}`,
    `- ${sentence('agent', /^The caller joins the room as/)}`,
    `- ${sentence('agent', /^Publish exactly one unmuted audio track/)}`,
    `- Video: ${sentence('video', /camera track from the participant that speaks/)}`,
    `- ${sentence('agent', /restart both terminals/)}`, '',
    '## Shared line',
    `- ${sentence('line', /^One line answers one call at a time/)}`,
    `- ${sentence('line', /line_in_use/)}`,
    `- ${sentence('line', /--takeover only/)}`,
    '- Queue behaviour, slot lengths and limits come from Chert; the CLI prints them as records (`slot_set`, `slot_ending`, `slot_over`, `line_in_use`). Do not work around a slot or a holder.', '',
    '## Secrets',
    `- \`.env.local\` in this folder holds ${livekit.map(name => `\`${name}\``).join(', ')} (one LiveKit project), the model key the agent uses, and \`AGENT_NAME\`.`,
    '- Never read aloud, print, log, paste, commit or send these values anywhere. Ask the user to fill them in; `chert doctor` verifies them without showing them.', '',
    '## Output contract',
    '- `--json` on any command: one JSON record per line with `schema_version: 1` and `command`. Errors go to standard error as `{code, action}`; the action says what to do.',
    `- ${exitCodes}`,
    '- Records to watch from `chert dev`: `line_state`, `agent_warm`, `agent_not_warm`, `slot_set`, `slot_ending`, `slot_over`, `call_incoming`, `call_accepted`, `call_bridge_ready`, `call_media`, `call_declined`, `call_ended`, `reconnecting`, `dev_reconnected`, `displaced`, `dev_stopped`, `release_failed`.', '',
    '## When something fails',
    ...fix.map(([code, text]) => `- \`${code}\`: ${text}`),
    END_MARK,
  ];
  return { markdown: lines.join('\n'), version };
}

/** The few file operations `--write` and `--check` use, so a test can see every path they touch (none is .env.local). */
export interface ContextFS {
  readFile(path: string): string | undefined;
  writeFile(path: string, text: string): void;
  lstat(path: string): { symlink: boolean; file: boolean; directory: boolean } | undefined;
}
const nodeFS: ContextFS = {
  readFile: path => { try { return readFileSync(path, 'utf8'); } catch { return undefined; } },
  writeFile: (path, text) => writeFileSync(path, text),
  lstat: path => { try { const s = lstatSync(path); return { symlink: s.isSymbolicLink(), file: s.isFile(), directory: s.isDirectory() }; } catch { return undefined; } },
};
export type ContextAction = { file: 'AGENTS.md' | 'CLAUDE.md'; action: 'created' | 'updated' | 'appended' | 'unchanged' | 'missing' | 'stale' };
const IMPORT = '@AGENTS.md';

/** AGENTS.md with the block in place: replaced between the marks when present, else appended after the user's text. */
function withBlock(current: string | undefined, block: string): string {
  if (current === undefined || current.trim() === '') return block + '\n';
  const lines = current.split('\n');
  const begin = lines.findIndex(line => line.startsWith(BEGIN_MARK)), end = lines.findIndex(line => line === END_MARK);
  if (begin === -1 && end === -1) return current.replace(/\n*$/, '\n\n') + block + '\n';
  if (begin === -1 || end === -1 || end < begin) throw new CLIError('context_block_damaged', 4, 'AGENTS.md has one chert mark without the other. Remove the partial block by hand, then run chert context --write again.');
  return [...lines.slice(0, begin), ...block.split('\n'), ...lines.slice(end + 1)].join('\n');
}

/** Write or check the block in `dir`: AGENTS.md and a CLAUDE.md that imports it. Symlinks are refused; .env.local is never opened. */
export function applyContext(dir: string, mode: 'write' | 'check', fs: ContextFS = nodeFS): { actions: ContextAction[]; current: boolean } {
  const folder = fs.lstat(dir);
  if (!folder?.directory) throw new CLIError('invalid_usage', 2, `${dir} is not a folder. Run chert context --write in your agent's folder, or name one.`);
  const { markdown } = context();
  const agents = join(dir, 'AGENTS.md'), claude = join(dir, 'CLAUDE.md');
  for (const path of [agents, claude]) {
    const info = fs.lstat(path);
    if (info?.symlink) throw new CLIError('context_target_symlink', 4, `${path} is a symbolic link. chert context writes only regular files; replace the link with a file, or run it in another folder.`);
    if (info && !info.file) throw new CLIError('context_target_symlink', 4, `${path} is not a regular file.`);
  }
  const agentsNow = fs.readFile(agents), claudeNow = fs.readFile(claude);
  const agentsNext = withBlock(agentsNow, markdown);
  const claudeNext = claudeNow === undefined ? IMPORT + '\n' : claudeNow.split('\n').some(line => line.trim() === IMPORT) ? claudeNow : claudeNow.replace(/\n?$/, '\n') + IMPORT + '\n';
  const actions: ContextAction[] = [
    { file: 'AGENTS.md', action: agentsNow === undefined ? (mode === 'check' ? 'missing' : 'created') : agentsNext === agentsNow ? 'unchanged' : (mode === 'check' ? 'stale' : 'updated') },
    { file: 'CLAUDE.md', action: claudeNow === undefined ? (mode === 'check' ? 'missing' : 'created') : claudeNext === claudeNow ? 'unchanged' : (mode === 'check' ? 'stale' : 'appended') },
  ];
  if (mode === 'write') {
    if (agentsNext !== agentsNow) fs.writeFile(agents, agentsNext);
    if (claudeNext !== claudeNow) fs.writeFile(claude, claudeNext);
  }
  return { actions, current: actions.every(entry => entry.action === 'unchanged') };
}

/** `chert context [--json]`, `chert context --write [DIR]`, `chert context --check [DIR]`. */
export async function contextCommand(args: string[], emit: (record: Record<string, unknown>) => void, cwd = process.cwd()): Promise<number> {
  const json = args.includes('--json');
  let mode: 'print' | 'write' | 'check' = 'print'; let dir: string | undefined;
  for (const arg of args) {
    if (arg === '--json') continue;
    if (arg === '--write' || arg === '--check') { if (mode !== 'print') throw usage(); mode = arg === '--write' ? 'write' : 'check'; continue; }
    if (arg.startsWith('-') || dir !== undefined || mode === 'print') throw usage();
    dir = arg;
  }
  if (mode === 'print') { const { markdown, version } = context(); emit({ code: 'context', markdown, version, ...(json ? {} : { message: markdown }) }); return 0; }
  const target = resolve(cwd, dir ?? '.');
  const { actions, current } = applyContext(target, mode);
  const summary = actions.map(entry => `${entry.file}: ${entry.action}`).join('; ');
  if (mode === 'check') {
    if (current) { emit({ code: 'context_current', dir: target, actions, message: `Up to date in ${target}: ${summary}.` }); return 0; }
    const missing = actions.some(entry => entry.action === 'missing' && entry.file === 'AGENTS.md');
    throw new CLIError(missing ? 'context_missing' : 'context_stale', 3, `${missing ? 'No AGENTS.md with the Chert block' : 'The Chert block or the CLAUDE.md import is out of date'} in ${target} (${summary}). Run chert context --write ${dir ?? ''}`.trim() + '.');
  }
  emit({ code: 'context_written', dir: target, actions, message: `${summary} in ${target}.` });
  return 0;
}
const usage = () => new CLIError('invalid_usage', 2, 'Usage: chert context [--json], chert context --write [DIR], or chert context --check [DIR].');
