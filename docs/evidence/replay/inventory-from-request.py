import json,sys,re
def inventory(path):
    lines=[json.loads(l) for l in open(path) if l.strip()]
    r=[l for l in lines if l['method']=='POST'][-1]; b=json.loads(r['body'])
    names=[]
    def walk(t,prefix=''):
        n=t.get('name'); ty=t.get('type')
        if ty=='namespace':
            for x in t.get('tools',[]): walk(x,(n or '')+'.')
        else:
            names.append(f"{prefix}{n} ({ty})")
            d=t.get('description','') or ''
            # nested tool names referenced by the exec orchestrator
            for m in re.findall(r'tools\.([A-Za-z0-9_]+)\(',d): names.append(f"  nested-ref: {m}")
    for it in b['input']:
        if it.get('type')=='additional_tools':
            for t in it['tools']: walk(t)
    for t in b.get('tools',[]): walk(t,'top.')
    return sorted(set(names))
for n in inventory(sys.argv[1]): print(n)
