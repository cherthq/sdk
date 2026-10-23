# Preserve a new claimed session across Python failure before testing uncertainty.
assert rpc('stage',{'slot_id':'python-reopen'},True)['ok']
call=claim('python-reopen');first=pid('owner');os.kill(first,9)
assert eventually(lambda:pid('owner')!=first and health()['healthy'])
assert rpc('recover',{'call':call,'context':{}})['result']['cleanup']=='pending'
assert rpc('lifecycle',{'call':call,'event':{'event_id':'python-end','transition':'ended'},'context':{}})['ok']
assert eventually(lambda:not provider()['rooms'])
# Keep the original app lifetime, but use the reviewed short-lease substitute for expiry.
first=pid('node');os.kill(first,9)
assert eventually(lambda:health()['processes']['node']=='crash_lock_review_required')
lock=BASE/'connector/journal.json.lock';assert lock.is_file();original_lock=lock.read_bytes()
p=BASE/'application/short-ttl';p.touch(mode=0o600);os.chown(p,10001,10001)
first=pid('owner');os.kill(first,9)
assert eventually(lambda:pid('owner')!=first and rpc('health')['ok'])
assert rpc('stage',{'slot_id':'independent-expiry'},True)['ok']
claim('expiry')
assert eventually(lambda:not provider()['rooms'])
assert rpc('health')['ok'];assert lock.read_bytes()==original_lock
print(json.dumps({'python_claim_reopen':True,'node_sigkill_retains_lock':True,'unsafe_node_restart_refused':True,'independent_python_expiry_cleanup':True,'creates':provider()['creates'],'deletes':provider()['deletes'],'health':health()}),flush=True)
# A further Python crash must exhaust its three-start budget.
first=pid('owner');os.kill(first,9)
assert eventually(lambda:health()['processes']['owner']=='restart_budget_exhausted_or_fatal')
time.sleep(5.5)
assert health()['processes']['owner']=='restart_budget_exhausted_or_fatal'
print(json.dumps({'bounded_owner_restart_budget':True,'lock_preserved':lock.read_bytes()==original_lock}),flush=True)
