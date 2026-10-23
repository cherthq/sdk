// `chert new <dir>`: an agent folder from a starter shipped inside this package, with .env.local ready for the keys.
// The CLI connects agents; the starter is a working one to begin from, not a framework.
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLIError } from './errors.js';

/** The starters, as folders under examples/ in this package. */
export const STARTERS = { 'student-agent': 'a voice agent', 'video-agent': 'a video agent that publishes a drawn face' } as const;
export type Starter = keyof typeof STARTERS;
/** Never copied into a new folder: installed modules, a lockfile that pins another machine's install, and anyone's secrets. */
const SKIPPED = new Set(['node_modules', 'package-lock.json', '.env.local', '.DS_Store']);
/** The agent_name a LiveKit agent registers with, as chert dev and chert doctor accept it. */
const AGENT_PATTERN = /^[A-Za-z0-9_.-]{1,80}$/;

/** Where the starters live: beside dist/ in the installed package, and the same in the checkout. */
export function starterRoot(starter: Starter): string {
  return fileURLToPath(new URL(`../../../examples/${starter}/`, import.meta.url));
}

/** A folder name as an agent name: lower case, letters, digits, dot, dash and underscore; anything else becomes a dash. */
export function agentNameFrom(folder: string): string {
  const cleaned = folder.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80);
  return cleaned || 'my-agent';
}

export interface Scaffold { dir: string; starter: Starter; agent: string; files: string[] }
/** Create `dir` under `cwd` from the starter, and write .env.local with the agent name filled in. Refuses a folder that has files. */
export function scaffold(input: { dir: string; video?: boolean; agent?: string }, cwd: string): Scaffold {
  const name = input.dir.trim();
  if (!name || name.startsWith('-')) throw new CLIError('missing_input', 2, 'Name the folder: chert new my-agent (add --video for the video starter).');
  const dir = resolve(cwd, name);
  if (existsSync(dir)) {
    if (!statSync(dir).isDirectory()) throw new CLIError('new_target_exists', 2, `${name} exists and is not a folder. Choose another name.`);
    if (readdirSync(dir).length) throw new CLIError('new_target_exists', 2, `${name} already has files. Choose another name, or an empty folder.`);
  }
  const agent = input.agent ?? agentNameFrom(basename(dir));
  if (!AGENT_PATTERN.test(agent)) throw new CLIError('invalid_agent_name', 2, 'Agent names use letters, digits, dot, dash and underscore (at most 80).');
  const starter: Starter = input.video ? 'video-agent' : 'student-agent';
  const source = starterRoot(starter);
  if (!existsSync(join(source, 'agent.mjs'))) throw new CLIError('starter_missing', 6, `This install of the CLI has no ${starter} starter at ${source}. Reinstall @trychert/facetime.`);
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  for (const entry of readdirSync(source).sort()) {
    if (SKIPPED.has(entry) || !statSync(join(source, entry)).isFile()) continue;
    copyFileSync(join(source, entry), join(dir, entry)); files.push(entry);
  }
  // .env.local from .env.example: the agent name is known, the keys are the developer's to fill in. Owner-only, like any secrets file.
  const example = readFileSync(join(source, '.env.example'), 'utf8');
  const env = example.split('\n').map(line => line.startsWith('AGENT_NAME=') ? `AGENT_NAME=${agent}` : line).join('\n');
  const fd = openSync(join(dir, '.env.local'), 'w', 0o600);
  try { writeFileSync(fd, env); fsyncSync(fd); } finally { closeSync(fd); }
  files.push('.env.local');
  // npm leaves .gitignore out of a package, so the installed starter has none: write the one the checkout carries.
  if (!files.includes('.gitignore')) { writeFileSync(join(dir, '.gitignore'), 'node_modules/\n.env\n.env.*\n!.env.example\n*.log\n.DS_Store\n'); files.push('.gitignore'); }
  return { dir, starter, agent, files };
}

/** `chert new <dir> [--video] [--agent NAME]`. Prints what was made and the next three commands. */
export async function newCommand(args: string[], emit: (record: Record<string, unknown>) => void, cwd = process.cwd()): Promise<number> {
  const positional: string[] = []; let video = false; let agent: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--video') { if (video) throw usage(); video = true; }
    else if (arg === '--agent') { if (agent !== undefined || i + 1 >= args.length) throw usage(); agent = args[++i]!; }
    else if (arg === '--json') { /* the caller chose the output shape */ }
    else if (arg.startsWith('--')) throw usage();
    else positional.push(arg);
  }
  if (positional.length > 1) throw usage();
  if (!positional.length) throw new CLIError('missing_input', 2, 'Name the folder: chert new my-agent (add --video for the video starter).');
  const made = scaffold({ dir: positional[0]!, video, ...(agent !== undefined ? { agent } : {}) }, cwd);
  const folder = basename(made.dir);
  emit({ code: 'new_created', dir: made.dir, starter: made.starter, agent: made.agent, files: made.files,
    message: [`Created ${folder}/ from the ${made.starter} starter (${STARTERS[made.starter]}). Its .env.local names the agent "${made.agent}".`, '', 'Next:',
      `  1. cd ${folder} && npm install`, `     then put your LiveKit values and OPENAI_API_KEY in .env.local`,
      `  2. npm start                       (terminal 1: your agent)`,
      `  3. chert dev --agent ${made.agent}   (terminal 2: on the line; chert doctor --agent ${made.agent} checks first)`].join('\n') });
  return 0;
}
const usage = () => new CLIError('invalid_usage', 2, 'Use chert new <dir> [--video] [--agent NAME].');
