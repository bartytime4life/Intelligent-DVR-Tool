import hashlib,json,os,subprocess
from pathlib import Path
HERE=Path(__file__).resolve().parent;REPO=HERE/'source';ASSETS=HERE.parents[1]
gpu=ASSETS/'qa-local/gpu-qualification-20261028/gpu-env/bin/python'
guard=ASSETS/'qa-local/pr14-host-20261028T2029Z/offline_guard.py'
env={**os.environ,'OPENCV_FFMPEG_THREADS':'1','OPENBLAS_NUM_THREADS':'1','MALLOC_ARENA_MAX':'2','DVR_CONSUMER':'batched'}
core=json.loads((HERE/'frozen-core-before.json').read_text())
cases=[('core-tests',['-m','unittest','discover','-s','tests','-p','test_journal*.py'],REPO,90,{}),
       ('process-tests',['-m','unittest','discover','-s','tests','-p','test_supervision.py'],REPO,90,{}),
       ('profiler-tests',['-m','unittest','discover','-s','tests','-p','test_profiling.py'],REPO,90,{}),
       ('parity',['process_parity.py'],HERE,120,{})]
for name,journal,profile,seconds in [('journal-1',1,0,30),('control-1',0,0,30),('control-2',0,0,30),('journal-2',1,0,30),('profile-journal',1,1,30),('profile-control',0,1,30),('journal-120',1,0,120)]:
 cases.append((name,['recovery_replay.py','--seconds',str(seconds),'--label','final'],HERE,seconds+70,
               dict(DVR_CASE=name,DVR_JOURNAL=str(journal),DVR_PROFILE=str(profile))))
plan=dict(source_commit='d9fa29ebebe102d43202a38c1d67347f1f62b85c',core=core,order=[c[0] for c in cases],
          scope='Current-code journal/control ABBA with profiling OFF; separate profiling cases; no historical speedup claim',
          windows='Outcomes collected at/after the fixed window are drain; offers stop at the boundary; SQL tracing OFF')
(HERE/'plan.json').write_text(json.dumps(plan,indent=2)+'\n')
rows=[]
for name,args,cwd,timeout,settings in cases:
 assert all(hashlib.sha256((REPO/p).read_bytes()).hexdigest()==sha for p,sha in core.items())
 with (HERE/(name+'.log')).open('x') as log:
  result=subprocess.run([str(gpu),str(guard),str(gpu),*args],cwd=cwd,env={**env,**settings},stdout=log,stderr=subprocess.STDOUT,timeout=timeout)
 rows.append(dict(name=name,exit=result.returncode,core_hashes=core));(HERE/'check-index.json').write_text(json.dumps(rows,indent=2)+'\n')
 print(name,result.returncode,flush=True)
 if result.returncode:raise SystemExit(result.returncode)
