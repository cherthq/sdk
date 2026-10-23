assert eventually(lambda:health()['healthy']);assert provider()['creates']==0
p=BASE/'application/control.json';p.write_text('{"hold":true}');p.chmod(0o600);os.chown(p,10001,10001)
s=socket.socket(socket.AF_UNIX);s.connect(str(BASE/'ipc/admin.sock'));s.sendall(b'{"method":"stage","args":{"slot_id":"uncertain"}}\n');s.close()
assert eventually(lambda:provider()['creates']==1)
first=pid('owner');os.kill(first,9)
assert eventually(lambda:pid('owner')!=first and rpc('health')['ok'])
slots=rpc('status',admin=True)['result']['slots'];assert next(s for s in slots if s['slot_id']=='uncertain')['state']=='uncertain'
assert provider()['creates']==1 and provider()['deletes']==0
owner=pid('owner');os.kill(pid('node'),15)
assert eventually(lambda:not (BASE/'connector/journal.json.lock').exists())
p=BASE/'connector/journal.json';p.rename(p.with_suffix('.preserved'))
assert eventually(lambda:health()['processes']['node']=='state_review_required')
time.sleep(5.5);assert not p.exists();assert pid('owner')==owner and rpc('health')['ok']
r=subprocess.run(['/usr/local/bin/python','/qualification/entry.py','run'],env={**os.environ,'PATH':'/usr/local/bin:/usr/bin:/bin'},preexec_fn=as_user,capture_output=True,timeout=10);assert r.returncode!=0
print(json.dumps({'interrupted_preparation_stays_uncertain':True,'no_repeat_create_or_guessed_cleanup':True,'missing_journal_refuses_child_restart':True,'missing_journal_refuses_startup':True,'owner_continues':True,'creates':provider()['creates'],'deletes':provider()['deletes'],'health':health()}))
