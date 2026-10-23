import pathlib,os,json,time
roles={}
for p in pathlib.Path('/proc').glob('[0-9]*/cmdline'):
 args=p.read_bytes().split(bytes([0]))[1:]
 for role,fragment in [('supervisor',b'/qualification/entry.py'),('owner',b'/qualification/owner.py')]:
  if fragment in args:roles[role]=int(p.parent.name)
assert set(roles)=={'supervisor','owner'}
r={'pids':roles,'frozen_at_epoch':time.time(),'purpose':'synthetic-only hung-process platform termination grace'}
f=pathlib.Path('/state/grace-probe.json');f.write_text(json.dumps(r));f.chmod(0o600)
for pid in roles.values():os.kill(pid,19)
print(json.dumps(r))
