"""Compile read-only inventory metadata; never execute or connect to legacy apps."""
import json, sys, collections
from pathlib import Path
source=Path(sys.argv[1]) if len(sys.argv)>1 else Path('../work/registry_inventory.json')
raw=json.loads(source.read_text())
packages=[]
for registry in ['HF','CAD','EP']:
    fields=[f for f in raw['fields'] if f['registry']==registry]
    excluded={'Identity','Attribution','Demographics','Contact','Legacy only'}
    usable=[f for f in fields if f['target_domain'] not in excluded and f['review_status']!='Security review']
    def resolve(k,context):
        candidates=[f for f in usable if f['source_field']==k and f['source_context']==context]
        if len(candidates)!=1: return None
        return candidates[0]['mapping_id']
    def condition(c,context):
        for op in ['any','all']:
            if op in c:
                values=[condition(v,context) for v in c[op]]
                return {op:values} if all(values) else None
        key=resolve(c.get('k'),context)
        if not key:return None
        for op in ['eq','v','ne','in','contains','notEmpty']:
            if op in c:return {'key':key,'op':'eq' if op=='v' else op,'value':c[op]}
        return None
    result=[]
    for f in usable:
        t=f['source_type']; options=list(dict.fromkeys(str(v) for v in f['source_options'] if str(v)))
        kind='text';blocked=''
        if t in ['hidden','file','ecgimages','fullmeds']:blocked='Legacy control needs a dedicated reviewed module.'
        elif f['source_derived']=='Yes':blocked='Derived legacy rule remains inactive pending validation.'
        elif t in ['btnmulti','multi']:kind='multi'
        elif t in ['binary','binary medication','ynbtn','checkbox']:kind='choice';options=options or ['Yes','No']
        elif options:kind='choice'
        elif t in ['num','number','labnum']:kind='number'
        elif t in ['date']:kind='date'
        elif t in ['dt24','date/datetime']:kind='datetime-local'
        elif t=='time':kind='time'
        if kind in ['multi','choice'] and not options:blocked='Choice list was not recovered; source review needed.'
        cond=None
        if f['source_conditional']:
            cond=condition(json.loads(f['source_conditional']),f['source_context'])
            if not cond:blocked='Unresolved legacy condition; source review needed.'
        result.append({'key':f['mapping_id'],'sourceKey':f['source_field'],'label':f['source_label'] or f['source_field'],'context':f['source_context'],'section':f['source_section'],'group':f['source_group'],'type':kind,'options':options,'unit':f['unit'],'condition':cond,'blocked':blocked,'sourceRequired':f['source_required']=='Yes','sourcePath':f['source_path']})
    packages.append({'key':registry,'version':1,'status':'source_draft','sourceSnapshot':fields[0]['source_snapshot'],'inventoryRows':len(fields),'sharedIdentityRows':len(fields)-len(usable),'fields':result})
Path('server/catalog/registry-packages.json').write_text(json.dumps(packages,ensure_ascii=False,indent=2)+'\n')
print(json.dumps([{k:p[k] for k in ['key','inventoryRows','sharedIdentityRows']}|{'fields':len(p['fields']),'blocked':sum(bool(f['blocked']) for f in p['fields'])} for p in packages]))
