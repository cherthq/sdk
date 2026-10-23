import os,json,time,socket,pathlib,subprocess,urllib.request,urllib.error
BASE=pathlib.Path('/state/chert-pilot')
def rpc(method,args=None,admin=False):
 s=socket.socket(socket.AF_UNIX);s.settimeout(5);s.connect(str(BASE/'ipc'/('admin.sock' if admin else 'owner.sock')));s.sendall((json.dumps({'method':method,'args':args or {}})+'\n').encode());result=json.loads(s.makefile().readline());s.close();return result
def health():
 try:r=urllib.request.urlopen('http://127.0.0.1:8080/healthz',timeout=3)
 except urllib.error.HTTPError as e:r=e
 return json.load(r)
def provider():return json.loads((BASE/'application/provider.json').read_text())
def pid(role):
 fragment=b'/qualification/owner.py' if role=='owner' else b'/runtime/node.mjs'
 return next(int(p.parent.name) for p in pathlib.Path('/proc').glob('[0-9]*/cmdline') if any(a.endswith(fragment) for a in p.read_bytes().split(b'\0')[1:]))
def eventually(fn,timeout=20):
 deadline=time.monotonic()+timeout
 while time.monotonic()<deadline:
  try:
   if value:=fn():return value
  except (OSError,ValueError,StopIteration):pass
  time.sleep(.2)
 raise AssertionError('condition_timeout')
def claim(op='operation'):
 now=int(time.time()*1000);call={'operation_id':op,'project_id':'test','line_id':'line','call_id':op,'request_id':op,'deadline_at':now+5000,'prepare_deadline_at':now+4000,'maximum_session_expires_at':now+650000,'media':{'audio':True,'video':True}}
 assert rpc('prepare',{'call':call})['result']['action']=='accept'
 return call
def as_user():os.setgroups([]);os.setgid(10001);os.setuid(10001)
