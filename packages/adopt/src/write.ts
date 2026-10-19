import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHERT_ENV, CHERT_WEBHOOK_ENV, PROVIDERS, type Classification } from './providers';
import { ownerManifest, type Finding, type Scan } from './scan';

export const REPORT = 'ADOPTION_REPORT.md';
const provider = (id: string) => PROVIDERS.find(p => p.id === id)!;
const at = (f: Finding) => `${f.file}:${f.line}`;
const subject = (f: Finding) => f.op ?? (f.url ? (f.kind === 'http' ? `${f.method ?? '?'} ${f.url}` : f.url) : f.name ?? '');
const usage = (f: Finding) => f.class !== undefined;

function updateManifest(root: string, file: string, add: Map<string, string>, remove: Set<string>): boolean {
  const text = readFileSync(join(root, file), 'utf8');
  const json = JSON.parse(text) as Record<string, unknown>;
  const indent = /\n([ \t]+)"/.exec(text)?.[1] ?? '  ';
  const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].filter(s => json[s] && typeof json[s] === 'object');
  const pending = new Map([...add].filter(([pkg]) => !sections.some(s => pkg in (json[s] as object))));
  const adapterFor = (vendor: string) => PROVIDERS.find(p => p.packages.includes(vendor))?.adapter?.package;
  let changed = false;
  for (const section of sections) {
    const entries: [string, string][] = [];
    const before = Object.keys(json[section] as object);
    const sorted = before.every((key, i) => i === 0 || before[i - 1]! <= key);
    for (const [name, version] of Object.entries(json[section] as Record<string, string>)) {
      if (!remove.has(name)) { entries.push([name, version]); continue; }
      changed = true;
      const adapter = adapterFor(name);
      if (adapter && pending.has(adapter)) { entries.push([adapter, pending.get(adapter)!]); pending.delete(adapter); }
    }
    if (sorted) entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    json[section] = Object.fromEntries(entries);
  }
  if (pending.size) {
    const deps = Object.entries((json.dependencies ?? {}) as Record<string, string>);
    const sorted = deps.every(([key], i) => i === 0 || deps[i - 1]![0] <= key);
    const entries = [...deps, ...pending];
    if (sorted) entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    json.dependencies = Object.fromEntries(entries);
    changed = true;
  }
  if (changed) writeFileSync(join(root, file), JSON.stringify(json, null, indent) + (text.endsWith('\n') ? '\n' : ''));
  return changed;
}

function updateEnvExample(root: string, file: string, names: string[]): boolean {
  const path = join(root, file);
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const present = new Set(text.split('\n').map(l => /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/.exec(l)?.[1]).filter(Boolean));
  const missing = names.filter(n => !present.has(n));
  if (!missing.length) return false;
  writeFileSync(path, text + (text && !text.endsWith('\n') ? '\n' : '') + missing.map(n => `${n}=\n`).join(''));
  return true;
}

/** Applies drop-in rewrites. Returns changed paths relative to the scan root. */
export function apply(scan: Scan): string[] {
  const { root } = scan;
  const changed = new Set<string>();
  const byFile = new Map<string, typeof scan.edits>();
  for (const edit of scan.edits.filter(e => e.ok)) byFile.set(edit.file, [...(byFile.get(edit.file) ?? []), edit]);
  for (const [file, edits] of byFile) {
    let text = readFileSync(join(root, file), 'utf8');
    for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.to + text.slice(edit.end);
    writeFileSync(join(root, file), text);
    changed.add(file);
  }

  for (const manifest of scan.manifests) {
    const owned = (file: string) => ownerManifest(scan.manifests, file) === manifest;
    const add = new Map<string, string>(), remove = new Set<string>();
    for (const p of PROVIDERS) {
      if (!p.adapter) continue;
      const rewritten = scan.edits.some(e => e.ok && e.provider === p.id && owned(e.file));
      const fetchUse = p.adapter.kind === 'fetch' && scan.findings.some(f => f.provider === p.id && f.kind === 'http' && f.class === 'drop_in' && owned(f.file));
      if (rewritten || fetchUse) add.set(p.adapter.package, p.adapter.version);
      const remaining = scan.findings.some(f => f.provider === p.id && f.kind === 'import' && !f.adopted && owned(f.file)
        && !scan.edits.some(e => e.ok && e.file === f.file && e.from === f.name));
      const declared = Object.values(manifest.deps).flat();
      if (rewritten && !remaining) for (const pkg of p.packages) if (declared.includes(pkg)) remove.add(pkg);
    }
    if ((add.size || remove.size) && updateManifest(root, manifest.file, add, remove)) changed.add(manifest.file);
  }

  const names = [...CHERT_ENV, ...(scan.findings.some(f => f.kind === 'webhook') ? [CHERT_WEBHOOK_ENV] : [])];
  const examples = scan.envExamples.length ? scan.envExamples : ['.env.example'];
  if (scan.findings.length) for (const file of examples) if (updateEnvExample(root, file, names)) changed.add(file);
  return [...changed].sort();
}

export function summary(findings: Finding[]) {
  const rows = new Map<string, Record<Classification, number> & { detected: number }>();
  for (const f of findings) {
    const row = rows.get(f.provider) ?? { drop_in: 0, native: 0, unsupported: 0, detected: 0 };
    if (f.class) row[f.class]++; else row.detected++;
    rows.set(f.provider, row);
  }
  return [...rows].map(([id, row]) => ({ provider: id, name: provider(id).name, ...row }));
}

const table = (head: string[], rows: string[][]) => [head, head.map(() => '---'), ...rows].map(r => `| ${r.map(c => c.replace(/\|/g, '\\|')).join(' | ')} |`).join('\n');

function manualSteps(findings: Finding[]): string[] {
  const steps: string[] = [];
  for (const f of findings.filter(f => f.kind === 'constructor' && f.class === 'drop_in')) steps.push(`\`${at(f)}\`: ${f.note}`);
  for (const f of findings.filter(f => f.kind === 'http' && f.class === 'drop_in')) steps.push(`\`${at(f)}\`: ${f.note.slice(f.note.lastIndexOf('Route this request'))}`);
  for (const f of findings.filter(f => f.class === 'native')) steps.push(`\`${at(f)}\` (${subject(f)}): ${f.note}`);
  const env = [...new Set(findings.filter(f => f.kind === 'env').map(f => f.name!))].sort();
  steps.push('Provide a Chert API key and base URL as `CHERT_API_KEY` / `CHERT_BASE_URL`. Provider credentials, chat IDs and message IDs do not transfer to Chert.');
  if (env.length) steps.push(`Retire vendor configuration once migrated: ${env.map(n => `\`${n}\``).join(', ')}.`);
  steps.push('Install dependencies with your package manager (or rerun with `--install`). The @cherthq adapters are private and unpublished; obtain them from your Chert distribution.');
  return steps;
}

export function report(scan: Scan): string {
  const { findings } = scan;
  const rows = summary(findings);
  const used = findings.filter(usage);
  const blockers = used.filter(f => f.class === 'unsupported');
  const webhooks = [...new Set(findings.filter(f => f.kind === 'webhook').map(f => f.provider))];
  const lines = [
    '# Chert adoption report', '',
    'Generated by `chert-adopt`. Static analysis only: it cannot see dynamic calls. Chert adapters cover a documented subset of each provider API, not full parity; see COMPATIBILITY.md in the Chert SDK. Unsupported operations reject before any message is sent.', '',
    '## Summary', '',
    rows.length ? table(['Provider', 'drop_in', 'native', 'unsupported', 'detected'], rows.map(r => [r.name, String(r.drop_in), String(r.native), String(r.unsupported), String(r.detected)])) : 'No supported or known iMessage provider usage was found.', '',
    '`drop_in`: the adapter accepts the same call shape. `native`: rewrite to the @cherthq/imessage (or adapter helper) call shown. `unsupported`: blocking; the adapter rejects it.', '',
    `## Unsupported blockers (${blockers.length})`, '',
    ...(blockers.length ? blockers.map(f => `- \`${at(f)}\` ${provider(f.provider).name} \`${subject(f)}\`: ${f.note}`) : ['None.']), '',
    '## Findings', '',
    used.length ? table(['Location', 'Provider', 'Kind', 'Usage', 'Class', 'Note'], used.map(f => [`\`${at(f)}\``, provider(f.provider).name, f.kind, `\`${subject(f)}\``, f.class!, f.note])) : 'None.', '',
    '## Detected configuration', '',
    ...(findings.filter(f => !usage(f)).map(f => `- \`${at(f)}\` ${provider(f.provider).name} ${f.kind} \`${subject(f)}\`: ${f.note}`)), '',
    '## Webhook payload mapping', '',
    ...(webhooks.length ? webhooks.map(id => `- ${provider(id).name}: ${provider(id).webhook.note}`) : ['No provider webhook handlers detected.']), '',
    ...(webhooks.length ? ['Chert webhooks are signed with your Chert subscription secret (`CHERT_WEBHOOK_SECRET`), not the vendor secret. Treat every event as at-least-once and deduplicate by event ID.', ''] : []),
    '## Providers without drop-in support', '',
    `Reported as unsupported for drop-in when detected: ${PROVIDERS.filter(p => p.blocked).map(p => p.name).join(', ')}.`, '',
    '## Manual steps', '',
    ...manualSteps(findings).map((s, i) => `${i + 1}. ${s}`), '',
  ];
  return lines.join('\n');
}

/** Writes ADOPTION_REPORT.md when its content changed. */
export function writeReport(scan: Scan): boolean {
  const path = join(scan.root, REPORT), text = report(scan);
  if (existsSync(path) && readFileSync(path, 'utf8') === text) return false;
  writeFileSync(path, text);
  return true;
}

export function human(scan: Scan, mode: string, changed: string[]): string {
  const rows = summary(scan.findings);
  const out = [`chert-adopt ${mode}: ${scan.root}`, ''];
  if (!rows.length) out.push('No supported or known iMessage provider usage found.');
  else {
    const width = Math.max(...rows.map(r => r.name.length), 8);
    out.push(`${'Provider'.padEnd(width)}  drop_in  native  unsupported  detected`);
    for (const r of rows) out.push(`${r.name.padEnd(width)}  ${String(r.drop_in).padEnd(7)}  ${String(r.native).padEnd(6)}  ${String(r.unsupported).padEnd(11)}  ${r.detected}`);
    out.push('');
    for (const f of scan.findings.filter(f => !usage(f))) out.push(`${'detected'.padEnd(11)}  ${at(f)}  ${f.kind} ${subject(f)}`);
    for (const f of scan.findings.filter(usage)) out.push(`${f.class!.padEnd(11)}  ${at(f)}  ${f.kind} ${subject(f)}${f.class === 'drop_in' ? '' : `\n${' '.repeat(13)}${f.note}`}`);
  }
  out.push('');
  if (mode === 'dry run') out.push('Dry run: no files changed. Rerun with --write to apply drop-in rewrites and write ADOPTION_REPORT.md.');
  else out.push(changed.length ? `Changed: ${changed.join(', ')}` : 'No changes needed.');
  out.push('Subset migration, not full provider parity: see COMPATIBILITY.md.');
  return out.join('\n');
}

