"""Pure rule replay; expected event sample indices were frozen by Fraction oracle."""
import argparse, gzip, hashlib, json, sys, types
from pathlib import Path
from fractions import Fraction as F
p=argparse.ArgumentParser();p.add_argument('--rules',type=Path,required=True);p.add_argument('--inputs',type=Path,default=Path(__file__).with_name('inputs.json.gz'));p.add_argument('--output',type=Path,required=True);p.add_argument('--require-pass',action='store_true');a=p.parse_args()
source=a.rules.read_bytes();stored=a.inputs.read_bytes();raw=gzip.decompress(stored)if a.inputs.suffix=='.gz'else stored
inputs=json.loads(raw);m=types.ModuleType('frozen_rule_time_candidate');m.__file__=str(a.rules);sys.modules[m.__name__]=m;exec(compile(source,str(a.rules),'exec'),m.__dict__)
D={'label':'person','score':.9,'box':[.2,.2,.1,.1]};failures=[];assertions=0;counts={}
for c in inputs['cases']:
    engine=m.RuleEngine([m.Rule('generated person','person',(0,0,1,1),dwell=float(F(c['dwell'])),threshold=.5,max_gap=float(F(c['gap'])))],run_id='generated-time-oracle')
    actual=[]
    try:
        for i,(t,match) in enumerate(zip(c['times'],c['matches'])):
            events=engine.update(float(F(t)),[D]if match else[])
            if len(events)>1:raise AssertionError('Single rule emitted multiple events at one sample')
            if events:actual.append(i)
        assertions+=1
        if actual!=c['expected_event_indices']:failures.append({'id':c['id'],'expected_event_indices':c['expected_event_indices'],'actual_event_indices':actual,'tags':c['tags'],'domain':c['domain']})
    except Exception as e:
        assertions+=1;failures.append({'id':c['id'],'error_type':type(e).__name__,'error':str(e)})
    counts[c['domain']]=counts.get(c['domain'],0)+1
values={'same':1,'decreasing':.9,'negative':-1,'nan':float('nan'),'infinity':float('inf'),'negative-infinity':-float('inf'),'bool':True,'string':'2','none':None}
for c in inputs['invalid_cases']:
    engine=m.RuleEngine([m.Rule('generated person','person',(0,0,1,1),dwell=1,max_gap=2)],run_id='generated-time-oracle')
    engine.update(1,[D]);rejected=False
    try:engine.update(values[c['invalid']],[D])
    except ValueError:rejected=True
    except Exception as e:failures.append({'id':c['id'],'wrong_error':type(e).__name__})
    assertions+=2
    if not rejected:failures.append({'id':c['id'],'failure':'did not reject invalid time'})
    try:
        if len(engine.update(2,[D]))!=1:failures.append({'id':c['id'],'failure':'invalid time changed dwell state'})
    except Exception as e:failures.append({'id':c['id'],'recovery_error':str(e)})
if source!=a.rules.read_bytes()or stored!=a.inputs.read_bytes():raise RuntimeError('Source or corpus changed during replay')
receipt={'schema':'dvr-rule-time-oracle-receipt-v1','baseline_head':inputs['baseline_head'],'source_sha256':hashlib.sha256(source).hexdigest(),'inputs_sha256':hashlib.sha256(raw).hexdigest(),'compressed_inputs_sha256':hashlib.sha256(stored).hexdigest(),'checker_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'cases':len(inputs['cases']),'invalid_cases':len(inputs['invalid_cases']),'samples':sum(len(c['times'])for c in inputs['cases']),'domains':counts,'assertions':assertions,'failure_count':len(failures),'failures':failures,'ambiguity_diagnostics':inputs['ambiguity_diagnostics'],'source_and_inputs_unchanged':True,'limits':inputs['limits']}
a.output.write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({k:receipt[k]for k in ['source_sha256','inputs_sha256','checker_sha256','cases','invalid_cases','samples','assertions','failure_count']},indent=2))
if a.require_pass and failures:raise SystemExit(1)
