"""Validate/print synthetic CI receipts. No native/camera capacity inference."""
import json
from pathlib import Path
import statistics
import sys


def require(value, message):
    if not value:
        raise ValueError(message)


def main():
    root = Path(sys.argv[1])
    ack = [json.loads((root/('ack-'+name+'.json')).read_text()) for name in ('A1','B1','B2','A2')]
    require(ack[0]['journal_sha256'] == ack[3]['journal_sha256'], 'Baseline drift')
    require(ack[1]['journal_sha256'] == ack[2]['journal_sha256'], 'Candidate drift')
    require(ack[0]['journal_sha256'] != ack[1]['journal_sha256'], 'Missing variant comparison')
    for run in ack:
        candidate = run['label'].startswith('candidate')
        for result in run['results']:
            size = result['batch']
            expected = ((size+249)//250 if size > 4 else size) if candidate else size
            require(result['validation_selects'] == result['update_statements'] == expected, 'Statement bound')
    for index, size in enumerate((1,4,64,1000)):
        medians = [r['results'][index]['median_ns'] for r in ack]
        print(json.dumps(dict(scope='Hosted CI synthetic acknowledgment only',
            batch=size, baseline_median_ns=statistics.median([medians[0],medians[3]]),
            candidate_median_ns=statistics.median([medians[1],medians[2]]))))
    runs = [json.loads((root/(name+'.json')).read_text()) for name in ('A1','B1','B2','A2','profile','control')]
    require(all(r['settings'] == runs[0]['settings'] for r in runs[:4]), 'Unequal comparison settings')
    require(runs[0]['source_sha256'] == runs[3]['source_sha256'], 'Baseline source drift')
    require(runs[1]['source_sha256'] == runs[2]['source_sha256'], 'Candidate source drift')
    for run in runs:
        total = sum(run[k] for k in ('completed_in_window','failed_in_window','successful_drain',
            'failed_drain','replacements','stale','budget_dropped','pending','inflight'))
        require(run['accounting_balanced'] and total == run['offered'], 'Lost opportunities')
        require(run['inflight'] == 0 and not run['workers']['child_alive'], 'Unclosed work')
        require(run['peak_payload_bytes'] <= 64*1024**2 and run['peak_entries'] <= 1000, 'Resource bound')
        if run['journal']:
            require(run['journal_policy']['synchronous'] == 2 and
                    run['journal_policy']['journal_mode'] == 'wal', 'Durability policy')
            require(run['sampled_peak_wal_bytes'] <= 4*1024**2, 'Synthetic sampled WAL bound')
            terminal = sum(run[k] for k in ('completed_in_window','failed_in_window','successful_drain','failed_drain'))
            require(run['unique_delivery_ids'] == terminal and run['journal']['unacknowledged'] == 0, 'Durable delivery')
        if run['profile']:
            require(run['profile']['child_final'].get('1') is True, 'Missing final profile')
        print(json.dumps({k:run[k] for k in ('settings','offered','completed_in_window','failed_in_window',
            'successful_drain','failed_drain','samples_per_second','replacements','pending','inflight')}))
    print('Equivalent synthetic settings, source bindings, statement bounds, durable delivery and opportunity accounting verified.')


if __name__ == '__main__':
    main()
