import sys,pathlib
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'.local/railway-deployment'))
from remote import remote
p=pathlib.Path(__file__).parent
r=remote((p/'remote_common.py').read_text()+(p/sys.argv[1]).read_text(),timeout=90)
out=p/sys.argv[2];assert not out.exists();out.write_text(r.stdout+r.stderr)
print(r.stdout,end='');print(r.stderr,end='',file=sys.stderr);sys.exit(r.returncode)
