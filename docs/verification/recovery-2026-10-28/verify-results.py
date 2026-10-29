"""Validate frozen recovery evidence accounting; no hardware experiments run."""
import json
import math
from pathlib import Path
import re


def check():
    root=Path(__file__).resolve().parent
    data=json.loads((root/'results.json').read_text());binding=json.loads((root/'source-bindings.json').read_text())
    def require(condition,message):
        if not condition:raise ValueError('Recovery evidence: '+message)
    def process(raw,expected_restarts):
        require(raw['state']=='closed' and raw['child_alive'] is False
                and raw['all_owned_children_reaped'] is True and raw['reaped_before_replacement'] is True,
                'owned child lifecycle')
        require(raw['restarts']==expected_restarts and raw['generation']==expected_restarts+1,'restart budget')
        require(len(raw['metadata'])==expected_restarts+1,'generation metadata')
        for generation in raw['metadata']:
            require(len(generation['processors'])==4,'four independent CUDA sessions')
            for runtime in generation['processors']:
                proof=runtime['startup_execution'];counts=proof['node_execution_counts']
                require(runtime['backend_id']=='onnxruntime-cuda' and runtime['onnxruntime']=='1.31.1'
                        and runtime['fallback']=='disabled' and runtime['provider_options']['use_tf32']==0,
                        'runtime contract')
                require(set(counts)=={'CUDAExecutionProvider'} and counts['CUDAExecutionProvider']>0
                        and proof['warmup_runs_excluded']==1 and bool(re.fullmatch('[a-f0-9]{64}',proof['profile_sha256'])),
                        'startup-only CUDA proof')
    require(data['base_commit']==binding['base_commit'] and bool(re.fullmatch('[0-9a-f]{40}',data['base_commit'])),
            'source base')
    require(data['cpu_default_unchanged'] is True and data['linux_process_optional'] is True
            and data['environments_modified'] is False and data['live_camera_activated'] is False
            and data['recordings_kept_local'] is True and data['new_video_files']==0
            and data['capacity_100_qualified'] is False,'scope boundaries')
    for count in data['checks'].values():require(count=={'passed':104,'skipped':0},'test counts')
    parity=data['native_parity']
    require(parity['passed'] is True and parity['frames']==100 and parity['minimum_iou']>=.99
            and parity['maximum_score_delta']<=.001,'100-frame reference agreement')
    process(parity['workers'],0)
    rows=data['replay']
    require(len(rows)==3 and sorted(round(r['seconds']) for r in rows)==[30,120,600],'replay windows')
    report=(root/'README.md').read_text()
    labels={'baseline-final':'Baseline','recovery-120s-final':'Injected faults','recovery-600s-final':'Injected faults + soak'}
    for row in rows:
        keys=('completed','drained_after_stop','failed','replaced','stale','budget_dropped','pending','inflight')
        require(all(type(row[k]) is int and row[k]>=0 for k in (*keys,'offered')),'nonnegative integer counts')
        require(row['offered']==sum(row[k] for k in keys),'queue accounting')
        require(math.isclose(row['results_per_second'],row['completed']/row['seconds'],rel_tol=1e-10),'measured rate')
        require(row['cameras']==row['active_decoders']==100 and row['physical_recordings']==30
                and not row['errors'] and not row['source_errors'] and row['inflight']==0
                and row['terminal_outcomes_unique_and_ordered'] is True,'replay scope and order')
        restarts=0 if row['mode']=='none' else 2
        process(row['process'],restarts)
        require(row['failed']==row['process']['failed'] and row['completed']+row['drained_after_stop']==row['process']['completed'],
                'process outcome accounting')
        require(sum(row['failure_codes'].values())==row['failed'],'failure categories')
        table_row=(f"| {labels[row['name']]} | {round(row['seconds'])} s | {row['offered']:,} | "
                   f"{row['completed']:,} | {row['results_per_second']:.2f} | {row['failed']:,} | "
                   f"{row['replaced']:,} | {row['drained_after_stop']:,} | {row['pending']:,} |")
        require(table_row in report,'report table agrees with receipts')
        if restarts:
            require([r['fault'] for r in row['recoveries']]==['software-stall','abrupt-exit'],'controlled fault sequence')
            require(all(r['detection_seconds']>=0 and r['replacement_ready_after_detection_seconds']>=0
                        for r in row['recoveries']),'recovery intervals')
            require(row['failed']>0,'failures cannot be silently counted as success')
    for entries in binding['bindings'].values():
        for entry in entries:require(bool(re.fullmatch('[0-9a-f]{64}',entry['sha256'])),'binding hash')
    for name in ('results.json','source-bindings.json'):
        require(not re.search(r'/home/|/tmp/|https?://|data:image|rtsp://',(root/name).read_text()),'private content')
    require(all(p.suffix in ('.md','.json','.py') or p.name=='__pycache__' for p in root.iterdir()),'unexpected artifact')
    print('Recovery evidence checks passed: native proof, generations/reaping, fault intervals, outcome/queue accounting and privacy scope.')


if __name__=='__main__':check()
