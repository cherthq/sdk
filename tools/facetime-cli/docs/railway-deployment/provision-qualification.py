import os,subprocess,json,pathlib
assert os.getuid()==0
for k,v in {'LIVEKIT_URL':'wss://isolated.invalid','LIVEKIT_API_KEY':'synthetic-key','LIVEKIT_API_SECRET':'synthetic-provider','CHERT_CONNECTION_TOKEN':'synthetic-connection','CHERT_RECOVERY_TOKEN':'synthetic-recovery'}.items():assert os.environ[k]==v
print(json.dumps({'uid':os.getuid(),'mount':[l for l in pathlib.Path('/proc/self/mountinfo').read_text().splitlines() if l.split()[4]=='/state'],'volume_id':os.environ['PILOT_VOLUME_ID']}))
subprocess.run(['python','/qualification/entry.py','provision'],check=True)
pathlib.Path('/bootstrap').mkdir(mode=0o700)
os.chown('/bootstrap',10001,10001)
subprocess.run(['python','/qualification/entry.py','seed'],check=True)
def user():os.setgid(10001);os.setuid(10001)
subprocess.run(['python','/qualification/entry.py','initialize'],preexec_fn=user,check=True)
print('qualification_initialized_without_provider_allocation')
