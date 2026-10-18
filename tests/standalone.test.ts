import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { validateIntegrationRoot } from '../scripts/test-integration';
test('integration refuses missing or relative monorepo roots before any staging', () => {
 expect(() => validateIntegrationRoot(undefined)).toThrow('CHERT_MONOREPO_ROOT');
 expect(() => validateIntegrationRoot('../chert-facetime')).toThrow('absolute');
});
test('integration refuses an unrelated source tree', () => {
 const root = mkdtempSync(resolve(tmpdir(),'chert-sdk-invalid-root-'));
 try { expect(() => validateIntegrationRoot(root)).toThrow(); } finally { rmSync(root,{recursive:true}); }
});
test('integration CLI never forwards live flags', () => {
 const result = Bun.spawnSync([process.execPath,'--no-env-file','scripts/test-integration.ts','--live-one-png'], {cwd:resolve(import.meta.dir,'..'),env:{PATH:process.env.PATH??'/usr/bin:/bin'}});
 expect(result.exitCode).toBe(1); expect(result.stdout.toString()).toBe('');
});

test('integration refuses structurally valid but different server source', () => {
 const root = mkdtempSync(resolve(tmpdir(),'chert-sdk-mismatch-root-'));
 try {
  for (const dir of ['imessage-server/app','imessage-server/lib','imessage-server/mac-server/src','imessage-server/docs/migrations','imessage-server/tests','control-plane/supabase','scripts']) mkdirSync(resolve(root,dir),{recursive:true});
  for (const file of ['imessage-server/package.json','imessage-server/bun.lock','control-plane/bun.lock','imessage-server/mac-server/Makefile','control-plane/package.json','scripts/test-webhook-postgrest.sh','scripts/test-attachment-native-postgrest.sh','scripts/test-attachment-postgrest.sh']) writeFileSync(resolve(root,file),'different source');
  expect(() => validateIntegrationRoot(root)).toThrow('differs from the reviewed');
 } finally { rmSync(root,{recursive:true}); }
});
