import requests, json
s=requests.Session()
s.post('http://127.0.0.1:5678/rest/login',json={'emailOrLdapLoginId':'admin@titiport.local','password':'titiport123'})
nid='nmS6ZNxBP88SM0dw'
r=s.get(f'http://127.0.0.1:5678/rest/executions?workflowId={nid}&limit=1').json()
ex=r.get('data',{}).get('results',[{}])[0]
print('exec id', ex.get('id'), 'status', ex.get('status'))
if ex.get('status')=='error':
    print('annotation', ex.get('annotation'))
    print('run data', json.dumps(ex, indent=2)[:1500])
