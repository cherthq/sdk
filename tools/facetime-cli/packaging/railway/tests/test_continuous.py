import asyncio
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

runtime_path = Path(__file__).parents[1] / 'runtime.py'
if not runtime_path.exists():
    runtime_path = Path('/opt/chert-pilot/railway-20260930-r1/runtime/runtime.py')
spec = importlib.util.spec_from_file_location('runtime', runtime_path)
runtime = importlib.util.module_from_spec(spec); spec.loader.exec_module(runtime)

class ContinuousTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.base = Path(self.tmp.name)
        self.oldbase, self.oldnode = runtime.BASE, runtime.NODE
        runtime.BASE = self.base; runtime.NODE = self.base/'connector'; runtime.NODE.mkdir()
        self.scope = {'binding_id':'binding','project_id':'project','line_id':'line','instance_id':'instance','binding_epoch':1,'session_mode':'byor','connection_generation':0}
        self.write(runtime.NODE/'config.json',{'transport':{'scope':self.scope}})
        self.write(runtime.NODE/'journal.json',{'entries':{}})
        self.slots=[]; self.stages=[]; self.active=True; self.healthy=True
        async def rpc(method, args=None):
            if method=='status': return {'slots':self.slots}
            self.stages.append(args['slot_id']); self.slots.append({'slot_id':args['slot_id'],'state':'ready'})
            return {'state':'ready'}
        async def authority(): return self.active
        async def healthy(): return self.healthy
        self.c=runtime.ContinuousController(rpc,authority,healthy)
    async def asyncTearDown(self):
        runtime.BASE = self.oldbase; runtime.NODE=self.oldnode; self.tmp.cleanup()
    def write(self,p,v):
        p.write_text(json.dumps(v));p.chmod(0o600)
    def enable(self,enabled=True):
        self.write(self.base/'continuous-policy.json',{'enabled':enabled,'binding_id':'binding'})
    async def test_default_and_inactive_never_allocate(self):
        await self.c.step(); self.assertEqual(self.stages,[])
        self.enable(); self.active=False; await self.c.step(); self.assertEqual(self.stages,[])
        self.active=True;self.healthy=False;await self.c.step();self.assertEqual(self.stages,[])
    async def test_replaces_only_after_clean_and_cooldown(self):
        self.enable();await self.c.step();self.assertEqual(len(self.stages),1)
        await self.c.step();self.assertEqual(len(self.stages),1)
        self.slots[0]['state']='claimed';await self.c.step();self.assertEqual(len(self.stages),1)
        self.slots[0]['state']='clean';await self.c.step();self.assertEqual(len(self.stages),1)
        self.c.state['not_before']=0;await self.c.step();self.assertEqual(len(self.stages),2)
    async def test_restart_and_ambiguous_request_never_reissues(self):
        self.enable()
        async def ambiguous(method,args=None):
            if method=='status':return {'slots':[]}
            self.stages.append(args['slot_id']);raise TimeoutError()
        self.c.rpc=ambiguous
        await self.c.step();self.assertEqual(len(self.stages),1)
        reopened=runtime.ContinuousController(ambiguous,self.c.authority,self.c.healthy)
        await reopened.step();self.assertEqual(len(self.stages),1)
        self.assertEqual(reopened.status,'pending_slot_unobserved')
    async def test_disable_debt_and_foreign_policy_block(self):
        self.enable(False);await self.c.step();self.assertEqual(self.stages,[])
        self.enable();self.slots=[{'slot_id':'old','state':'uncertain'}];await self.c.step();self.assertEqual(self.stages,[])
        self.slots=[];self.write(runtime.NODE/'journal.json',{'entries':{'x':{'authoritative_terminal':False}}});await self.c.step();self.assertEqual(self.stages,[])
        self.write(runtime.NODE/'journal.json',{'entries':{}})
        self.write(self.base/'continuous-policy.json',{'enabled':True,'binding_id':'foreign'})
        with self.assertRaises(runtime.Refusal):await self.c.step()
    async def test_ready_slot_survives_controller_restart_without_new_stage(self):
        self.enable();await self.c.step()
        reopened=runtime.ContinuousController(self.c.rpc,self.c.authority,self.c.healthy)
        await reopened.step();self.assertEqual(len(self.stages),1)
        self.assertEqual(reopened.status,'ready')

    async def test_disable_during_authority_check_prevents_request(self):
        self.enable()
        async def disable():
            self.enable(False); return True
        self.c.authority=disable
        await self.c.step(); self.assertEqual(self.stages,[])

    async def test_failed_intent_persistence_never_sends(self):
        self.enable()
        def failed_save(): raise OSError('disk')
        self.c.save=failed_save
        with self.assertRaises(OSError):await self.c.step()
        self.assertEqual(self.stages,[])

    async def test_uncertain_request_blocks_even_after_restart(self):
        self.enable();await self.c.step();self.slots[0]['state']='uncertain'
        reopened=runtime.ContinuousController(self.c.rpc,self.c.authority,self.c.healthy)
        await reopened.step();self.assertEqual(len(self.stages),1)
        self.assertEqual(reopened.status,'uncertain')
