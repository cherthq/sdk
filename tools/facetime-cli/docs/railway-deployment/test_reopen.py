assert eventually(lambda:health()['healthy'])
call=json.loads((BASE/'qualification-call.json').read_text())
assert rpc('recover',{'call':call,'context':{}})['result']['cleanup']=='pending'
assert provider()['creates']==1
print(json.dumps({'claimed_session_preserved':True,'creates':provider()['creates'],'pids':{r:pid(r) for r in ['node','owner']},'health':health()}))
