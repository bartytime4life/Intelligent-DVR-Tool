"""Validate frozen batching evidence. No hardware, media or fault experiments run."""
import json
import math
from pathlib import Path
import re
import statistics


def check():
    root=Path(__file__).resolve().parent
    data=json.loads((root/'results.json').read_text());bindings=json.loads((root/'source-bindings.json').read_text())
    report=(root/'README.md').read_text()
    def require(value,message):
        if not value:raise ValueError('Batching evidence: '+message)
    def native(process):
        require(bool(process['metadata']),'startup metadata')
        for generation in process['metadata']:
            require(len(generation['processors'])==4,'four independent sessions')
            for runtime in generation['processors']:
                proof=runtime['startup_execution']
                require(runtime['backend_id']=='onnxruntime-cuda' and runtime['onnxruntime']=='1.31.1'
                        and runtime['fallback']=='disabled' and runtime['provider_options']['use_tf32']==0
                        and proof['node_execution_counts']=={'CUDAExecutionProvider':203}
                        and proof['warmup_runs_excluded']==1
                        and re.fullmatch('[a-f0-9]{64}',proof['profile_sha256']),'startup-only CUDA admission')
    def replay(row):
        native(row['process'])
        keys=('completed','drained_after_stop','failed','replaced','stale','budget_dropped','pending','inflight')
        require(all(type(row[k]) is int and row[k]>=0 for k in (*keys,'offered')),'integer counts')
        require(row['offered']==sum(row[k] for k in keys),'queue balance')
        require(math.isclose(row['results_per_second'],row['completed']/row['seconds'],rel_tol=1e-10),'measured rate')
        require(row['cameras']==row['active_decoders']==100 and row['physical_recordings']==30
                and row['inflight']==row['failed']==row['stale']==row['budget_dropped']==0
                and not row['errors'] and not row['source_errors']
                and row['terminal_outcomes_unique_and_ordered']
                and row['process']['state']=='closed' and not row['process']['child_alive']
                and not row['process']['journal_error'],'replay scope/lifecycle')
        if row['variant']!='control':
            journal=row['journal'];delivery=row['delivery']
            require(delivery['unique_ids']==delivery['acknowledged']==row['completed']+row['drained_after_stop']
                    and delivery['pruned']+journal['entries']==delivery['acknowledged']
                    and journal['unacknowledged']==0 and delivery['peak_entries']<=journal['max_entries'],'delivery accounting')
            if 'sqlite_settings' in row:
                require(row['sqlite_settings']=={'journal_mode':'wal','synchronous':2,'user_version':1},'durability/schema')
            if row['variant']=='candidate':
                require(journal['terminal_rows']==delivery['acknowledged']
                        and 0<journal['terminal_commits']<=journal['terminal_rows']
                        and 1<=journal['largest_terminal_batch']<=4,'bounded committed groups')
    require(data['base_commit']==bindings['base_commit'] and re.fullmatch('[0-9a-f]{40}',data['base_commit']),'base revision')
    require(all(data[k] is True for k in ('cpu_default_unchanged','journal_optional','sqlite_durability_unchanged',
                                        'recordings_kept_local','network_denied'))
            and data['new_video_files']==0 and not data['environments_modified'] and not data['live_camera_activated'],'scope')
    require(all(c=={'passed':125,'skipped':0} for c in data['checks'].values()),'test counts')
    parity=data['native_parity'];native(parity['workers'])
    require(parity['passed'] and parity['frames']==100 and parity['minimum_iou']>=.99
            and parity['maximum_score_delta']<=.001 and not parity['workers']['child_alive']
            and parity['journal']['states']=={'succeeded':100} and parity['journal']['unacknowledged']==100,'reference agreement')
    atomic=data['native_atomic_exit'];require(atomic['passed'] and [r['phase'] for r in atomic['cases']]==['during','after'],'exit phases')
    for case in atomic['cases']:
        native(case['process'])
        require(case['passed'] and case['parent_exit']==case['child_exit']==-9 and case['harness_reaped_child']
                and case['received_before_injection']==4 and case['delivered_before_injection']==0
                and not case['partial_terminal_results_visible'] and case['read_repeat_same_ids']
                and case['acknowledgment_survived_reopen'] and case['pruned']==4,'atomic exit/reaping/delivery')
        expected={'failed':4} if case['phase']=='during' else {'succeeded':4}
        require(case['recovered']['states']==expected and case['recovered']['recovered_interrupted']==(4 if case['phase']=='during' else 0),'all-or-none recovery')
        if case['phase']=='after':require(case['result_hashes_matched'],'committed native values')
    compat=data['compatibility']
    require(compat['passed'] and compat['schema_version']==1 and compat['unchanged_successes']==2
            and compat['recovered_interruptions']==2 and compat['acknowledgment_preserved_across_versions']
            and compat['rows_pruned_by_legacy']==4 and compat['final_empty']
            and all(s['exit']==0 for s in compat['stages']),'version-1 round trip')
    require(any('unread_delivery' in s for s in data['query_plans']['candidate-eager-1'])
            and all('unread_delivery' not in s for s in data['query_plans']['legacy-eager-1']),'unread index diagnosis')
    rows=data['replay'];require(len(rows)==7 and [r['variant'] for r in rows[:4]]==['legacy','candidate','candidate','legacy'],'matched order')
    for row in rows:
        replay(row)
        expected=(f"| {row['case']} | {round(row['seconds'])} s | {row['offered']:,} | {row['completed']:,} | "
                  f"{row['results_per_second']:.2f} | {row['replaced']:,} | {row['drained_after_stop']:,} | {row['pending']:,} |")
        require(expected in report,'table/receipt agreement')
    replay(data['diagnostic_probe'])
    legacy=statistics.median(r['results_per_second'] for r in rows[:4] if r['variant']=='legacy')
    candidate=statistics.median(r['results_per_second'] for r in rows[:4] if r['variant']=='candidate')
    comparison=data['observed_comparison']
    require(math.isclose(legacy,comparison['legacy_eager_median']) and math.isclose(candidate,comparison['candidate_eager_median'])
            and math.isclose(comparison['percent_change'],100*(candidate/legacy-1))
            and comparison['candidate_kept'] and candidate>=legacy and comparison['matched_runs_each']==2,'bounded comparison')
    require(f"{comparison['percent_change']:.2f}% increase" in report,'observed gain')
    require(all(v in ('unqualified','not_implemented','not_provided') for v in data['qualification'].values()),'unqualified dimensions')
    for group in ('candidate_code','legacy_code','private_artifacts','replay_receipts'):
        for entry in bindings[group]:require(entry['bytes']>0 and re.fullmatch('[a-f0-9]{64}',entry['sha256']),'binding hash')
    for name in ('results.json','source-bindings.json'):
        require(not re.search(r'/home/|/tmp/|https?://|data:image|rtsp://',(root/name).read_text()),'private content')
    require(all(p.suffix in ('.md','.json','.py') or p.name=='__pycache__' for p in root.iterdir()),'unexpected artifact')
    print('Batching evidence checks passed: atomic native exits, version compatibility, indexed delivery, matched medians and honest queue/delivery accounting.')


if __name__=='__main__':check()
