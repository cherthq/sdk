// The entry point routes and nothing more: each command loads what it needs when it runs, so --help, --version and a
// mistyped command start in the time Node itself takes.
import { CLIError, failure } from './errors.js';
import { developerCommands, operatorCommands } from './names.js';
import { stopOnSignals } from '../dev/signals.js';
import { cliVersion } from './version.js';
import { advancedHelp, closest, commandHelp, mainHelp, operatorHelp } from './help.js';
import { errorLine, sessionLine, styleFor } from './present.js';
export async function main(args: string[]): Promise<number> {
  // -h and -v are the short forms people try first.
  args = args.map(arg => arg === '-h' ? '--help' : arg === '-v' ? '--version' : arg);
  const isJson = args.includes('--json');
  // First run: a bare `chert` in a terminal, with nobody signed in, opens the welcome screen instead of the help text.
  // Signed in, it shows who and where, and the few commands a developer needs. Outside a terminal it prints the help.
  if (!args.length && process.stdin.isTTY === true && process.stdout.isTTY === true) {
    try {
      const dev = await import('../dev/command.js');
      const terminal = dev.terminalFor(process.env, false, process.stdin, process.stdout);
      if (terminal) { if (dev.signedIn(process.env)) { process.stdout.write(dev.homeScreen(process.env, terminal) + '\n'); return 0; } args = ['login']; }
    } catch { /* fall through to help */ }
  }
  const selected = args[0];
  const command = [...operatorCommands, ...developerCommands].includes(selected ?? '') ? selected! : 'usage';
  // A mistyped command is answered in a sentence, like the developer commands; the connector commands keep their records.
  const friendly = (developerCommands.includes(command) || command === 'usage') && !isJson;
  const output = (data: Record<string, unknown>, error = false) => {
    const record = { schema_version: 1, command, ...data };
    if (friendly) {
      // An error reads as an instruction; its code follows, for the troubleshooting tables and for searching.
      const text = error ? errorLine(String(data.code), String(data.action), styleFor(process.stderr, process.env))
        : command === 'dev' ? sessionLine(data, styleFor(process.stdout, process.env)) : data.message;
      if (typeof text === 'string') (error ? process.stderr : process.stdout).write(text + '\n'); return;
    }
    (error ? process.stderr : process.stdout).write((isJson ? JSON.stringify(record) : JSON.stringify(record, null, 2)) + '\n');
  };
  try {
    const wantsHelp = args.includes('--help');
    if (!args.length || (command === 'usage' && wantsHelp && args.every(arg => arg === '--help' || arg === '--all' || arg === '--json'))) {
      process.stdout.write(mainHelp() + (args.includes('--all') ? `\n\nADVANCED\n${advancedHelp()}\n\n${operatorHelp}` : '') + '\n'); return 0;
    }
    if (command !== 'usage' && wantsHelp) { process.stdout.write((commandHelp(command, args.includes('--all')) ?? operatorHelp) + '\n'); return 0; }
    if (args.length === 1 && args[0] === '--version') {
      process.stdout.write(`chert ${cliVersion() ?? 'unknown'}\n`); return 0;
    }
    if (command === 'usage') {
      const guess = selected && !selected.startsWith('-') ? closest(selected) : undefined;
      throw new CLIError('invalid_command', 2, `${selected && !selected.startsWith('-') ? `Unknown command ${JSON.stringify(selected.slice(0, 40))}. ` : ''}${guess ? `Did you mean chert ${guess}? ` : ''}Run chert --help.`);
    }
    // Chert's rules for a coding agent: rendered from the help and the guide, no sign-in, no network.
    if (command === 'context') return await (await import('./context.js')).contextCommand(args.slice(1), output, process.cwd());
    if (developerCommands.includes(command)) {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      const remove = command === 'dev' ? stopOnSignals(controller, output)
        : command === 'login' || command === 'onboard' ? (process.once('SIGINT', cancel), process.once('SIGTERM', cancel), () => { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); }) : () => {};
      try { return await (await import('../dev/command.js')).developerCommand(command, args.slice(1), process.env, controller.signal, output); }
      finally { remove(); }
    }
    return await (await import('./operator.js')).operatorCommand(command, args.slice(1), output);
  } catch (error) { const safe = failure(error); output({ code: safe.code, action: safe.action }, true); return safe.exit; }
}
