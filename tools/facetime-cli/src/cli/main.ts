#!/usr/bin/env node
// Startup gate is intentionally dependency-free and precedes config, credentials,
// SDK initialization and all network/filesystem effects.
import { supportedNode, SUPPORTED_NODE } from './node-version.js';
const json = process.argv.includes('--json');
if (!supportedNode(process.versions.node) || process.platform === 'win32') {
  const result = { schema_version: 1, command: 'startup', code: 'unsupported_runtime',
    action: `Use ${SUPPORTED_NODE.text} on macOS or Linux. You have Node ${process.versions.node}.` };
  process.stderr.write((json ? JSON.stringify(result) : `${result.action} (${result.code})`) + '\n');
  process.exitCode = 5;
} else {
  // Dependencies may log raw SDK response bodies. Only our structured, allowlisted
  // diagnostics may write from this standalone CLI process.
  for (const method of ['debug', 'info', 'log', 'warn', 'error'] as const) console[method] = () => undefined;
  try { process.exitCode = await (await import('./commands.js')).main(process.argv.slice(2)); }
  catch { process.stderr.write(json ? '{"schema_version":1,"command":"startup","code":"startup_failed"}\n' : 'Reinstall the compiled private package. (startup_failed)\n'); process.exitCode = 1; }
}
