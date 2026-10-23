import os,pathlib,subprocess,json
base=pathlib.Path('/state/chert-pilot');assert os.getuid()==0
for p in pathlib.Path('/proc').glob('[0-9]*/cmdline'):
 args=p.read_bytes().split(bytes([0]))[1:]
 assert not any(a.endswith(b'/qualification/owner.py') or a.endswith(b'/runtime/node.mjs') or a.endswith(b'/qualification/entry.py') for a in args)
assert not json.loads((base/'application/provider.json').read_text())['rooms']
base.rename('/state/archived-case-1')
subprocess.run(['/usr/local/bin/python','/qualification/entry.py','provision'],check=True)
p=pathlib.Path('/bootstrap');p.mkdir(mode=0o700,exist_ok=True);os.chown(p,10001,10001)
subprocess.run(['/usr/local/bin/python','/qualification/entry.py','seed'],check=True)
def user():os.setgroups([]);os.setgid(10001);os.setuid(10001)
subprocess.run(['/usr/local/bin/python','/qualification/entry.py','initialize'],preexec_fn=user,check=True)
print(json.dumps({'case_1_archived':True,'original_crash_lock_retained':pathlib.Path('/state/archived-case-1/connector/journal.json.lock').is_file(),'fresh_case_2_initialized':True}))
