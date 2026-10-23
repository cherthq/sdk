assert health()['healthy']
first=pid('node');owner=pid('owner');os.kill(first,15)
assert eventually(lambda:pid('node')!=first and health()['healthy'])
assert pid('owner')==owner
call=json.loads((BASE/'qualification-call.json').read_text())
assert rpc('lifecycle',{'call':call,'event':{'event_id':'end','transition':'ended'},'context':{}})['ok']
assert eventually(lambda:not provider()['rooms'])
assert provider()['deletes']==1
print(json.dumps({'graceful_node_restart':True,'owner_stayed_alive':True,'terminal_cleanup_verified':True,'creates':provider()['creates'],'deletes':provider()['deletes']}))
