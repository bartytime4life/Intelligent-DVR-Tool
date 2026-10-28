"""Check sanitized publication consistency; never claims to rerun experiments."""
import json
import math
from pathlib import Path
import re

HERE=Path(__file__).resolve().parent
def load(name):return json.loads((HERE/name).read_text(encoding='utf-8'))
def require(value,message):
    if not value:raise ValueError(message)
def score(row,total):
    require(row['TP']+row['FN']==total,'Reference box accounting mismatch')
    require(math.isclose(row['precision'],row['TP']/(row['TP']+row['FP']),abs_tol=1e-12),'Precision mismatch')
    require(math.isclose(row['recall'],row['TP']/total,abs_tol=1e-12),'Recall mismatch')


def check():
    results=load('results.json');selection=load('image-selection.json');bindings=load('source-bindings.json');checks=load('checks.json')
    require(results['recordings_kept_local'] and not results['production_defaults_changed'],'Locality/default boundary changed')
    require(not results['camera_capacity_100_qualified'],'100-camera claim must remain unqualified')
    require(not results['source']['local_workflow_changes_in_documentation_pr'],'Local implementation incorrectly promoted')
    images=[row for subset in selection['subsets'] for row in subset['images']]
    require(len(images)==300 and len({r['image_id'] for r in images})==300,'Image-ID selection overlap')
    require(len({r['image_sha256'] for r in images})==300,'Exact-byte image selection overlap')
    require(not selection['image_bytes_included'],'Image bytes must not be published')
    for subset,benchmark in zip(selection['subsets'],results['person_benchmarks']):
        require(len(subset['images'])==100,'Subset image count mismatch')
        require(sum(r['person_reference_boxes'] for r in subset['images'])==benchmark['published_person_boxes'],'Subset box count mismatch')
        require(sum(r['stratum']=='person' for r in subset['images'])==50,'Stratum count mismatch')
        require(not benchmark['production_defaults_changed'] and benchmark['network_guard'],'Benchmark scope mismatch')
        variants=benchmark.get('metrics',benchmark.get('person_detection'))
        for metrics in variants.values():score(metrics,benchmark['published_person_boxes'])
        for image in subset['images']:
            require(image['license_id']==4 and image['license_url']=='http://creativecommons.org/licenses/by/2.0/','Unexpected image license')
            require(bool(re.fullmatch('[0-9a-f]{64}',image['image_sha256'])),'Invalid image hash')
    pooled=results['pooled_baseline_300_images'];score(pooled['metrics'],pooled['published_person_boxes'])
    originals=[results['person_benchmarks'][0]['person_detection']['gpu'],*[b['metrics']['baseline'] for b in results['person_benchmarks'][1:]]]
    for key in ('TP','FP','FN'):require(sum(r[key] for r in originals)==pooled['metrics'][key],'Pooled count mismatch')
    require(all(not b['declared_gate_met'] for b in results['person_benchmarks'][1:]),'Rejected trials changed status')
    for stage in results['cpu_live_load']+results['gpu_live_load']:
        require(stage['completed_samples']+stage['replaced_pending_samples']+stage['stale_samples']+stage['budget_dropped']+stage['pending_at_stop']==stage['offered_samples'],'Queue accounting mismatch')
        require(stage['sources_without_errors']<=stage['active_peak']<=stage['requested'],'Source health count mismatch')
        require(math.isclose(stage['completed_samples']/stage['measured_seconds'],stage['completed_samples_per_second'],rel_tol=1e-12),'Rate mismatch')
    require(results['gpu_live_load'][-1]['active_peak']==30 and results['gpu_live_load'][-1]['sources_without_errors']==30,'Clean-source 30 attempt mismatch')
    parity=results['gpu_parity']
    require(parity['passed'] and parity['frames']==100 and parity['failed_frames']==0,'Parity result mismatch')
    require(parity['minimum_matched_iou']>=.99 and parity['maximum_matched_score_delta']<=.001,'Declared parity tolerance failed')
    require(parity['requested_options']['use_tf32']==0,'Unexpected precision mode')
    for row in bindings['files']+bindings['private_harnesses']:
        require(bool(re.fullmatch('[0-9a-f]{64}',row['sha256'])),'Invalid source hash')
    for row in checks['checks']:
        require(row['passed']+row['skipped']==row['run'],'Check accounting mismatch')
    for path in HERE.iterdir():
        require(path.suffix in ('.md','.json','.py','.log'),'Unexpected publication file type')
        if path.resolve()==Path(__file__).resolve():
            continue  # The scanner's own pattern literals are not leaked data.
        text=path.read_text(encoding='utf-8')
        require(not re.search(r'/home/|/Users/|data:image/|data:video/|X-Amz-Signature|Authorization:|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY',text,re.I),'Private path/media/credential marker found')
    print('Host summaries verified: 300 distinct images; reference/queue/rate/parity/source/default invariants checked. No experiments rerun.')


if __name__=='__main__':check()
