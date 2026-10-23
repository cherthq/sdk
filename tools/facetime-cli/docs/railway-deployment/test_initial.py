assert eventually(lambda:health()['healthy'])
for _ in range(4):assert health()['mode']=='standby'
assert provider()['creates']==provider()['dispatches']==0
for role in ['node','owner']:
 n=pid(role); assert pathlib.Path('/proc/'+str(n)).stat().st_uid==10001
 code="import pathlib; env=pathlib.Path('/proc/"+str(n)+"/environ').read_bytes().split(bytes([0])); assert "+("not any(e.startswith(b'LIVEKIT_API_') for e in env)" if role=='node' else "not any(e.startswith(b'CHERT_CONNECTION_TOKEN=') or e.startswith(b'CHERT_RECOVERY_TOKEN=') for e in env)")
 subprocess.run(['/usr/local/bin/python','-c',code],preexec_fn=as_user,check=True)
for path in [BASE,BASE/'application',BASE/'connector',BASE/'ipc']:
 assert path.stat().st_uid==10001 and path.stat().st_mode & 0o077==0
for path in (BASE/'ipc').glob('*.sock'):assert path.stat().st_mode & 0o077==0
r=subprocess.run(['python','/qualification/entry.py','run'],preexec_fn=as_user,capture_output=True,timeout=10);assert r.returncode!=0
assert health()['healthy']
assert rpc('stage',{'slot_id':'persist'},True)['ok']
call=claim();p=BASE/'qualification-call.json';p.write_text(json.dumps(call));p.chmod(0o600)
print(json.dumps({'empty_standby_zero_allocations':True,'nonroot_children':True,'environment_separation':True,'private_paths_sockets':True,'single_writer_exclusion':True,'claim_saved':True,'creates':provider()['creates'],'pids':{r:pid(r) for r in ['node','owner']},'health':health()}))
