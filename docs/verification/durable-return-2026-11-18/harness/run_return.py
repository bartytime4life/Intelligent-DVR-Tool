"""Measure the durable parent-return boundary on a fixed baseline; no optimization."""
import hashlib,json,math,os,subprocess
from pathlib import Path
HERE=Path(__file__).resolve().parent;SRC=HERE/'source';ASSETS=HERE.parents[1]
PYTHON=ASSETS/'qa-local/gpu-qualification-20261028/gpu-env/bin/python';GUARD=ASSETS/'qa-local/pr14-host-20261028T2029Z/offline_guard.py';MODEL=ASSETS/'qa-local/pr14-host-20261028T2029Z/models/yolox-s.onnx'
CORE=json.loads((HERE/'frozen-core-before.json').read_text())
env={**os.environ,'OPENCV_FFMPEG_THREADS':'1','OPENBLAS_NUM_THREADS':'1','MALLOC_ARENA_MAX':'2','DVR_CONSUMER':'batched','DVR_JOURNAL':'1','DVR_PROFILE':'0','DVR_CASE':'latency-baseline'}
plan=dict(source_commit='c707962acdfa8c73e85d9588526cef3f0f43fd4f',core=CORE,seconds=120,post_step_sleep_ms=.5,profile=False,scope='One descriptive baseline, not a candidate comparison or acceptance of a performance change.',
 metrics=dict(worker_end_age='NativeProcessor ended minus source-clock captured_at; excludes result IPC and terminal commit.',durable_return_age='Parent monotonic timestamp immediately after ProcessWorkers.step returns, minus captured_at; journal ID required. Before explicit consumer acknowledgment.',post_worker_return_gap='Per-sample durable_return_age minus worker_end_age; not a difference of marginal percentiles.',drain='Timestamp after close returns; reported separately and excluded from in-window throughput/latency distributions.'),
 criteria=dict(positive_journal_ids=True,parent_return_not_before_worker_end=True,complete_opportunity_accounting=True,all_children_reaped=True,no_source_worker_errors=True,latency_service_level_target='not specified or qualified',physical_camera_capacity='unqualified'),
 harness_sha256={n:hashlib.sha256((HERE/n).read_bytes()).hexdigest() for n in ('run_return.py','recovery_replay.py','native_factory.py')})
with (HERE/'plan.json').open('x') as f:json.dump(plan,f,indent=2);f.write('\n')
rows=[]
for name,args,timeout in [('admission',[str(SRC/'docs/verification/durable-overload-2026-10-28/check-cuda.py'),'--model',str(MODEL),'--output',str(HERE/'cuda-admission.json')],90),('baseline',['recovery_replay.py','--seconds','120','--poll-pause-ms','.5','--label','final'],190),('metadata',['collect_environment.py'],30)]:
 assert all(hashlib.sha256((SRC/p).read_bytes()).hexdigest()==h for p,h in CORE.items())
 with (HERE/(name+'.log')).open('x') as log:
  result=subprocess.run([str(PYTHON),str(GUARD),str(PYTHON),*args],cwd=HERE,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=timeout)
 rows.append(dict(stage=name,exit=result.returncode));(HERE/'check-index.json').write_text(json.dumps(rows,indent=2)+'\n');print(name,result.returncode,flush=True)
 if result.returncode:raise SystemExit(result.returncode)
p=next(HERE.glob('latency-baseline-replay-*/summary.json'));d=json.loads(p.read_text());trace=json.loads((p.parent/'trace.json').read_text());drain=json.loads((p.parent/'drained.json').read_text())
assert len(trace)==d['completed'] and len(drain)==d['drained_after_stop'] and d['return_clock_order_valid']
assert all(type(r['journal_id']) is int and r['journal_id']>0 and all(math.isfinite(r[k]) for k in ('completion_age_ms','durable_return_age_ms','post_worker_return_gap_ms')) and r['durable_return_age_ms']>=r['completion_age_ms'] and r['post_worker_return_gap_ms']>=0 for r in trace+drain)
assert len({r['journal_id'] for r in trace+drain})==len(trace)+len(drain)
assert d['offered']==sum(d[k] for k in ('completed','drained_after_stop','replaced','stale','budget_dropped','failed','pending','inflight'))
assert not d['errors'] and not d['source_errors'] and all(d[k]==0 for k in ('failed','stale','budget_dropped','inflight')) and not d['process']['child_alive']
assert d['sqlite_settings']==dict(journal_mode='wal',synchronous=2,wal_autocheckpoint=512,user_version=1)
assert d['delivery']['acknowledged']==d['delivery']['unique_ids']==len(trace)+len(drain) and d['journal']['unacknowledged']==0
assert all(hashlib.sha256((SRC/p).read_bytes()).hexdigest()==h for p,h in CORE.items())
print(json.dumps({k:v for k,v in d.items() if k.startswith(('durable_return','post_worker_return','return_clock')) or k in ('offered','completed','replaced','pending','results_per_second')},indent=2),flush=True)
print('FINISHED: observed parent-return boundary only; no application changes.',flush=True)
