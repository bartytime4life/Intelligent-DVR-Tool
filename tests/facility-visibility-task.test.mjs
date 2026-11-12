import test from 'node:test';
import assert from 'node:assert/strict';
import {startVisibilityTask,VISIBILITY_TASK_SCHEMA,VISIBILITY_TIMEOUT_MS} from '../src/facility-visibility-task.mjs';
import {acceptVisibilitySnapshot,validVisibilitySnapshot,visibilitySnapshotMatches,VISIBILITY_SNAPSHOT_METHOD} from '../src/facility-visibility-protocol.mjs';

const work=()=>({edges:0,operations:0,inputVertices:0,outputVertices:0,peakVertices:0});
const camera={id:'C1',name:'C1',x:0,y:0,z:4,bearing:0,tilt:30,hfov:90,vfov:60,range:50,enabled:true};
const plan=()=>({name:'Generated current plan',cameras:[{...camera}],buildings:[],rooms:[],doorways:[],route:[]});
const ring=()=>[[0,3],[1,3],[1,4],[0,4],[0,3]];
const snapshot=source=>({method:VISIBILITY_SNAPSHOT_METHOD,estimated:true,work:work(),cacheHits:0,
  cameras:source.cameras.map(c=>({id:c.id,method:VISIBILITY_SNAPSHOT_METHOD,estimated:true,polygons:c.enabled?[[ring()]]:[],rangeChordError:.004,work:work()}))});
function harness(overrides={}) {
  const source=overrides.plan || plan(),received=[],errors=[],timers=new Map(),cleared=[];
  const worker={messages:[],terminated:0,postMessage(message){this.messages.push(message);},terminate(){this.terminated++;}};
  const cancel=startVisibilityTask({plan:source,onResult:r=>received.push(r),onError:e=>errors.push(e),createWorker:()=>worker,
    setTimer:(fn,ms)=>{timers.set(7,{fn,ms});return 7;},clearTimer:id=>{cleared.push(id);timers.delete(id);},...overrides});
  return {plan:source,worker,cancel,received,errors,timers,cleared};
}
const result=(h,value=snapshot(h.plan))=>({data:{schema:VISIBILITY_TASK_SCHEMA,id:h.worker.messages[0].id,type:'result',snapshot:value}});

test('visibility task accepts one complete reply, freezes it and binds its exact plan source',()=>{
  const h=harness(),callback=h.worker.onmessage,reply=result(h);
  assert.equal(h.worker.messages.length,1);assert.equal(h.worker.messages[0].plan,h.plan);
  assert.equal(h.worker.messages[0].schema,VISIBILITY_TASK_SCHEMA);assert.equal(h.timers.get(7).ms,VISIBILITY_TIMEOUT_MS);
  callback(reply);callback(reply);
  assert.deepEqual(h.received,[reply.data.snapshot]);assert.deepEqual(h.errors,[]);assert.equal(h.worker.terminated,1);assert.deepEqual(h.cleared,[7]);
  assert.equal(visibilitySnapshotMatches(h.received[0],h.plan),true);
  assert.equal(visibilitySnapshotMatches(h.received[0],structuredClone(h.plan)),false);
  assert.throws(()=>{h.received[0].cameras[0].polygons[0][0][0][0]=4;},TypeError);
});

test('reply identity, cancellation and changed-plan successors close every queued old callback',()=>{
  const old=harness(),late=old.worker.onmessage,lateError=old.worker.onerror,timeout=old.timers.get(7).fn;
  const unrelated=result(old);unrelated.data.id++;late(unrelated);assert.equal(old.worker.terminated,0);
  old.cancel();old.cancel();
  const nextPlan=plan();nextPlan.cameras[0].x=10;
  const fresh=harness({plan:nextPlan});assert.notEqual(old.worker.messages[0].id,fresh.worker.messages[0].id);
  const ignored=result(old);late(ignored);lateError({preventDefault(){}});timeout();
  assert.equal(visibilitySnapshotMatches(ignored.data.snapshot,old.plan),false);
  assert.deepEqual(old.received,[]);assert.deepEqual(old.errors,[]);assert.equal(old.worker.terminated,1);
  const freshReply=result(fresh);freshReply.data.snapshot.cameras[0].polygons=[[[[10,3],[11,3],[11,4],[10,4],[10,3]]]];
  fresh.worker.onmessage(freshReply);assert.equal(fresh.received.length,1);assert.equal(visibilitySnapshotMatches(fresh.received[0],nextPlan),true);
});

test('timer and monotonic deadline both refuse late geometry without binding it',()=>{
  for (const delayedTimer of [false,true]) {
    let time=0;const h=harness({now:()=>time}),reply=result(h);
    if (delayedTimer) time=VISIBILITY_TIMEOUT_MS;
    else h.timers.get(7).fn();
    h.worker.onmessage(reply);
    assert.deepEqual(h.received,[]);assert.equal(h.errors.length,1);assert.match(h.errors[0],/took too long/);
    assert.equal(h.worker.terminated,1);assert.equal(visibilitySnapshotMatches(reply.data.snapshot,h.plan),false);
  }
});

test('validation time counts against the monotonic acceptance deadline',()=>{
  let reads=0;
  const h=harness({now:()=>++reads>=3 ? VISIBILITY_TIMEOUT_MS : 0}),reply=result(h);
  h.worker.onmessage(reply);
  assert.deepEqual(h.received,[]);assert.match(h.errors[0],/took too long/);
  assert.equal(visibilitySnapshotMatches(reply.data.snapshot,h.plan),false);
});

test('partial geometry is a ready bound snapshot with explicit unknown camera, never an empty successful view',()=>{
  const h=harness(),reply=result(h),value=reply.data.snapshot;
  value.estimated=false;Object.assign(value.cameras[0],{estimated:false,reason:'geometry-limit',polygons:null});
  delete value.cameras[0].rangeChordError;
  h.worker.onmessage(reply);
  assert.equal(h.received[0],value);assert.deepEqual(h.errors,[]);assert.equal(value.estimated,false);
  assert.equal(visibilitySnapshotMatches(value,h.plan),true);
});

test('malformed geometry, stale IDs, nonfinite coordinates and null success cannot cross the visibility reply gate',()=>{
  const mutations=[
    s=>s.method='legacy',s=>s.estimated=false,s=>s.cameras=[],s=>s.cameras[0].id='old-camera',
    s=>s.cameras[0].polygons=null,s=>s.cameras[0].polygons=[ring()],s=>s.cameras[0].polygons=[[]],
    s=>s.cameras[0].polygons[0][0][0][0]=NaN,s=>s.cameras[0].polygons[0][0][1][1]=Infinity,
    s=>s.cameras[0].polygons[0][0][1][0]=500,s=>s.cameras[0].polygons[0][0].pop(),
    s=>s.cameras[0].polygons[0][0].reverse(),s=>s.cameras[0].polygons=[[[[0,3],[1,4],[0,4],[1,3],[0,3]]]],
    s=>s.cameras[0].polygons[0].push([[10,3],[10,3.5],[10.5,3.5],[10.5,3],[10,3]]),
    s=>s.cameras[0].rangeChordError=null,s=>s.work.operations=-1,s=>s.cacheHits=1.5,
  ];
  for (const mutate of mutations) {
    const h=harness(),reply=result(h);mutate(reply.data.snapshot);h.worker.onmessage(reply);
    assert.deepEqual(h.received,[]);assert.equal(h.errors.length,1);assert.equal(h.worker.terminated,1);
    assert.equal(visibilitySnapshotMatches(reply.data.snapshot,h.plan),false);
  }
});

test('disabled views stay successful empty and unknown views cannot fabricate numeric success',()=>{
  const p=plan();p.cameras[0].enabled=false;
  const value=snapshot(p);assert.equal(validVisibilitySnapshot(value,p),true);
  value.cameras[0].polygons=[[ring()]];assert.equal(validVisibilitySnapshot(value,p),false);
  Object.assign(value.cameras[0],{estimated:false,polygons:null,reason:'geometry-limit'});value.estimated=false;
  assert.equal(validVisibilitySnapshot(value,p),false);
  const fresh=plan(),unknown=snapshot(fresh);unknown.estimated=false;Object.assign(unknown.cameras[0],{estimated:false,polygons:[],reason:'geometry-error'});
  assert.equal(validVisibilitySnapshot(unknown,fresh),false);
});

test('camera-count and per-camera wire budgets reject oversized results before walking coordinates',()=>{
  const h=harness(),reply=result(h);reply.data.snapshot.cameras[0].polygons=[[new Array(65_537).fill([0,3])]];
  h.worker.onmessage(reply);assert.equal(h.received.length,0);assert.equal(h.errors.length,1);
  const p=plan();p.cameras=Array.from({length:501},(_,i)=>({...camera,id:'C'+i}));
  assert.equal(validVisibilitySnapshot(snapshot(p),p),false);
});

test('shared cached geometry can serve500 distinct camera IDs without multiplying geometry work or losing binding',()=>{
  const p=plan();p.cameras=Array.from({length:500},(_,i)=>({...camera,id:'C'+i}));
  const value=snapshot(p),shared=[[ring()]];for(const view of value.cameras)view.polygons=shared;
  value.cacheHits=499;assert.equal(acceptVisibilitySnapshot(value,p),true);
  assert.equal(value.cameras[0].polygons,value.cameras.at(-1).polygons);assert.equal(visibilitySnapshotMatches(value,p),true);
});

test('worker failures, malformed messages and clone failures remain recoverable without orphan deadlines',()=>{
  for (const mode of ['onerror','onmessageerror','bad-schema','error']) {
    const h=harness();
    if (mode.startsWith('on')) h.worker[mode]({preventDefault(){}});
    else {const reply=result(h);if(mode==='bad-schema')reply.data.schema='old';else reply.data.type='error';h.worker.onmessage(reply);}
    assert.equal(h.errors.length,1);assert.deepEqual(h.received,[]);assert.equal(h.worker.terminated,1);assert.equal(h.timers.size,0);
  }
  const missing=harness({createWorker(){throw Error('unsupported');}});assert.equal(missing.errors.length,1);assert.equal(missing.timers.size,0);
  const worker={terminate(){throw Error('gone');},postMessage(){throw Error('clone');}};
  const failed=harness({createWorker:()=>worker});assert.equal(failed.errors.length,1);assert.equal(failed.timers.size,0);
});

test('actual visibility worker returns source-ordered generated geometry through the validated protocol',async()=>{
  const previous=globalThis.self,messages=[];
  globalThis.self={postMessage:value=>messages.push(value)};
  try {
    await import('../src/facility-visibility-worker.mjs?generated-visibility-worker-test');
    const p=plan();p.cameras.push({...camera,id:'C2',enabled:false});
    self.onmessage({data:{schema:VISIBILITY_TASK_SCHEMA,id:17,plan:p}});
    assert.equal(messages.length,1);assert.equal(messages[0].type,'result');assert.equal(messages[0].id,17);
    assert.equal(validVisibilitySnapshot(messages[0].snapshot,p),true);
    assert.deepEqual(messages[0].snapshot.cameras.map(c=>c.id),['C1','C2']);
    assert.deepEqual(messages[0].snapshot.cameras[1].polygons,[]);
  } finally { if(previous===undefined)delete globalThis.self;else globalThis.self=previous; }
});
