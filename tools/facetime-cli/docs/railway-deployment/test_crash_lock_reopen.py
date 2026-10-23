assert eventually(lambda:rpc('health')['ok'])
assert (BASE/'connector/journal.json.lock').is_file()
assert eventually(lambda:health()['processes']['node']=='crash_lock_review_required')
assert provider()['creates']==3 and provider()['deletes']==3 and not provider()['rooms']
print(json.dumps({'platform_restart_retained_node_lock':True,'node_restart_refused':True,'owner_reopened':True,'creates':provider()['creates'],'deletes':provider()['deletes'],'health':health()}))
