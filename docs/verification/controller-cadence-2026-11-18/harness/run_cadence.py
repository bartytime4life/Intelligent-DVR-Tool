"""Bounded owner-local caller-pause trial; no application edits or live sources."""
import hashlib,json,os,statistics,subprocess,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent;SRC=HERE/'source';ASSETS=HERE.parents[1]
PYTHON=ASSETS/'qa-local/gpu-qualification-20261028/gpu-env/bin/python'
GUARD=ASSETS/'qa-local/pr14-host-20261028T2029Z/offline_guard.py'
MODEL=ASSETS/'qa-local/pr14-host-20261028T2029Z/models/yolox-s.onnx'
CORE=json.loads((HERE/'frozen-core-before.json').read_text())
ENV={**os.environ,'OPENCV_FFMPEG_THREADS':'1','OPENBLAS_NUM_THREADS':'1','MALLOC_ARENA_MAX':'2','DVR_CONSUMER':'batched','DVR_JOURNAL':'1'}
PLAN=dict(source_commit='80825904df5c2989aa546178c59c9d20b49f3977',core=CORE,
 hypothesis='A 2 ms post-step sleep may amortize durable reservation/completion commits through larger received batches; it may also reduce throughput or increase collection latency.',
 variants={'A':dict(post_step_sleep_ms=.5),'B':dict(post_step_sleep_ms=2.)},
 order=['A1','B1','B2','A2','profile-A','profile-B'],
 acceptance=dict(minimum_unprofiled_median_gain=.03,maximum_candidate_p95_age_increase_ms=25,maximum_candidate_p95_age_ms=1000,require_lower_median_replacements=True,require_equal_offers=True,minimum_common_completed_samples=2500,minimum_box_iou=.99,maximum_score_delta=.001),
 confirmation='Only if the ABBA and common-sample agreement gates pass: unprofiled 120-second A then B; no runtime default adoption.',
 fixed=dict(virtual_streams=100,recordings=30,cuda_sessions=4,nominal_samples_per_source_second=2,source_timing='fixed windows; outcomes at/after stop go to drain',journal_policy='FULL/WAL/schema1/512 pages',consumer_minimum_interval_ms=25,sql_tracing=False,prune_at_entries=500,max_sample_bytes=2*1024**2,max_buffer_bytes=64*1024**2,max_age_seconds=2,task_timeout_seconds=2,post_step_pause_scope='Caller sleeps after each main-window step; not a fixed polling period or a delay inside the protected core.'),
 harness_sha256={n:hashlib.sha256((HERE/n).read_bytes()).hexdigest() for n in ('run_cadence.py','recovery_replay.py','native_factory.py')})
with (HERE/'plan.json').open('x') as f:json.dump(PLAN,f,indent=2);f.write('\n')
rows=[]
def run(name,args,timeout=90,settings=None):
 assert all(hashlib.sha256((SRC/p).read_bytes()).hexdigest()==h for p,h in CORE.items())
 with (HERE/(name+'.log')).open('x') as log:
  r=subprocess.run([str(PYTHON),str(GUARD),str(PYTHON),*args],cwd=HERE,env={**ENV,**(settings or {})},stdout=log,stderr=subprocess.STDOUT,timeout=timeout)
 rows.append(dict(stage=name,exit=r.returncode));(HERE/'check-index.json').write_text(json.dumps(rows,indent=2)+'\n');print(name,r.returncode,flush=True)
 if r.returncode:raise SystemExit(r.returncode)
def replay(name,pause,seconds=30,profile=False):
 run(name,['recovery_replay.py','--seconds',str(seconds),'--label','final','--poll-pause-ms',str(pause)],seconds+70,dict(DVR_CASE=name,DVR_PROFILE='1' if profile else '0'))
 d=json.loads(next(HERE.glob(name+'-replay-*/summary.json')).read_text())
 assert d['requested_post_step_sleep_ms']==pause and d['journal_enabled'] and d['profiling_enabled']==profile
 assert not d['errors'] and not d['source_errors'] and d['active_decoders']==100 and not d['process']['child_alive']
 assert all(d[k]==0 for k in ('failed','stale','budget_dropped','inflight'))
 assert d['offered']==sum(d[k] for k in ('completed','drained_after_stop','replaced','stale','budget_dropped','failed','pending','inflight'))
 assert d['sqlite_settings']==dict(journal_mode='wal',synchronous=2,wal_autocheckpoint=512,user_version=1)
 assert d['delivery']['unique_ids']==d['delivery']['acknowledged']==d['completed']+d['drained_after_stop']
 return d
run('admission',[str(SRC/'docs/verification/durable-overload-2026-10-28/check-cuda.py'),'--model',str(MODEL),'--output',str(HERE/'cuda-admission.json')])
reports=[]
for name,pause in [('A1',.5),('B1',2.),('B2',2.),('A2',.5)]:reports.append(replay(name,pause))
sys.path.insert(0,str(SRC));from edge.evaluation import iou
left=json.loads(next(HERE.glob('A1-replay-*/trace.json')).read_text());right=json.loads(next(HERE.glob('B1-replay-*/trace.json')).read_text())
a={(r['camera'],r['sequence']):r['detections'] for r in left};b={(r['camera'],r['sequence']):r['detections'] for r in right};keys=sorted(a.keys()&b.keys());minimum=1.;delta=0.;matched=0
for key in keys:
 remaining=list(b[key]);assert len(a[key])==len(remaining)
 for x in a[key]:
  candidates=[r for r in remaining if r['label']==x['label']];assert candidates
  y=max(candidates,key=lambda r:iou(x['box'],r['box']));remaining.remove(y)
  minimum=min(minimum,iou(x['box'],y['box']));delta=max(delta,abs(x['score']-y['score']));matched+=1
assert len(keys)>=2500 and minimum>=.99 and delta<=.001
baseline=statistics.median(reports[i]['results_per_second'] for i in (0,3));candidate=statistics.median(reports[i]['results_per_second'] for i in (1,2));age=statistics.median(reports[i]['completion_age_p95_ms'] for i in (0,3));max_candidate_age=max(reports[i]['completion_age_p95_ms'] for i in (1,2))
gates=dict(gain=candidate/baseline-1>=.03,latency=max_candidate_age<=age+25 and max_candidate_age<=1000,replacements=statistics.median(reports[i]['replaced'] for i in (1,2))<statistics.median(reports[i]['replaced'] for i in (0,3)),equal_offers=len({r['offered'] for r in reports})==1,common_sample_agreement=True)
decision=dict(baseline_median_per_second=baseline,candidate_median_per_second=candidate,observed_median_gain=candidate/baseline-1,baseline_median_p95_age_ms=age,candidate_maximum_p95_age_ms=max_candidate_age,gates=gates,accepted_for_longer_confirmation=all(gates.values()),common_samples=dict(compared=len(keys),matched_boxes=matched,minimum_iou=minimum,maximum_score_delta=delta),default_adopted=False)
(HERE/'decision.json').write_text(json.dumps(decision,indent=2)+'\n');print('ABBA decision',json.dumps(decision),flush=True)
for name,pause in [('profile-A',.5),('profile-B',2.)]:replay(name,pause,profile=True)
if decision['accepted_for_longer_confirmation']:
 for name,pause in [('A120',.5),('B120',2.)]:replay(name,pause,seconds=120)
run('metadata',['collect_environment.py'])
assert all(hashlib.sha256((SRC/p).read_bytes()).hexdigest()==h for p,h in CORE.items())
print('FINISHED: no application defaults changed; all private receipts retained.',flush=True)
