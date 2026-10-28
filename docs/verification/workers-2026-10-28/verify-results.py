"""Frozen worker-evidence consistency only; does not run hardware experiments."""
import json
import math
from pathlib import Path
import re


def check():
    root=Path(__file__).resolve().parent
    data=json.loads((root/'results.json').read_text())
    binding=json.loads((root/'source-bindings.json').read_text())
    def require(condition,message):
        if not condition:raise ValueError('Worker evidence: '+message)
    def proof(runtime):
        p=runtime['startup_execution'];c=p['node_execution_counts']
        require(runtime['backend_id']=='onnxruntime-cuda' and runtime['fallback']=='disabled'
                and runtime['onnxruntime']=='1.31.1' and runtime['provider_options']['use_tf32']==0,
                'runtime contract')
        require(set(c)=={'CUDAExecutionProvider'} and c['CUDAExecutionProvider']>0
                and p['warmup_runs_excluded']==1 and bool(re.fullmatch('[0-9a-f]{64}',p['profile_sha256'])),
                'startup-only proof')
    require(data['base_commit']==binding['base_commit'] and
            bool(re.fullmatch('[0-9a-f]{40}',data['base_commit'])),'source base')
    require(data['cpu_default_unchanged'] is True and data['capacity_100_qualified'] is False
            and data['recordings_kept_local'] is True and data['live_capture_activated'] is False,
            'scope boundaries')
    for count in data['checks'].values():require(count=={'passed':92,'skipped':0},'test counts')
    parity=data['native_parity']
    require(parity['passed'] is True and parity['frames']==100 and parity['workers']==4
            and parity['minimum_iou']>=.99 and parity['maximum_score_delta']<=.001,'native parity')
    require(len(parity['runtimes'])==4,'parity session count')
    for runtime in parity['runtimes']:proof(runtime)
    require(len(data['replay'])==6,'retain initial and final replay trials')
    for phase in ('initial','final'):
        rows=[r for r in data['replay'] if r['phase']==phase]
        require(sorted((r['workers'],round(r['seconds'])) for r in rows)==[(1,30),(4,30),(4,120)],
                'replay matrix')
    for row in data['replay']:
        keys=('offered','completed','drained_after_stop','replaced','stale','budget_dropped','failed','pending','inflight')
        require(all(type(row[k]) is int and row[k]>=0 for k in keys),'nonnegative counts')
        require(row['offered']==sum(row[k] for k in keys if k!='offered'),'queue accounting')
        require(row['seconds']>0 and math.isclose(row['results_per_second'],row['completed']/row['seconds'],
                rel_tol=1e-10),'measured throughput')
        require(row['cameras']==row['active_decoders']==100 and row['physical_recordings']==30
                and not row['errors'] and not row['source_errors'] and row['inflight']==0,'replay scope')
        require(len(row['runtimes'])==row['workers'],'session count')
        for runtime in row['runtimes']:proof(runtime)
    for entries in binding['bindings'].values():
        for entry in entries:
            require(bool(re.fullmatch('[0-9a-f]{64}',entry['sha256'])),'binding hash')
    for name in ('results.json','source-bindings.json'):
        require(not re.search(r'/home/|/tmp/|https?://|data:image|rtsp://',(root/name).read_text()),'private content')
    require(all(p.suffix in ('.md','.json','.py') or p.name=='__pycache__' for p in root.iterdir()),
            'unexpected artifact')
    print('Worker evidence checks passed: initial/final trials, parity, queue accounting and publication scope.')


if __name__=='__main__':check()
