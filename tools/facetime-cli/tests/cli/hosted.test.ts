import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configSchema } from '../../src/cli/config.js';
test('hosted enrollment configuration accepts encrypted origins without activating',()=>{
 const parsed=configSchema.safeParse({schema_version:1,agent:{name:'test',deployment:'test',boot:'test'},livekit:{url:'wss://test.example',key_env:'KEY',secret_env:'SECRET'},hook:{origin:'http://127.0.0.1:7777',secret_env:'HOOK'},state_dir:'/tmp/chert-isolated-test',transport:{mode:'hosted-v1',control_origin:'https://control.example',relay_origin:'https://relay.example',reconcile_origin:'https://relay.example',scope:{project_id:'project',line_id:'line',binding_id:'binding',binding_epoch:1,instance_id:'instance',connection_generation:0},credential_env:'CHERT_CONNECTOR_TOKEN',recovery_env:'CHERT_RECOVERY_TOKEN'}});
 assert.equal(parsed.success,true);
});

import { inspectHosted } from '../../src/cli/backend.js';
const hostedConfig=configSchema.parse({schema_version:1,agent:{name:'test',deployment:'test',boot:'test'},livekit:{url:'wss://test.example',key_env:'KEY',secret_env:'SECRET'},hook:{origin:'http://127.0.0.1:7777',secret_env:'HOOK'},state_dir:'/tmp/chert-isolated-test',transport:{mode:'hosted-v1',control_origin:'https://control.example',relay_origin:'https://relay.example',reconcile_origin:'https://relay.example',scope:{project_id:'project',line_id:'line',binding_id:'binding',binding_epoch:1,instance_id:'instance',connection_generation:0},credential_env:'CHERT_CONNECTOR_TOKEN',recovery_env:'CHERT_RECOVERY_TOKEN'}});
for(const [status,expected] of [[403,'unauthorized'],[503,'unavailable']] as const) test(`hosted diagnostics distinguish HTTP ${status}`,async()=>{
 const previous=globalThis.fetch;globalThis.fetch=async()=>new Response('{}',{status});
 try {assert.deepEqual(await inspectHosted(hostedConfig,{}),{status:expected});} finally {globalThis.fetch=previous;}
});
test('hosted diagnostics reject a credential bound to another scope',async()=>{
 const previous=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({scope:{project_id:'foreign',line_id:'line',binding_id:'binding',binding_epoch:1,instance_id:'instance',connection_generation:9},state:'active',connected:true,recovery_only:false});
 try {assert.deepEqual(await inspectHosted(hostedConfig,{}),{status:'binding_mismatch'});} finally {globalThis.fetch=previous;}
});
test('hosted configuration rejects plaintext signaling',()=>{
 assert.equal(configSchema.safeParse({...hostedConfig,transport:{...hostedConfig.transport,relay_origin:'http://127.0.0.1:7777'}}).success,false);
});
