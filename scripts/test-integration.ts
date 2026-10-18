import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
const sdk = resolve(import.meta.dir, '..');
const groups = ['imessage-server/app', 'imessage-server/lib', 'imessage-server/mac-server/src', 'imessage-server/docs/migrations', 'imessage-server/tests', 'control-plane/supabase'];
const runners = ['test-webhook-postgrest.sh', 'test-attachment-native-postgrest.sh', 'test-attachment-postgrest.sh'];
export function sourceDigest(root: string): string {
 const paths: string[] = [];
 function walk(relative: string) { const full = resolve(root, relative); if (!existsSync(full)) throw new Error('Integration source layout is incomplete'); const stat = lstatSync(full); if (stat.isSymbolicLink()) throw new Error('Integration source must not be symlinked'); if (stat.isDirectory()) { for (const entry of readdirSync(full).sort()) if (!['node_modules','.git','.next','dist','build','target'].includes(entry)) walk(`${relative}/${entry}`); } else if (stat.isFile()) paths.push(relative); }
 for (const group of groups) walk(group);
 for (const path of ['imessage-server/package.json', 'imessage-server/bun.lock', 'control-plane/bun.lock', 'imessage-server/mac-server/Makefile', 'control-plane/package.json', ...runners.map(r => `scripts/${r}`)]) walk(path);
 const hash = createHash('sha256'); for (const path of paths.sort()) hash.update(path).update('\0').update(readFileSync(resolve(root,path))).update('\0'); return hash.digest('hex');
}
export function validateIntegrationRoot(input: string | undefined): string {
 if (!input || !isAbsolute(input)) throw new Error('Set CHERT_MONOREPO_ROOT to an absolute reviewed chert-facetime checkout');
 const root = realpathSync(input); const lock = JSON.parse(readFileSync(resolve(import.meta.dir, 'test-integration-source.json'), 'utf8'));
 if (lock.version !== 1 || !/^[a-f0-9]{64}$/.test(lock.sha256) || sourceDigest(root) !== lock.sha256) throw new Error('Integration source differs from the reviewed source lock');
 for (const dir of ['control-plane/node_modules','imessage-server/node_modules']) if (!existsSync(resolve(root,dir))) throw new Error('Install the reviewed monorepo dependencies before integration');
 return root;
}
export function integrationEnvironment(source: Record<string, string | undefined>): Record<string,string> {
 const env: Record<string,string> = {PATH:source.PATH ?? '/usr/bin:/bin', NODE_ENV:'test'};
 for (const [key,value] of Object.entries(source)) if (value && (key === 'CHERT_PIPELINE_RUST_CLIENT' || key === 'CHERT_PIPELINE_CPP_CLIENT' || /^CHERT_TEST_(?:JOURNAL_PG_BIN|JOURNAL_POSTGREST|CPP_CLIENT|CPP_REACTION_CLIENT|CPP_TYPED_CLIENT|RUST_CLIENT|RUST_REACTION_CLIENT|RUST_TYPED_CLIENT|PYTHON|STORAGE_ENTRYPOINT|STORAGE_NODE|NATIVE_WEBHOOK_CLIENT|DEVICE_LIFECYCLE_BUNDLE|URL_MEDIA_PIXEL_MANIFEST)$/.test(key))) env[key]=value;
 return env;
}
if (import.meta.main) {
 let stage: string | undefined;
 try {
  if (process.argv.slice(2).some(arg => arg !== '--check') || process.argv.slice(2).length > 1) throw new Error('Only --check is supported; live modes are not forwarded');
  const root = validateIntegrationRoot(process.env.CHERT_MONOREPO_ROOT);
  if (process.argv.includes('--check')) { console.log('Reviewed integration source verified'); process.exit(0); }
  stage = mkdtempSync(resolve(tmpdir(), 'chert-sdk-integration-'));
  cpSync(sdk, resolve(stage,'sdk'), {recursive:true, filter: path => !['.git','node_modules','target','build','bin','obj','artifacts','__pycache__','.venv'].includes(path.split('/').at(-1)!) && !/^\.env(?:\.|$)/.test(path.split('/').at(-1)!)});
  symlinkSync(resolve(sdk,'node_modules'),resolve(stage,'sdk/node_modules'),'dir');
  for (const name of readdirSync(resolve(sdk,'packages'))) if (existsSync(resolve(sdk,'packages',name,'node_modules'))) symlinkSync(resolve(sdk,'packages',name,'node_modules'),resolve(stage,'sdk/packages',name,'node_modules'),'dir');
  for (const dir of ['imessage-server','control-plane','docs','Sources','Tests','native']) if (existsSync(resolve(root,dir))) symlinkSync(resolve(root,dir),resolve(stage,dir),'dir');
  mkdirSync(resolve(stage,'scripts'));
  for (const runner of runners) cpSync(resolve(root,'scripts',runner),resolve(stage,'scripts',runner),{recursive:false});
  const env = integrationEnvironment(process.env);
  const child = Bun.spawn([process.execPath,'--no-env-file','test','tests','scripts','packages/blooio-v4-adapter/tests/webhook-management-postgrest.test.ts'],{cwd:resolve(stage,'sdk'),env,stdout:'inherit',stderr:'inherit'});
  process.exitCode = await child.exited;
 } catch { console.error('Integration refused or failed: verify CHERT_MONOREPO_ROOT, source lock, dependencies and explicit tool paths.'); process.exitCode=1; }
 finally { if (stage) rmSync(stage,{recursive:true,force:true}); }
}
