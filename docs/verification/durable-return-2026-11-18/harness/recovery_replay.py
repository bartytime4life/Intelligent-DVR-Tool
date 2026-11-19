"""Private offline process recovery/soak qualification; no live capture."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import threading
import time

HERE=Path(__file__).resolve().parent
ASSETS=HERE.parents[1]
REPO=Path(os.environ.get('DVR_SOURCE',str(HERE/'source')))
sys.path.insert(0,str(REPO))
sys.path.append(str(ASSETS/'qa-local/public-pilot-20261028/media-env/lib/python3.12/site-packages'))
import av
from edge.scheduler import CameraScheduler,Sample
from edge.supervision import ProcessWorkers
from edge.journal import OutcomeJournal
from edge.profiling import BoundedProfile
from native_factory import NativeFactory


def rss(pid):
    try:
        return int(next(x for x in Path(f'/proc/{pid}/status').read_text().splitlines() if x.startswith('VmRSS:')).split()[1])*1024
    except (OSError,StopIteration):return 0


def memory(pid):
    available=int(next(x for x in Path('/proc/meminfo').read_text().splitlines() if x.startswith('MemAvailable:')).split()[1])*1024
    parent=rss(os.getpid());child=rss(pid) if pid else 0
    if available<2*1024**3 or parent+child>4*1024**3:
        raise MemoryError('Experiment sampled memory guard reached')
    return dict(available_bytes=available,parent_rss_bytes=parent,child_rss_bytes=child)


def quantile(values,q):
    import math
    return sorted(values)[max(0,math.ceil(len(values)*q)-1)] if values else None


def run(args):
    output=HERE/(os.environ.get('DVR_CASE','trial')+f'-replay-{args.cameras}-{args.fault}-{args.seconds}s'+('-'+args.label if args.label else ''))
    output.mkdir()
    frozen=ASSETS/'qa-local/gpu-qualification-20261028/stage-30-alternate'
    record=json.loads((frozen/'summary.json').read_text())
    clips=[];bindings=[]
    for source in record['source_states']:
        fragments=source['saved_fragments']
        initialization=[f for f in fragments if f['kind']=='initialization']
        media=sorted((f for f in fragments if f['kind']=='media'),key=lambda f:f['sequence'])
        if len(initialization)!=1 or not media:raise ValueError('Unsupported recording fragments')
        bodies=[]
        for f in initialization+media:
            data=(frozen/'recordings'/f['file']).read_bytes()
            if len(data)!=f['bytes'] or hashlib.sha256(data).hexdigest()!=f['sha256']:
                raise ValueError('Recording hash mismatch')
            bodies.append(data)
        body=b''.join(bodies)
        if len(body)>16*1024**2:raise ValueError('Recording memory bound')
        clips.append(body);bindings.append(dict(bytes=len(body),sha256=hashlib.sha256(body).hexdigest()))
    (output/'inputs.json').write_text(json.dumps(bindings,indent=2)+'\n')
    timings=BoundedProfile() if os.environ.get('DVR_PROFILE')=='1' else None
    options={'profile':timings} if timings is not None else {}
    journal_enabled=os.environ.get('DVR_JOURNAL','1')=='1'
    names=[f'camera-{i+1:03}' for i in range(args.cameras)]
    scheduler=CameraScheduler(names,workers=4,max_sample_bytes=2*1024**2,
                              max_buffer_bytes=64*1024**2,max_age_seconds=2,**options)
    stop=threading.Event();gate=threading.Event();lock=threading.Lock()
    ready=[threading.Event() for _ in names]
    state=[dict(camera=n,frames=0,offered=0,errors=[],active=False,dimensions=[]) for n in names]
    def producer(i):
        row=state[i];sample_sequence=0;next_sample=0.;offset=0.;clock=None
        try:
            while not stop.is_set():
                with av.open(io.BytesIO(clips[i%len(clips)]),mode='r') as container:
                    video=container.streams.video[0];video.codec_context.thread_count=1
                    dimensions=[video.width,video.height,str(video.average_rate)]
                    if dimensions not in row['dimensions']:row['dimensions'].append(dimensions)
                    zero=None;previous=None;last=None;step=1/float(video.average_rate)
                    for frame in container.decode(video):
                        if stop.is_set():return
                        if frame.pts is None:raise ValueError('Missing PTS')
                        pts=float(frame.pts*frame.time_base)
                        if previous is not None and pts<=previous:raise ValueError('Nonmonotonic PTS')
                        if previous is not None:step=pts-previous
                        previous=pts
                        if zero is None:zero=pts
                        stamp=offset+pts-zero;last=stamp
                        if clock is None:
                            ready[i].set()
                            while not gate.wait(.1):
                                if stop.is_set():return
                            clock=time.monotonic();row['active']=True
                        due=clock+stamp
                        if stop.wait(max(0,due-time.monotonic())):return
                        row['frames']+=1
                        if stamp+1e-6>=next_sample:
                            image=frame.reformat(format='bgr24')
                            payload=struct.pack('<III',image.width,image.height,image.planes[0].line_size)+bytes(image.planes[0])
                            with lock:
                                if stop.is_set() or (began is not None and time.monotonic()>=began+args.seconds):return
                                scheduler.submit(Sample(names[i],sample_sequence,min(due,time.monotonic()),payload))
                                sample_sequence+=1;row['offered']+=1
                            next_sample=stamp+.5
                    if last is None:raise ValueError('Empty clip')
                    offset=last+step
        except Exception as exc:row['errors'].append(type(exc).__name__+': '+str(exc))
        finally:ready[i].set()
    factory=NativeFactory(str(ASSETS/'qa-local/pr14-host-20261028T2029Z/models/yolox-s.onnx'),
                          str(REPO/'edge/labels/coco80.json'),args.fault,str(output/'faults.jsonl'))
    journal=OutcomeJournal(output/'journal',max_entries=1000,**options) if journal_enabled else None
    delivery_ids=set();acknowledged=0;pruned=0;peak_journal_entries=0
    sql_counts={};last_delivery=0.;consumer=os.environ.get('DVR_CONSUMER','eager')
    def count_sql(statement):
        operation=statement.split(' ',1)[0]
        sql_counts[operation]=sql_counts.get(operation,0)+1
    # SQL tracing stays OFF in every case; bounded profiling is separate.
    workers=None;threads=[];results=[];drained=[];failures=[];monitor=[];gpu=[];errors=[]
    seen=set();last_sequence={};began=None;seconds=0;closed=False;step_starts=0
    def retain(outcomes,destination,returned_at=None):
        nonlocal acknowledged,pruned,peak_journal_entries,last_delivery
        if returned_at is None:returned_at=time.monotonic()
        for outcome in outcomes:
            work=outcome.work
            assert (outcome.journal_id is not None)==journal_enabled
            if work.token in seen or work.sample.sequence<=last_sequence.get(work.sample.camera,-1):
                raise ValueError('Duplicate or out-of-order terminal outcome')
            seen.add(work.token);last_sequence[work.sample.camera]=work.sample.sequence
            if outcome.error:
                failures.append(dict(camera=work.sample.camera,sequence=work.sample.sequence,token=work.token,
                                     code=outcome.error.code,generation=outcome.generation))
            else:
                destination.append(dict(camera=work.sample.camera,sequence=work.sample.sequence,token=work.token,journal_id=outcome.journal_id,process_generation=outcome.generation,processor=outcome.processor,**outcome.result,durable_return_age_ms=(returned_at-work.sample.captured_at)*1000,post_worker_return_gap_ms=(returned_at-work.sample.captured_at)*1000-outcome.result['completion_age_ms']))
        if journal is None:return
        if consumer=='batched' and time.monotonic()-last_delivery<.025 and not closed:
            return
        last_delivery=time.monotonic()
        records=journal.pending(1000)
        if records:
            ids=[r['id'] for r in records]
            assert not (set(ids)&delivery_ids)
            assert all(r['status']=='succeeded' for r in records)
            assert {r['token'] for r in records}<=seen
            delivery_ids.update(ids);journal.acknowledge(ids);acknowledged+=len(ids)
        peak_journal_entries=max(peak_journal_entries,journal.snapshot()['entries'])
        if journal.snapshot()['entries']>=500:
            pruned+=journal.prune()
    def gpu_monitor():
        while not stop.is_set():
            stamp=time.monotonic()
            try:
                result=subprocess.run(['nvidia-smi','--query-gpu=memory.used,utilization.gpu,temperature.gpu,power.draw',
                                       '--format=csv,noheader,nounits'],capture_output=True,text=True,timeout=2)
                gpu.append(dict(at=stamp,exit=result.returncode,value=result.stdout.strip()))
            except Exception as exc:gpu.append(dict(at=stamp,error=type(exc).__name__))
            if stop.wait(5):return
    try:
        workers=ProcessWorkers(scheduler,factory,startup_timeout=30,task_timeout=2,
                               max_restarts=2 if args.fault=='combined' else 0,restart_delay=.25,journal=journal,**options)
        startup_deadline=time.monotonic()+35
        while workers.snapshot()['state']!='running' and time.monotonic()<startup_deadline:
            retain(workers.step(),results)
            if workers.snapshot()['state']=='failed':raise RuntimeError('CUDA child failed startup')
            memory(workers.snapshot()['pid']);time.sleep(.002)
        if workers.snapshot()['state']!='running':raise TimeoutError('Startup not ready')
        for i in range(args.cameras):
            t=threading.Thread(target=producer,args=(i,),daemon=True);threads.append(t);t.start()
        deadline=time.monotonic()+15
        while not all(r.is_set() for r in ready) and time.monotonic()<deadline:
            memory(workers.snapshot()['pid']);time.sleep(.01)
        if not all(r.is_set() for r in ready):raise TimeoutError('Decoder startup incomplete')
        metrics_thread=threading.Thread(target=gpu_monitor,daemon=True);metrics_thread.start()
        began=time.monotonic();gate.set();last_monitor=0;last_progress=0;step_starts=0
        while time.monotonic()-began<args.seconds:
            now=time.monotonic()
            if now-last_monitor>=.1:
                snapshot=workers.snapshot()
                monitor.append(dict(elapsed=now-began,state=snapshot['state'],generation=snapshot['generation'],
                                    frames=sum(r['frames'] for r in state),**memory(snapshot['pid'])))
                if snapshot['state']=='failed':raise RuntimeError('Process restart budget exhausted')
                last_monitor=now
            step_starts+=1
            outcomes=workers.step()
            returned_at=time.monotonic()
            retain(outcomes,results if returned_at<began+args.seconds else drained,returned_at)
            if now-last_progress>=10:
                snapshot=workers.snapshot();queue=scheduler.snapshot()
                progress=dict(elapsed=now-began,completed=len(results),failures=len(failures),
                              generation=snapshot['generation'],restarts=snapshot['restarts'],state=snapshot['state'],
                              decoded_frames=sum(r['frames'] for r in state),pending=queue['pending'],
                              replaced=sum(r['replaced'] for r in queue['per_camera'].values()))
                temporary=output/'progress.tmp';temporary.write_text(json.dumps(progress));temporary.replace(output/'progress.json')
                last_progress=now
            time.sleep(args.poll_pause_ms/1000)
        seconds=time.monotonic()-began
    except Exception as exc:errors.append(type(exc).__name__+': '+str(exc))
    finally:
        with lock:stop.set()
        gate.set()
        if began is not None and not seconds:seconds=time.monotonic()-began
        for thread in threads:thread.join(10)
        if any(t.is_alive() for t in threads):errors.append('Decoder thread failed to stop')
        if workers:
            try:retain(workers.close(timeout=2.5),drained)
            except Exception as exc:errors.append(type(exc).__name__+': '+str(exc))
            closed=not workers.snapshot()['child_alive']
        if 'metrics_thread' in locals():metrics_thread.join(3)
    controller_elapsed=seconds;seconds=float(args.seconds)
    snap=scheduler.snapshot();stats=list(snap['per_camera'].values())
    offered=sum(r['offered'] for r in state);completed=len(results)
    replaced=sum(s['replaced'] for s in stats);stale=sum(s['stale'] for s in stats)
    dropped=sum(s['budget_dropped'] for s in stats);failed=sum(s['failed'] for s in stats)
    if offered!=completed+len(drained)+replaced+stale+dropped+failed+snap['pending']+snap['inflight']:
        errors.append('Queue accounting mismatch')
    if failed!=len(failures):errors.append('Failure accounting mismatch')
    fault_path=output/'faults.jsonl'
    faults=[json.loads(line) for line in fault_path.read_text().splitlines()] if fault_path.exists() else []
    recovery=workers.snapshot() if workers else {}
    if args.fault=='combined' and (len(faults)!=2 or recovery.get('restarts')!=2):
        errors.append('Planned fault/restart sequence incomplete')
    if not closed:errors.append('Child not confirmed reaped')
    summary=dict(schema='intelligent-dvr.private-supervised-replay.v1',cameras=args.cameras,workers=4,
        mode=args.fault,physical_recordings=len(clips),seconds=seconds,offered=offered,completed=completed,
        results_per_second=completed/seconds if seconds else 0,drained_after_stop=len(drained),replaced=replaced,
        stale=stale,budget_dropped=dropped,failed=failed,pending=snap['pending'],inflight=snap['inflight'],
        active_decoders=sum(r['active'] for r in state),decoded_frames=sum(r['frames'] for r in state),
        errors=errors,source_errors=[r for r in state if r['errors']],process=recovery,faults=faults,
        sample_p50_ms=quantile([r['milliseconds'] for r in results],.5),
        sample_p95_ms=quantile([r['milliseconds'] for r in results],.95),
        completion_age_p95_ms=quantile([r['completion_age_ms'] for r in results],.95),
        min_available_bytes=min((m['available_bytes'] for m in monitor),default=None),
        max_combined_rss_bytes=max((m['parent_rss_bytes']+m['child_rss_bytes'] for m in monitor),default=None),
        scheduler=snap,terminal_outcomes_unique_and_ordered=True,
        scope='100 virtual offline streams cycling 30 verified public recordings; optional process isolation. Network denied. Software fault injection with CUDA sessions live; no physical-camera, recording durability or field accuracy qualification.')
    summary['durable_return_age_p50_ms']=quantile([r['durable_return_age_ms'] for r in results],.5)
    summary['durable_return_age_p95_ms']=quantile([r['durable_return_age_ms'] for r in results],.95)
    summary['durable_return_age_max_ms']=max([r['durable_return_age_ms'] for r in results],default=None)
    summary['post_worker_return_gap_p50_ms']=quantile([r['post_worker_return_gap_ms'] for r in results],.5)
    summary['post_worker_return_gap_p95_ms']=quantile([r['post_worker_return_gap_ms'] for r in results],.95)
    summary['post_worker_return_gap_max_ms']=max([r['post_worker_return_gap_ms'] for r in results],default=None)
    summary['return_clock_order_valid']=all(r['durable_return_age_ms']>=r['completion_age_ms'] and r['post_worker_return_gap_ms']>=0 and r['journal_id'] is not None for r in results+drained)
    summary['controller_elapsed_seconds']=controller_elapsed
    summary['requested_post_step_sleep_ms']=args.poll_pause_ms
    summary['controller_step_starts_in_window']=step_starts
    summary['journal_enabled']=journal_enabled
    summary['profiling_enabled']=timings is not None
    summary['profile']=workers.profile_snapshot()
    if journal is not None:
        tail=journal.pending(1000)
        if tail:
            ids=[r['id'] for r in tail];assert not(set(ids)&delivery_ids)
            assert all(r['status']=='succeeded' and r['token'] in seen for r in tail)
            delivery_ids.update(ids);journal.acknowledge(ids);acknowledged+=len(ids)
        summary['sqlite_settings']={name:journal._db.execute('PRAGMA '+name).fetchone()[0] for name in ('journal_mode','synchronous','wal_autocheckpoint','user_version')}
        summary['journal']=journal.snapshot()
        summary['delivery']=dict(unique_ids=len(delivery_ids),acknowledged=acknowledged,pruned=pruned,peak_entries=peak_journal_entries)
        assert acknowledged==completed+len(drained) and journal.snapshot()['unacknowledged']==0
        journal.close()
    assert not recovery['journal_error']
    for name,value in [('summary',summary),('trace',results),('drained',drained),('failures',failures),
                       ('resources',monitor),('gpu',gpu),('sources',state)]:
        (output/(name+'.json')).write_text(json.dumps(value,indent=2)+'\n')
    print(json.dumps({k:v for k,v in summary.items() if k not in ('process','scheduler')},indent=2),flush=True)
    return 0 if not errors and not summary['source_errors'] and summary['active_decoders']==args.cameras else 2


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--label',choices=('final',),default='');p.add_argument('--cameras',type=int,choices=(100,),default=100)
    p.add_argument('--seconds',type=int,choices=(30,120,600),default=30)
    p.add_argument('--fault',choices=('none','combined'),default='none')
    p.add_argument('--poll-pause-ms',type=float,choices=(.5,2.),default=.5)
    sys.exit(run(p.parse_args()))
