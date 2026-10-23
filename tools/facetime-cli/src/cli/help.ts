/**
 * The help text, as data: the command reference in COMMANDS.md and the tests read the same entries the terminal prints,
 * so a flag cannot be documented without existing or exist without being documented.
 */
import { wrap } from '../dev/frame.js';

export interface CommandHelp {
  name: string; summary: string; about: string; usage: string[];
  /** Flag as typed, then what it does. Every command also takes --json and -h, --help. */
  flags: [string, string][];
  environment?: [string, string][];
  /** Flags and variables for running against another Chert address or for operating a line by hand. Shown with --all. */
  advancedFlags?: [string, string][];
  advancedEnvironment?: [string, string][];
  /** A command a developer no longer needs day to day. It works and explains itself, and is listed with --all. */
  advanced?: true;
  examples: [string, string][];
}
const livekit: [string, string][] = [
  ['LIVEKIT_URL', 'Your LiveKit project address, wss://HOST'],
  ['LIVEKIT_API_KEY', 'LiveKit API key, the same one your agent uses'],
  ['LIVEKIT_API_SECRET', 'LiveKit API secret. It stays on this computer'],
];
const home: [string, string] = ['CHERT_HOME', 'Where the sign-in and call state are kept (default ~/.chert)'];
const token: [string, string] = ['CHERT_USER_ACCESS_TOKEN', 'A credential to use instead of the saved sign-in, for scripts'];
const envFile: [string, string] = ['--env-file PATH', 'Read the LiveKit variables from this file'];
const backend: [string, string] = ['--backend ORIGIN', 'Another Chert address, https://HOST'];
const controlOrigin: [string, string] = ['CHERT_CONTROL_ORIGIN', 'Another Chert address, the same as --backend'];
export const commands: readonly CommandHelp[] = [
  { name: 'onboard', summary: 'Set up shared access, verify your phone and try the demo',
    about: 'Signs in through your browser, asks for your name and phone, creates your default project and allocates shared access. Text the displayed code to verify your phone. Then requests one hosted FaceTime demo. Run it again to resume; provider keys are not needed for the hosted demo.',
    usage: ['chert onboard [flags]', 'chert onboard --status', 'chert onboard --cancel'],
    flags: [['--no-browser', 'Print the browser address for a remote shell'],
      ['--skip-demo', 'Stop after verification without placing a demo call'],
      ['--status', 'Read the saved onboarding status without starting work'],
      ['--cancel', 'Cancel new onboarding work; preserve active call cleanup'],
      ['--restart', 'Start again after an expired, cancelled or completed session'],
      ['--wait SECONDS', 'Maximum verification wait, 0–3600 seconds (default 600)'],
      ['--project UUID', 'Project for an explicit user-session credential']],
    environment: [home], advancedFlags: [backend], advancedEnvironment: [token, controlOrigin],
    examples: [['chert onboard', 'Sign in, verify your number, then answer the hosted demo'], ['chert onboard --no-browser --json', 'Get machine-readable progress and a browser address']] },
  { name: 'login', summary: 'Sign this computer in to your Chert project',
    about: 'Opens your browser to approve this computer for one project. It then stays signed in for 30 days. In a terminal you choose with 1, 2, 3 or the arrow keys.',
    usage: ['chert login', 'chert login --device', 'chert login --with-token < token.txt'],
    flags: [['--device', 'Print the address and code instead of opening a browser, for a remote shell'],
      ['--with-token', 'Read a dashboard session token from standard input. It lasts about an hour']],
    environment: [home],
    advancedFlags: [['--backend ORIGIN', 'Sign in to another Chert address, https://HOST']],
    advancedEnvironment: [controlOrigin],
    examples: [['chert login', 'Sign in with the browser'], ['chert login --device', 'On a server: open the printed address on any device']] },
  { name: 'new', summary: 'Create an agent folder from the starter, ready for your keys',
    about: 'Copies the voice starter (or the video starter with --video) from this package into a new folder and writes its .env.local with the agent name filled in. You add your LiveKit values and OPENAI_API_KEY, run npm install and npm start, then chert dev.',
    usage: ['chert new <dir>', 'chert new <dir> --video'],
    flags: [['--video', 'Start from the video starter: it publishes a drawn face as its camera'],
      ['--agent NAME', 'The agent_name written to .env.local. Default: the folder name, cleaned']],
    examples: [['chert new my-agent', 'A voice agent in my-agent/, named my-agent'], ['chert new otter --video', 'A video agent in otter/']] },
  { name: 'dev', summary: 'Put your LiveKit agent on your line until you press Ctrl+C',
    about: 'Claims your project\'s FaceTime line, keeps a room ready with your agent in it, and answers each call with that agent. Ctrl+C releases the line, and so does the end of a time slot set with --until or --minutes. Start your agent first.',
    usage: ['chert dev [--agent NAME] [flags]'],
    flags: [['--agent NAME', 'The agent_name your LiveKit agent registers with. Default: AGENT_NAME in .env.local'],
      envFile,
      ['--project UUID', 'The project to use when you belong to several'],
      ['--until HH:MM', 'Release the line at this time today, once no call is in progress. Teams waiting for the line see the time'],
      ['--minutes N', 'Release the line after N minutes (1 to 240), once no call is in progress'],
      ['--takeover', 'Replace another session that holds the line'],
      ['--force', 'Take the line even when Chert says it cannot take calls yet (paused, offline, not acknowledged). Calls decline until it can']],
    environment: [...livekit, home],
    advancedFlags: [['--no-prewarm', 'Create the room when a call arrives instead of keeping one ready. Chert gives about 5 s to answer, so calls can be declined; not for teams'],
      ['--muse', 'Prepare one Muse session per run. See CLI_GUIDE.md'],
      backend,
      ['--relay-origin ORIGIN', 'Another connector relay address, https://HOST']],
    advancedEnvironment: [token, controlOrigin, ['CHERT_RELAY_ORIGIN', 'Another relay address, the same as --relay-origin']],
    examples: [['chert dev', 'In your agent\'s folder: answer calls with the agent named in .env.local'], ['chert dev --agent my-agent', 'Answer calls with the agent registered as my-agent'], ['chert dev --agent my-agent --env-file .env.local', 'Take the LiveKit keys from a file'],
      ['chert dev --until 14:30', 'Your time slot ends at 14:30: release the line for the next team then']] },
  { name: 'doctor', summary: 'Check sign-in, LiveKit keys, the line and your agent',
    about: 'Runs each check chert dev depends on and says what to fix. With --agent it also sends your agent a test job and times how long it takes to join.',
    usage: ['chert doctor [--agent NAME] [flags]'],
    flags: [['--agent NAME', 'Also check that this agent joins a test room. This runs a real agent job'],
      envFile,
      ['--project UUID', 'The project to check when you belong to several']],
    environment: [...livekit, home],
    advancedFlags: [backend],
    advancedEnvironment: [token, controlOrigin],
    examples: [['chert doctor', 'Check sign-in, the project, the line and the Mac behind it'], ['chert doctor --agent my-agent', 'Also check that the agent answers']] },
  { name: 'guide', summary: 'A short handbook: your agent, video, sharing a line, fixes',
    about: 'Explains in the terminal how Chert works and how to set up a voice or video agent. Without a topic it shows the first page and lists the others: agent, video, line, fix.',
    usage: ['chert guide [TOPIC]'], flags: [],
    examples: [['chert guide', 'How it works and the setup, in one page'], ['chert guide video', 'Video agents and avatars'], ['chert guide fix', 'When something goes wrong']] },
  { name: 'context', summary: 'Chert\'s rules for a coding agent, as an AGENTS.md block',
    about: 'Prints one Markdown block for an AGENTS.md: the commands, the rules the Mac enforces, the secrets rule, the output contract and the fixes, rendered from this CLI\'s own help and guide so it cannot drift. Paste it into your agent folder\'s AGENTS.md, or let the starter from chert new carry it.',
    usage: ['chert context', 'chert context --write [DIR]', 'chert context --check [DIR]'],
    flags: [['--write [DIR]', 'Write or refresh the block in AGENTS.md (your text outside the marks stays) and make CLAUDE.md import it. Default: this folder'],
      ['--check [DIR]', 'Exit 3 when the block is missing or out of date, 0 when current']],
    examples: [['chert context', 'Print the block'], ['chert context --write', 'In your agent folder: AGENTS.md and CLAUDE.md up to date'], ['chert context --check --json', 'For a script: the state of both files']] },
  { name: 'whoami', summary: 'Show who is signed in, and to which project',
    about: 'Asks Chert, so it also tells you when a sign-in was revoked. Offline, it shows what is saved and says it could not confirm it.',
    usage: ['chert whoami'], flags: [], environment: [home], advancedEnvironment: [token], examples: [['chert whoami', 'Signed in as you@example.com · project Acme (admin).']] },
  { name: 'logout', summary: 'Sign out and revoke this computer',
    about: 'Removes the saved sign-in and revokes it at Chert, so it cannot be used again from anywhere.',
    usage: ['chert logout'], flags: [], environment: [home], examples: [['chert logout', 'Signed out. The credential was revoked at Chert.']] },
  { name: 'setup', summary: 'Save a project and an env file as defaults for dev and doctor', advanced: true,
    about: 'Not needed when you run chert dev from your agent\'s folder: the keys are read from .env.local there. This saves a project and an env file for running from anywhere else. Only the path is saved, never the keys.',
    usage: ['chert setup --env-file PATH --project UUID', 'chert setup --clear'],
    flags: [['--env-file PATH', 'The file holding the three LiveKit variables'], ['--project UUID', 'The project to use'], ['--clear', 'Remove the saved defaults. Sign-in is not changed']],
    environment: [home], examples: [['chert setup --env-file .env.local --project PROJECT_UUID', 'Save both'], ['chert setup --clear', 'Forget them']] },
];
const common: [string, string][] = [['--json', 'Print machine-readable records instead of text'], ['-h, --help', 'Show this help']];
export const exitCodes = 'Exit codes: 0 success, 1 internal, 2 usage, 3 not ready or not signed in, 4 state, 5 unsupported runtime, 6 network or server, 130 cancelled.';
/** Two columns inside 80: a long description continues under its own column. */
export const table = (rows: [string, string][], width = Math.max(...rows.map(([left]) => left.length))) => rows.flatMap(([left, right]) =>
  wrap(right, 80 - width - 4).map((line, i) => `  ${(i ? '' : left).padEnd(width)}  ${line}`));

/** Every flag and variable of a command, the advanced ones last. */
export const allFlags = (command: CommandHelp): [string, string][] => [...command.flags, ...(command.advancedFlags ?? [])];
export const allEnvironment = (command: CommandHelp): [string, string][] => [...(command.environment ?? []), ...(command.advancedEnvironment ?? [])];
/** What `chert --help` prints: how to start, the commands, the one rule for video, and where to learn more. */
export function mainHelp(): string {
  return ['chert: put your voice or video agent on a FaceTime line', '', 'USAGE', '  chert <command> [flags]', '',
    'GET STARTED', ...table([['1. chert login', 'Sign in once, in your browser'],
      ['2. chert new my-agent', 'A starter agent in my-agent/. Put your LiveKit values and model key in its .env.local'],
      ['3. npm start', 'In my-agent, in a second terminal: your agent (or python agent.py dev, or your own command)'],
      ['4. chert doctor', 'Check sign-in, LiveKit keys, the line and your agent'],
      ['5. chert dev', 'Put your agent on the line, then call the line on FaceTime']]), '',
    'COMMANDS', ...table(commands.filter(command => !command.advanced).map(command => [command.name, command.summary])), '',
    'VIDEO', ...wrap('Call with FaceTime Video, and publish a camera track from the participant that speaks. Without one the caller sees the line\'s default picture.', 78).map(line => `  ${line}`), '',
    'FLAGS', ...table([['-h, --help', 'Show help for chert or for a command'], ['-v, --version', 'Show the version'], ['    --json', 'Print machine-readable records instead of text']]), '',
    'LEARN MORE', ...table([['chert guide', 'How it works, in one page'], ['chert guide video', 'Video agents and avatars'], ['chert guide fix', 'When something goes wrong'],
      ['chert <command> --help', 'Every flag of one command'], ['chert --help --all', 'Advanced commands'], ['Docs', 'docs.trychert.com']])].join('\n');
}
/** The developer commands kept out of the short help, as `chert --help --all` lists them. */
export const advancedHelp = (): string => table(commands.filter(command => command.advanced).map(command => [command.name, command.summary])).join('\n');
/** What `chert <command> --help` prints. With `all`, the advanced flags and the exit codes as well. */
export function commandHelp(name: string, all = false): string | undefined {
  const command = commands.find(entry => entry.name === name);
  if (!command) return undefined;
  const flags = all ? allFlags(command) : command.flags, environment = all ? allEnvironment(command) : command.environment ?? [];
  return [`chert ${command.name}: ${command.summary}`, '', ...wrap(command.about, 78), '', 'USAGE', ...command.usage.map(line => `  ${line}`), '', 'FLAGS',
    ...table([...flags, ...common]),
    ...(environment.length ? ['', 'ENVIRONMENT', ...table(environment)] : []), '', 'EXAMPLES',
    ...command.examples.flatMap(([line, what]) => [`  ${line}`, `      ${what}`]), '',
    ...(all ? wrap(exitCodes, 80) : [`More flags and exit codes: chert ${command.name} --help --all`])].join('\n');
}
/** The developer command a mistyped word most likely meant: within two edits, or nothing. */
export function closest(word: string): string | undefined {
  const distance = (a: string, b: string) => {
    let row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) { const next = [i]; for (let j = 1; j <= b.length; j++) next.push(Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))); row = next; }
    return row[b.length]!;
  };
  const [best] = commands.map(command => [command.name, distance(word.toLowerCase(), command.name)] as const).sort((a, b) => a[1] - b[1]);
  return best && best[1] <= 2 ? best[0] : undefined;
}
/** COMMANDS.md, rendered from the same entries the terminal prints. Regenerate with `node scripts/command-reference.mjs`. */
export function commandReference(): string {
  const rows = (pairs: [string, string][], head: string) => [`| ${head} | What it does |`, '|---|---|', ...pairs.map(([left, right]) => `| \`${left}\` | ${right} |`)];
  return ['# Chert command reference', '',
    'Every command of the `chert` command-line tool that a developer uses. This page is generated from the tool\'s own help, so it matches what `chert <command> --help` prints. To get started, read the [developer guide](DEVELOPER_GUIDE.md).', '',
    '```', 'npm install -g @trychert/facetime@beta', 'chert login', 'chert doctor --agent my-agent', 'chert dev --agent my-agent', '```', '',
    ...rows(commands.map(command => [`chert ${command.name}`, command.summary]), 'Command'), '',
    'Every command also takes `--json`, which prints machine-readable records instead of text, and `-h` or `--help`.', '',
    ...commands.flatMap(command => [`## chert ${command.name}`, '', `${command.summary}.`, '', command.about, '', '```', ...command.usage, '```', '',
      ...(allFlags(command).length ? [...rows(allFlags(command), 'Flag'), ''] : ['This command has no flags of its own.', '']),
      ...(allEnvironment(command).length ? [...rows(allEnvironment(command), 'Environment variable'), ''] : []),
      'Examples:', '', '```', ...command.examples.flatMap(([line, what]) => [`$ ${line}`, `# ${what}`]), '```', '']),
    '## Exit codes', '', exitCodes.replace('Exit codes: ', '').replace(/\.$/, '').split(', ').map(part => `- ${part.replace(/^(\d+) /, '`$1` ')}`).join('\n'), '',
    '## Advanced commands', '', 'The connector and enrollment commands (`init`, `check`, `byor`, `create-room`, `run`, `status`, `projects`, `lines`, `bindings`, `enroll`, `activate`, `drain`, `revoke`) are for operating a connector by hand. `chert dev` does all of that for you. Run `chert --help --all` to see them, and read [CLI_GUIDE.md](CLI_GUIDE.md).', ''].join('\n');
}
/** The connector and enrollment commands, as they have always been described. Shown by `chert --help --all`. */
export const operatorHelp = `Usage: chert <init|check|byor|create-room|run|status|projects|lines|bindings|enroll|activate|drain|revoke> --config PATH [--json]
       chert --help | --version
init: --mode byor (default) --state-dir ABSOLUTE_PATH [--handler-module ABSOLUTE_JS] [--handler-id ID]
      Generates chert-handler.ts beside config; compile it before check/start.
create-room init: --mode create-room --non-interactive --agent-name NAME --deployment NAME --boot ID
      --livekit-url wss://HOST --hook-origin http://127.0.0.1:PORT
      --state-dir ABSOLUTE_PATH
      [--livekit-key-env NAME] [--livekit-secret-env NAME] [--hook-secret-env NAME]
      [--development PATH_TO_LOOPBACK_CONFIG]
Credentials are environment references only; no secret-value flags.
init never enrolls or activates. Start the supported agent separately.
check is non-allocating, partial diagnostics; status is a saved observation.
Hosted enrollment: --backend HTTPS_ORIGIN --project UUID --line UUID
  --relay-origin HTTPS_ORIGIN --output-config NEW_PATH --credentials-file NEW_PATH
projects/lines/bindings inspect existing Chert auth using CHERT_USER_ACCESS_TOKEN.
activate requires --expected-binding none|UUID --assignment-generation INTEGER.
Enrollment remains standby. drain restores legacy routing; revoke blocks the
connection credential while preserving separate owned-call recovery.
SIGINT/SIGTERM drains local admission and preserves accepted/uncertain work.
Exit: 0 success, 1 internal, 2 config/usage, 3 partial/debt, 4 state/lock,
      5 runtime/platform, 6 transport/backend, 130 sign-in cancelled. See CLI_GUIDE.md.`;
