import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { PROVIDERS, type Classification, type Outcome, type Provider } from './providers';

export type Kind = 'dependency' | 'import' | 'constructor' | 'call' | 'http' | 'base_url' | 'env' | 'credential' | 'webhook';
export type Finding = {
  provider: string; kind: Kind; file: string; line: number; class?: Classification;
  op?: string; method?: string; url?: string; name?: string; note: string; adopted?: boolean;
};
export type ImportEdit = { file: string; start: number; end: number; provider: string; from: string; to: string; ok: boolean };
export type Manifest = { file: string; deps: Record<string, string[]> };
export type Scan = { root: string; files: string[]; findings: Finding[]; edits: ImportEdit[]; manifests: Manifest[]; envExamples: string[] };

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.svelte-kit', 'vendor', '.venv', 'venv', '__pycache__', 'coverage', '.turbo']);
const JS = /\.(?:[cm]?[jt]sx?)$/;
const OTHER = /\.(?:py|rb|go|php|java|kt|rs|cs|ex|exs|swift)$/;
const DEPFILE = /^(?:requirements.*\.txt|pyproject\.toml|Pipfile|setup\.py|setup\.cfg|go\.mod|Gemfile|composer\.json|Cargo\.toml)$/;
const CONFIG = /(?:\.ya?ml|\.toml|^Dockerfile.*)$/;
const DEP_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const RANK: Record<Classification, number> = { drop_in: 0, native: 1, unsupported: 2 };

export const isExampleEnv = (file: string) => /^(?:\.env(?:\.[\w-]+)*\.(?:example|sample|template|dist|defaults)|(?:example|sample)\.env)$/.test(basename(file));
/** Files that may hold secret values. They are never opened. */
export const isSecretEnv = (file: string) => !isExampleEnv(file) && /^\.env|\.env$/.test(basename(file));

function listFiles(root: string): string[] {
  let files: string[];
  try {
    files = execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean);
  } catch {
    files = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
        const path = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.isDirectory() && !SKIP.has(entry.name)) walk(path);
        else if (entry.isFile()) files.push(path);
      }
    };
    walk('');
  }
  return files.filter(file => !file.split('/').some(part => SKIP.has(part))).sort();
}

const matches = (pattern: string, spec: string) => pattern.endsWith('*') ? spec.startsWith(pattern.slice(0, -1)) : spec === pattern || spec.startsWith(`${pattern}/`);
function packageProvider(spec: string): { provider: Provider; adopted: boolean; root: boolean } | null {
  for (const provider of PROVIDERS) {
    if (provider.adapter?.package === spec) return { provider, adopted: true, root: true };
    const pattern = provider.packages.find(p => matches(p, spec));
    if (pattern) return { provider, adopted: false, root: spec === pattern };
  }
  return null;
}

function lineAt(text: string, index: number) { let line = 1; for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++; return line; }

function hostMatch(value: string): { provider: Provider; host: string; path: string } | null {
  for (const provider of PROVIDERS) {
    for (const host of provider.hosts) {
      const match = new RegExp(`(?:^|(https?:)?//)${host.replace(/\./g, '\\.')}(?::\\d+)?(?=[/?#]|$)`).exec(value);
      if (match) {
        const rest = value.slice(match.index + match[0].length);
        return { provider, host: `${match[1] ?? 'https:'}//${host}`, path: rest.split(/[?#]/)[0] ?? '' };
      }
    }
    const path = provider.paths?.find(p => value.includes(p));
    if (path) return { provider, host: '', path: value.slice(value.indexOf(path)).split(/[?#]/)[0]! };
  }
  return null;
}
const displayURL = (host: string, path: string) => host + path;

function classifyRoute(provider: Provider, host: string, path: string, method: string | undefined): Outcome & { via?: string } {
  if (provider.blocked) return { class: 'unsupported', note: provider.blocked };
  const route = provider.routes.find(r => (!r.host || host.endsWith(`//${r.host}`))
    && new RegExp(`^${r.path.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{\}/g, '[^/]+')}$`).test(path)
    && (r.methods === '*' || !method || r.methods.split('|').includes(method)));
  if (!route) return provider.rawFallback;
  const note = method ? route.note : `${route.note} (HTTP method not statically known.)`;
  return { class: route.class, note, via: route.via };
}

const constructorNote = (provider: Provider) => `Add \`chert: {baseURL: process.env.CHERT_BASE_URL, apiKey: process.env.CHERT_API_KEY}\` to the constructor (required by ${provider.adapter!.package}); keep maxRetries 0 or omitted. Vendor credentials are unused.`;

type ImportRec = { provider: Provider; finding: Finding; edit?: ImportEdit; usages: Finding[]; blocked?: string };
type Binding = { rec: ImportRec; kind: 'default' | 'ns' | 'cjs' | string };

function scanJs(file: string, text: string, out: Finding[], edits: ImportEdit[]) {
  const kind = file.endsWith('x') ? (file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.JSX) : /\.[cm]?ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const line = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const local: Finding[] = [];
  const recs: ImportRec[] = [];
  const bindings = new Map<string, Binding>();
  const clients = new Map<string, ImportRec>();
  const consts = new Map<string, string>();
  const specifiers = new Set<ts.Node>();

  const resolve = (node: ts.Node): string | null => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isTemplateExpression(node)) {
      return node.head.text + node.templateSpans.map(span => (ts.isIdentifier(span.expression) && consts.get(span.expression.text)) || '{}').map((value, i) => value + node.templateSpans[i]!.literal.text).join('');
    }
    return null;
  };

  const addImport = (spec: ts.StringLiteralLike, node: ts.Node) => {
    const match = packageProvider(spec.text);
    if (!match) return null;
    specifiers.add(spec);
    const { provider, adopted, root } = match;
    const finding: Finding = { provider: provider.id, kind: 'import', file, line: line(node), name: spec.text, note: '', adopted };
    const rec: ImportRec = { provider, finding, usages: [] };
    if (provider.adapter?.kind === 'sdk' && !adopted && root) {
      rec.edit = { file, start: spec.getStart(sf) + 1, end: spec.getEnd() - 1, provider: provider.id, from: spec.text, to: provider.adapter.package, ok: false };
    }
    if (!root && !adopted) finding.note = `Subpath import stays on ${spec.text}; keep the vendor package installed.`;
    recs.push(rec); local.push(finding);
    return rec;
  };
  const bindNamed = (rec: ImportRec, imported: string, name: string) => {
    bindings.set(name, { rec, kind: imported });
    const adapter = rec.provider.adapter;
    if (adapter?.kind === 'sdk' && rec.provider.upstreamClients?.includes(imported) && !adapter.namedClients?.includes(imported)) {
      rec.blocked = `Named export \`${imported}\` resolves to the original vendor client through ${adapter.package}'s re-exports; use the default import.`;
    }
  };
  const clientKey = (node: ts.Node): string | null => {
    const parent = node.parent;
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
    if (ts.isPropertyDeclaration(parent) && ts.isIdentifier(parent.name)) return `this.${parent.name.text}`;
    if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      if (ts.isIdentifier(parent.left)) return parent.left.text;
      if (ts.isPropertyAccessExpression(parent.left) && parent.left.expression.kind === ts.SyntaxKind.ThisKeyword) return `this.${parent.left.name.text}`;
    }
    return null;
  };
  const chain = (node: ts.Expression): string[] | null => {
    if (ts.isIdentifier(node)) return [node.text];
    if (node.kind === ts.SyntaxKind.ThisKeyword) return ['this'];
    if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) return chain(node.expression);
    if (ts.isPropertyAccessExpression(node)) { const head = chain(node.expression); return head && [...head, node.name.text]; }
    return null;
  };

  const first = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const rec = addImport(node.moduleSpecifier, node);
      if (rec && ts.isImportDeclaration(node) && node.importClause) {
        const clause = node.importClause;
        if (clause.name) bindings.set(clause.name.text, { rec, kind: 'default' });
        if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) bindings.set(clause.namedBindings.name.text, { rec, kind: 'ns' });
        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) bindNamed(rec, (element.propertyName ?? element.name).text, element.name.text);
        }
      }
    } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0]!)
      && ((ts.isIdentifier(node.expression) && node.expression.text === 'require') || node.expression.kind === ts.SyntaxKind.ImportKeyword)) {
      const rec = addImport(node.arguments[0] as ts.StringLiteralLike, node);
      const required = node.expression.kind !== ts.SyntaxKind.ImportKeyword;
      let target: ts.Node = ts.isAwaitExpression(node.parent) ? node.parent : node;
      let kind: string = required ? 'cjs' : 'ns';
      if (ts.isPropertyAccessExpression(target.parent) && target.parent.expression === target) { kind = target.parent.name.text; target = target.parent; }
      const declaration = target.parent;
      if (rec && ts.isVariableDeclaration(declaration)) {
        if (ts.isIdentifier(declaration.name)) {
          if (kind === 'cjs' || kind === 'ns' || kind === 'default') bindings.set(declaration.name.text, { rec, kind });
          else bindNamed(rec, kind, declaration.name.text);
        } else if (ts.isObjectBindingPattern(declaration.name)) {
          for (const element of declaration.name.elements) {
            const imported = element.propertyName && ts.isIdentifier(element.propertyName) ? element.propertyName.text : ts.isIdentifier(element.name) ? element.name.text : null;
            if (imported && ts.isIdentifier(element.name)) imported === 'default' ? bindings.set(element.name.text, { rec, kind: 'default' }) : bindNamed(rec, imported, element.name.text);
          }
        }
      }
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.getCombinedNodeFlags(node) & ts.NodeFlags.Const) {
      const value = resolve(node.initializer);
      if (value !== null) consts.set(node.name.text, value);
    } else if (ts.isNewExpression(node)) {
      let binding: Binding | undefined, member: string | undefined;
      if (ts.isIdentifier(node.expression)) binding = bindings.get(node.expression.text);
      else if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
        binding = bindings.get(node.expression.expression.text); member = node.expression.name.text;
      }
      const provider = binding?.rec.provider;
      if (binding && provider?.adapter?.kind === 'sdk') {
        const adapter = provider.adapter;
        const name = member ?? binding.kind;
        const viaNamespace = member !== undefined && (binding.kind === 'ns' || binding.kind === 'cjs');
        const isClient = viaNamespace ? name === 'default' || provider.upstreamClients?.includes(name) || adapter.namedClients?.includes(name)
          : member === undefined && (name === 'default' || name === 'cjs' || provider.upstreamClients?.includes(name));
        if (isClient) {
          let outcome: Outcome = { class: 'drop_in', note: constructorNote(provider) };
          if (!member && binding.kind === 'cjs') outcome = { class: 'unsupported', note: `${adapter.package} is ESM-only: require() returns its module namespace, so \`new X()\` breaks. Use an ESM import or require(...).default.` };
          else if (name !== 'default' && name !== 'cjs' && !adapter.namedClients?.includes(name)) outcome = { class: 'unsupported', note: `\`${name}\` resolves to the original vendor client through ${adapter.package}'s re-exports; use the default export.` };
          const finding: Finding = { provider: provider.id, kind: 'constructor', file, line: line(node), op: `new ${node.expression.getText(sf)}`, ...outcome };
          binding.rec.usages.push(finding); local.push(finding);
          const key = clientKey(node.parent && ts.isAwaitExpression(node.parent) ? node.parent : node);
          if (key) clients.set(key, binding.rec);
        }
      }
    }
    ts.forEachChild(node, first);
  };
  first(sf);

  const second = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const names = chain(node.expression);
      if (names) {
        for (const size of [2, 1]) {
          const rec = clients.get(names.slice(0, size).join('.'));
          if (!rec || names.length <= size) continue;
          const op = names.slice(size).join('.');
          const provider = rec.provider;
          const outcome: Outcome = provider.methods.find(m => m.op === op) ?? provider.methodFallback ?? provider.rawFallback;
          const finding: Finding = { provider: provider.id, kind: 'call', file, line: line(node), op, class: outcome.class, note: outcome.note };
          rec.usages.push(finding); local.push(finding);
          break;
        }
      }
      const route = node.arguments[0];
      const method = node.expression.name.text.toLowerCase();
      if (route && ts.isStringLiteralLike(route) && route.text.startsWith('/') && ['post', 'put', 'all', 'use', 'route'].includes(method)) {
        const path = route.text.toLowerCase();
        for (const provider of PROVIDERS) {
          if (provider.webhook.keywords.some(k => path.includes(k))) {
            local.push({ provider: provider.id, kind: 'webhook', file, line: line(node), op: `${method.toUpperCase()} ${route.text}`, class: provider.webhook.class, note: provider.webhook.note });
          }
        }
      }
    }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) && !specifiers.has(node)) {
      const value = resolve(node);
      const hit = value && hostMatch(value);
      if (hit) {
        const call = node.parent && (ts.isCallExpression(node.parent) || ts.isNewExpression(node.parent)) && node.parent.arguments?.[0] === node ? node.parent : null;
        let method: string | undefined;
        if (call) {
          const callee = call.expression;
          const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
          if (['get', 'post', 'put', 'patch', 'delete', 'head'].includes(name)) method = name.toUpperCase();
          else if (name === 'fetch' || name === 'Request' || name === 'ofetch' || name === '$fetch') {
            const init = call.arguments?.[1];
            if (!init) method = 'GET';
            else if (ts.isObjectLiteralExpression(init)) {
              const property = init.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(sf) === 'method') as ts.PropertyAssignment | undefined;
              if (!property) method = init.properties.some(ts.isSpreadAssignment) ? undefined : 'GET';
              else if (ts.isStringLiteralLike(property.initializer)) method = property.initializer.text.toUpperCase();
            }
          }
        }
        const url = displayURL(hit.host, hit.path);
        const outcome = classifyRoute(hit.provider, hit.host, hit.path, method);
        const unmatched = outcome === hit.provider.rawFallback;
        if (!call && (unmatched || hit.provider.blocked)) {
          local.push({ provider: hit.provider.id, kind: 'base_url', file, line: line(node), url, note: hit.provider.blocked ?? 'Provider API base URL; Chert adapters ignore vendor base URLs.' });
        } else {
          const via = outcome.via ?? (hit.provider.adapter?.kind === 'fetch' ? `${hit.provider.adapter.factory}({chert})` : undefined);
          local.push({ provider: hit.provider.id, kind: 'http', file, line: line(node), method, url, class: outcome.class,
            note: outcome.class === 'drop_in' && via ? `${outcome.note} Route this request through \`${via}\` from ${hit.provider.adapter!.package}.` : outcome.note });
        }
      }
    }
    ts.forEachChild(node, second);
  };
  second(sf);

  for (const provider of PROVIDERS) {
    const fields = provider.webhook.fields;
    const path = file.toLowerCase();
    const webhookFile = path.includes('webhook') && provider.webhook.keywords.some(k => path.includes(k));
    if (webhookFile && !local.some(f => f.provider === provider.id && f.kind === 'webhook')) {
      local.push({ provider: provider.id, kind: 'webhook', file, line: 1, op: 'webhook handler file', class: provider.webhook.class, note: provider.webhook.note });
    }
    if (!fields || !(webhookFile || local.some(f => f.provider === provider.id))) continue;
    const seen = new Set<string>();
    const visit = (node: ts.Node): void => {
      const name = ts.isPropertyAccessExpression(node) ? node.name.text
        : ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : null;
      const cls = name && Object.hasOwn(fields, name) ? fields[name] : undefined;
      if (name && cls && !seen.has(`${name}:${line(node)}`)) {
        seen.add(`${name}:${line(node)}`);
        local.push({ provider: provider.id, kind: 'webhook', file, line: line(node), op: `payload.${name}`, class: cls,
          note: cls === 'drop_in' ? 'Supplied by unwrapChert for inbound plaintext.' : 'Not supplied by unwrapChert; Chert inbound events omit this field.' });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  for (const rec of recs) {
    const { finding, provider } = rec;
    if (provider.blocked) Object.assign(finding, { class: 'unsupported', note: provider.blocked });
    else if (finding.adopted) Object.assign(finding, { class: 'drop_in', note: 'Already on the Chert adapter.' });
    else if (rec.edit) {
      const worst = rec.blocked ? 'unsupported' : rec.usages.reduce<Classification>((w, u) => u.class && RANK[u.class] > RANK[w] ? u.class : w, 'drop_in');
      rec.edit.ok = worst === 'drop_in';
      if (rec.edit.ok) finding.op = `${rec.edit.from} -> ${rec.edit.to}`;
      finding.class = worst;
      finding.note = rec.blocked ?? (rec.edit.ok
        ? `Swap to ${provider.adapter!.package}${rec.usages.length ? '' : ' (no client calls resolved statically; review usages)'}.`
        : `Kept on ${finding.name}: usages through this import are not all drop-in (see below).`);
      edits.push(rec.edit);
    } else if (!finding.note) finding.note = provider.adapter?.kind === 'fetch' ? `Import ${provider.adapter.factory} from ${provider.adapter.package}.` : 'Detected.';
  }
  out.push(...local);
}

function scanText(file: string, text: string, out: Finding[]) {
  for (const provider of PROVIDERS) {
    const needles = [...provider.hosts, ...(provider.paths ?? [])];
    for (const needle of needles) {
      const pattern = new RegExp(`(?:https?://)?${needle.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&')}[^\\s'"\`)<>]*`, 'g');
      for (const match of text.matchAll(pattern)) {
        const hit = hostMatch(match[0]);
        if (!hit || hit.provider !== provider) continue;
        out.push({ provider: provider.id, kind: 'base_url', file, line: lineAt(text, match.index!), url: displayURL(hit.host, hit.path), note: provider.blocked ?? 'Detection only: no rewrites outside JavaScript/TypeScript.' });
      }
    }
  }
}

function scanDeps(file: string, text: string, out: Finding[]) {
  text.split('\n').forEach((content, index) => {
    for (const provider of PROVIDERS) {
      const name = provider.otherPackages?.find(p => new RegExp(`(?:^|[\\s"'\\[/=])${p}(?:$|[\\s"'\\]=<>~!;,@/-])`, 'i').test(content));
      if (name) out.push({ provider: provider.id, kind: 'dependency', file, line: index + 1, name, note: provider.blocked ?? 'Detection only: no drop-in package for this language.' });
    }
  });
}

const ENV = new RegExp(`\\b(?:${PROVIDERS.flatMap(p => p.env).join('|')})[A-Z0-9_]+\\b`, 'g');
function scanEnv(file: string, text: string, out: Finding[], example: boolean) {
  const seen = new Set<string>();
  const source = example ? text.split('\n').map(l => /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/.exec(l)?.[1] ?? '').join('\n') : text;
  for (const match of source.matchAll(ENV)) {
    if (seen.has(match[0])) continue;
    seen.add(match[0]);
    const owners = PROVIDERS.filter(p => p.env.some(prefix => match[0].startsWith(prefix)));
    for (const provider of owners) out.push({ provider: provider.id, kind: 'env', file, line: lineAt(source, match.index!), name: match[0], note: 'Vendor credential/config name; Chert uses CHERT_* names. Values are never read.' });
  }
}

function scanKeys(file: string, text: string, out: Finding[]) {
  for (const provider of PROVIDERS) {
    for (const prefix of provider.keyPrefixes ?? []) {
      const at = text.search(new RegExp(`(?<![A-Za-z0-9_])${prefix}[A-Za-z0-9]`));
      if (at >= 0) out.push({ provider: provider.id, kind: 'credential', file, line: lineAt(text, at), name: `${prefix}…`,
        note: 'Hardcoded vendor key literal (value not shown). Remove it from source; Chert does not use vendor keys.' });
    }
  }
}

export function scan(root: string, from = 'auto'): Scan {
  const files = listFiles(root);
  const findings: Finding[] = [], edits: ImportEdit[] = [], manifests: Manifest[] = [], envExamples: string[] = [];
  for (const file of files) {
    const name = basename(file);
    if (isSecretEnv(file)) continue;
    const full = join(root, file);
    let size: number;
    try { size = statSync(full).size; } catch { continue; }
    if (size > 2_000_000) continue;
    const scanned = JS.test(file) || OTHER.test(file) || DEPFILE.test(name) || CONFIG.test(name) || name === 'package.json' || isExampleEnv(file);
    if (!scanned) continue;
    const text = readFileSync(full, 'utf8');
    if (isExampleEnv(file)) { envExamples.push(file); scanEnv(file, text, findings, true); continue; }
    if (name === 'package.json') {
      let json: Record<string, unknown>;
      try { json = JSON.parse(text); } catch { continue; }
      const manifest: Manifest = { file, deps: {} };
      for (const section of DEP_SECTIONS) {
        const deps = json[section];
        if (!deps || typeof deps !== 'object') continue;
        manifest.deps[section] = Object.keys(deps);
        for (const dep of Object.keys(deps)) {
          const match = packageProvider(dep);
          if (match) findings.push({ provider: match.provider.id, kind: 'dependency', file, line: lineAt(text, text.indexOf(`"${dep}"`)), name: dep, adopted: match.adopted,
            note: match.provider.blocked ?? (match.adopted ? 'Chert adapter dependency.' : `Replace with ${match.provider.adapter?.package} where all imports are drop-in.`) });
        }
      }
      manifests.push(manifest);
      continue;
    }
    if (JS.test(file)) scanJs(file, text, findings, edits);
    else if (OTHER.test(file)) scanText(file, text, findings);
    if (DEPFILE.test(name)) scanDeps(file, text, findings);
    scanEnv(file, text, findings, false);
    scanKeys(file, text, findings);
  }
  const evidence = new Set(findings.filter(f => f.kind !== 'env').map(f => f.provider));
  let result = findings.filter(f => {
    if (f.kind !== 'env') return true;
    const owners = PROVIDERS.filter(p => p.env.some(prefix => f.name!.startsWith(prefix))).map(p => p.id);
    const proven = owners.filter(id => evidence.has(id));
    return proven.length ? proven.includes(f.provider) : owners[0] === f.provider;
  });
  let resultEdits = edits;
  if (from !== 'auto') { result = result.filter(f => f.provider === from); resultEdits = edits.filter(e => e.provider === from); }
  result.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.kind.localeCompare(b.kind));
  return { root, files, findings: result, edits: resultEdits, manifests, envExamples };
}

/** The deepest package.json directory containing `file`, or null. */
export function ownerManifest(manifests: Manifest[], file: string): Manifest | null {
  let best: Manifest | null = null;
  for (const manifest of manifests) {
    const dir = dirname(manifest.file);
    const inside = dir === '.' || file.startsWith(`${dir}/`);
    if (inside && (!best || dir.length > dirname(best.file).length)) best = manifest;
  }
  return best;
}
