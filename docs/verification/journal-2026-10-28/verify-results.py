"""Validate frozen journal evidence; never executes hardware, storage faults or media."""
import json
import math
from pathlib import Path
import re


def check():
    root=Path(__file__).resolve().parent
    data=json.loads((root/'results.json').read_text());bindings=json.loads((root/'source-bindings.json').read_text())
    def require(value,message):
        if not value:raise ValueError('Journal evidence: '+message)
    def native(process):
        for generation in process['metadata']:
            require(len(generation['processors'])==4,'four native sessions')
            for runtime in generation['processors']:
                proof=runtime['startup_execution']
                require(runtime['backend_id']=='onnxruntime-cuda' and runtime['onnxruntime']=='1.31.1'
                        and runtime['fallback']=='disabled' and runtime['provider_options']['use_tf32']==0,
                        'native runtime binding')
                require(proof['node_execution_counts']=={'CUDAExecutionProvider':203}
                        and proof['warmup_runs_excluded']==1
                        and re.fullmatch('[a-f0-9]{64}',proof['profile_sha256']),'startup-only CUDA proof')
    require(data['base_commit']==bindings['base_commit'] and re.fullmatch('[0-9a-f]{40}',data['base_commit']), 'base revision')
    require(all(data[k] is True for k in ('cpu_default_unchanged','journal_optional','recordings_kept_local','network_denied'))
            and data['new_video_files']==0 and not data['environments_modified'] and not data['live_camera_activated'],'scope')
    require(all(c=={'passed':117,'skipped':0} for c in data['checks'].values()),'test counts')
    parity=data['native_parity'];native(parity['workers'])
    require(parity['passed'] and parity['frames']==100 and parity['minimum_iou']>=.99
            and parity['maximum_score_delta']<=.001 and not parity['workers']['child_alive']
            and parity['journal']['states']=={'succeeded':100} and parity['journal']['unacknowledged']==100,'native agreement')
    crash=data['parent_crash']
    for key in ('initial_process','restarted_process'):native(crash[key])
    require(crash['passed'] and crash['parent_exit']==crash['owned_child_exit']==-9
            and crash['owned_child_reaped'] and crash['computed_but_unreceived']==crash['interrupted']==4,'parent death')
    require(crash['initial_successes']==12 and crash['previously_acknowledged']==4
            and crash['unacknowledged_successes_recovered']==8 and crash['first_restart_unacknowledged']==12
            and crash['read_before_ack_exit']==87 and crash['same_ids_redelivered']
            and crash['pruned_after_explicit_ack']==16 and crash['new_run_successes']==16
            and crash['run_and_receipt_ids_not_reused'] and crash['final_empty'],'delivery/recovery accounting')
    require(not crash['restarted_process']['child_alive'] and crash['recovered']['recovered_interrupted']==4,'owned restart lifecycle')
    rows=data['replay'];require(len(rows)==3 and [r['journal_enabled'] for r in rows]==[False,True,True],'replay cases')
    report=(root/'README.md').read_text()
    for row in rows:
        native(row['process'])
        keys=('completed','drained_after_stop','failed','replaced','stale','budget_dropped','pending','inflight')
        require(all(type(row[k]) is int and row[k]>=0 for k in (*keys,'offered')),'integer counts')
        require(row['offered']==sum(row[k] for k in keys),'queue balance')
        require(math.isclose(row['results_per_second'],row['completed']/row['seconds'],rel_tol=1e-10),'measured rate')
        require(row['cameras']==row['active_decoders']==100 and row['physical_recordings']==30
                and not row['errors'] and not row['source_errors'] and row['inflight']==row['failed']==0
                and row['terminal_outcomes_unique_and_ordered'] and not row['process']['child_alive']
                and not row['process']['journal_error'],'replay boundaries')
        expected=(f"| {row['name']} | {round(row['seconds'])} s | {row['offered']:,} | {row['completed']:,} | "
                  f"{row['results_per_second']:.2f} | {row['replaced']:,} | {row['drained_after_stop']:,} | {row['pending']:,} |")
        require(expected in report,'report/receipt agreement')
        if row['journal_enabled']:
            delivery=row['delivery'];journal=row['journal']
            require(delivery['unique_ids']==delivery['acknowledged']==row['completed']+row['drained_after_stop']
                    and delivery['pruned']+journal['entries']==delivery['acknowledged']
                    and journal['unacknowledged']==0 and delivery['peak_entries']<=journal['max_entries'],'journal delivery')
    slowdown=100*(1-rows[1]['results_per_second']/rows[0]['results_per_second'])
    require(f'{slowdown:.2f}% lower' in report,'durability cost remains visible')
    require(data['initial_harness_attempt']['exit']==1 and 'stopped polling' in data['initial_harness_attempt']['reason'],'failed attempt retained')
    require(all(v in ('unqualified','not_implemented','not_provided') for v in data['qualification'].values()),'unqualified dimensions')
    for group in ('code','private_artifacts','replay_receipts'):
        for entry in bindings[group]:require(entry['bytes']>0 and re.fullmatch('[a-f0-9]{64}',entry['sha256']),'artifact hash')
    for name in ('results.json','source-bindings.json'):
        require(not re.search(r'/home/|/tmp/|https?://|data:image|rtsp://',(root/name).read_text()),'private content')
    require(all(p.suffix in ('.md','.json','.py') or p.name=='__pycache__' for p in root.iterdir()),'unexpected artifact')
    print('Journal evidence checks passed: native proof, interrupted work, acknowledgment/redelivery, replay accounting and measured durability cost.')


if __name__=='__main__':check()
