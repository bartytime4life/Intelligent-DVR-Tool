import test from 'node:test';
import assert from 'node:assert/strict';
import {startCoverageTask, COVERAGE_TASK_SCHEMA, COVERAGE_TIMEOUT_MS} from '../src/facility-coverage-task.mjs';
import {acceptVisibilitySnapshot,VISIBILITY_SNAPSHOT_METHOD} from '../src/facility-visibility-protocol.mjs';

const work=()=>({edges:0,operations:0,inputVertices:0,outputVertices:0,peakVertices:0});
function sourceSnapshot(plan) {
  const snapshot={method:VISIBILITY_SNAPSHOT_METHOD,estimated:true,work:work(),cacheHits:0,
    cameras:plan.cameras.map(c=>({id:c.id,method:VISIBILITY_SNAPSHOT_METHOD,estimated:true,polygons:[],rangeChordError:0,work:work()}))};
  assert.equal(acceptVisibilitySnapshot(snapshot,plan),true);return snapshot;
}

function harness(overrides={}) {
  const received=[],errors=[],timers=new Map(),cleared=[];
  const worker={messages:[],terminated:0,
    postMessage(message){this.messages.push(message);}, terminate(){this.terminated++;}};
  const plan=overrides.plan || {name:'Current plan',cameras:[]},snapshot=sourceSnapshot(plan);
  const cancel=startCoverageTask({plan,snapshot,onResult:r=>received.push(r),onError:e=>errors.push(e),
    createWorker:()=>worker,setTimer:(fn,ms)=>{timers.set(7,{fn,ms});return 7;},
    clearTimer:id=>{cleared.push(id);timers.delete(id);},...overrides});
  return {worker,cancel,received,errors,timers,cleared};
}
const result=(worker,metrics={cameras:0,zones:[],route:null})=>({data:{
  schema:COVERAGE_TASK_SCHEMA,id:worker.messages[0].id,type:'result',metrics}});

test('coverage task binds its request, terminates after one response, and clears the deadline',()=>{
  const h=harness(), callback=h.worker.onmessage;
  assert.equal(h.worker.messages.length,1);assert.equal(h.worker.messages[0].schema,COVERAGE_TASK_SCHEMA);
  assert.deepEqual(h.worker.messages[0].plan,{name:'Current plan',cameras:[]});
  assert.equal(h.worker.messages[0].snapshot.method,VISIBILITY_SNAPSHOT_METHOD);
  assert.equal(h.timers.get(7).ms,COVERAGE_TIMEOUT_MS);
  callback(result(h.worker));callback(result(h.worker));
  assert.deepEqual(h.received,[{cameras:0,zones:[],route:null}]);assert.deepEqual(h.errors,[]);
  assert.equal(h.worker.terminated,1);assert.deepEqual(h.cleared,[7]);
});
test('another request cannot satisfy a pending coverage task',()=>{
  const h=harness(), reply=result(h.worker);reply.data.id++;
  h.worker.onmessage(reply);assert.deepEqual(h.received,[]);assert.equal(h.worker.terminated,0);
  h.worker.onmessage(result(h.worker));assert.equal(h.received.length,1);
});
test('superseding a coverage task closes queued responses and errors before starting its successor',()=>{
  const old=harness(), late=old.worker.onmessage, lateError=old.worker.onerror, oldTimeout=old.timers.get(7).fn;
  old.cancel();old.cancel();
  const fresh=harness({plan:{name:'New draft',cameras:[]}});
  assert.notEqual(old.worker.messages[0].id,fresh.worker.messages[0].id);
  late(result(old.worker));lateError({preventDefault(){}});oldTimeout();
  fresh.worker.onmessage(result(fresh.worker));
  assert.deepEqual(old.received,[]);assert.deepEqual(old.errors,[]);assert.equal(old.worker.terminated,1);
  assert.equal(fresh.received.length,1);
});
test('coverage deadline terminates work and rejects late success without inventing metrics',()=>{
  const h=harness(), late=h.worker.onmessage;
  h.timers.get(7).fn();late(result(h.worker));
  assert.equal(h.worker.terminated,1);assert.deepEqual(h.received,[]);
  assert.match(h.errors[0],/took too long/);assert.equal(h.errors.length,1);
});
test('a result past the monotonic deadline is refused even before a delayed timer callback runs',()=>{
  let time=0;const h=harness({now:()=>time});
  time=COVERAGE_TIMEOUT_MS;h.worker.onmessage(result(h.worker));
  assert.deepEqual(h.received,[]);assert.match(h.errors[0],/took too long/);assert.equal(h.worker.terminated,1);
});
test('a successful reply cannot turn null or missing zone numbers into displayed zero',()=>{
  const plan={cameras:[{id:'C1',enabled:true,x:0,y:0,range:50}],zones:[{id:'z',enabled:true}]};
  const valid={cameras:1,route:null,zones:[{id:'z',estimated:true,method:'polygon-area-v1',area:1,
    coveredArea:0,overlapArea:0,uncoveredArea:1,coverage:0,overlap:0,blindSpots:[]}]};
  const good=harness({plan});good.worker.onmessage(result(good.worker,valid));assert.equal(good.received.length,1);
  for(const change of [r=>r.zones[0].coverage=null,r=>delete r.zones[0].overlap,
    r=>r.zones[0].id='previous-zone',r=>r.zones[0].estimated=false,r=>r.zones[0].blindSpots=null,
    r=>r.zones[0].coverage=Infinity,r=>r.zones=[],r=>r.cameras=-1]) {
    const h=harness({plan}),bad=structuredClone(valid);change(bad);h.worker.onmessage(result(h.worker,bad));
    assert.deepEqual(h.received,[]);assert.equal(h.errors.length,1);assert.equal(h.worker.terminated,1);
  }
});
test('worker errors and unreadable messages remain recoverable, with no numeric fallback',()=>{
  for(const kind of ['onerror','onmessageerror']){
    const h=harness();let prevented=false;
    h.worker[kind]({preventDefault(){prevented=true;}});
    assert.equal(h.errors.length,1);assert.deepEqual(h.received,[]);assert.equal(h.worker.terminated,1);
    if(kind==='onerror')assert.equal(prevented,true);
  }
});
test('malformed or error replies close the task instead of displaying incomplete metrics',()=>{
  for(const mutation of [data=>data.schema='old',data=>data.type='error',data=>data.metrics={},data=>data.metrics.cameras=NaN]){
    const h=harness(),reply=result(h.worker);mutation(reply.data);h.worker.onmessage(reply);
    assert.equal(h.errors.length,1);assert.deepEqual(h.received,[]);assert.equal(h.worker.terminated,1);
  }
});
test('worker creation and post failures settle the task without an orphan deadline',()=>{
  const created=harness({createWorker(){throw new Error('unavailable');}});
  assert.equal(created.errors.length,1);assert.deepEqual(created.received,[]);assert.equal(created.timers.size,0);
  const broken={terminate(){this.stopped=true;},postMessage(){throw new Error('clone failed');}};
  const sent=harness({createWorker:()=>broken});
  assert.equal(sent.errors.length,1);assert.equal(broken.stopped,true);assert.equal(sent.timers.size,0);
});
test('cleanup stays closed even when worker termination itself throws',()=>{
  const broken={postMessage(message){this.message=message;},terminate(){throw new Error('already gone');}};
  const h=harness({createWorker:()=>broken});h.cancel();
  broken.onmessage({data:{schema:COVERAGE_TASK_SCHEMA,id:broken.message.id,type:'result',metrics:{zones:[],cameras:0}}});
  assert.deepEqual(h.received,[]);assert.deepEqual(h.errors,[]);assert.equal(h.timers.size,0);
});

test('coverage refuses missing, unaccepted or different-plan visibility before creating a worker',()=>{
  const oldPlan={cameras:[]},old=sourceSnapshot(oldPlan),current={cameras:[]};
  for (const snapshot of [undefined,structuredClone(old),old]) {
    let created=0;const errors=[];
    const stop=startCoverageTask({plan:current,snapshot,onResult(){assert.fail('No metrics without bound visibility');},
      onError:error=>errors.push(error),createWorker(){created++;throw Error('Should not create');}});
    assert.equal(created,0);assert.equal(errors.length,1);assert.match(errors[0],/not ready/);stop();
  }
});

test('unknown visibility preserves null zone/route metrics and refuses fabricated numeric totals',()=>{
  const plan={cameras:[{id:'C1',x:0,y:0,range:50,enabled:true}],zones:[{id:'z',enabled:true}],route:[[0,7],[0,9]]};
  const snapshot={method:VISIBILITY_SNAPSHOT_METHOD,estimated:false,work:work(),cacheHits:0,
    cameras:[{id:'C1',method:VISIBILITY_SNAPSHOT_METHOD,estimated:false,reason:'geometry-limit',polygons:null,work:work()}]};
  assert.equal(acceptVisibilitySnapshot(snapshot,plan),true);
  const metrics={cameras:0,zones:[{id:'z',estimated:false,estimateReason:'visibility-unavailable',
    area:null,coveredArea:null,overlapArea:null,uncoveredArea:null,coverage:null,overlap:null,blindSpots:null}],
    route:{method:'arclength-intervals-v1',estimated:false,estimateReason:'visibility-unavailable',length:2,
      coveredLength:null,overlapLength:null,uncoveredLength:null,longestBlindStretch:null,coverage:null,overlap:null}};
  const good=harness({plan,snapshot});good.worker.onmessage(result(good.worker,metrics));assert.equal(good.received.length,1);
  for(const change of [r=>r.route.coverage=0,r=>r.route=null,r=>r.zones[0].coverage=0,r=>r.zones[0].estimated=true]) {
    const h=harness({plan,snapshot}),bad=structuredClone(metrics);change(bad);h.worker.onmessage(result(h.worker,bad));
    assert.equal(h.received.length,0);assert.equal(h.errors.length,1);
  }
});

test('successful route metrics require finite consistent lengths and an actual source route',()=>{
  const plan={cameras:[],route:[[0,0],[0,2]]},metrics={cameras:0,zones:[],route:{method:'arclength-intervals-v1',estimated:true,
    length:2,coveredLength:0,overlapLength:0,uncoveredLength:2,longestBlindStretch:2,coverage:0,overlap:0}};
  const good=harness({plan});good.worker.onmessage(result(good.worker,metrics));assert.equal(good.received.length,1);
  for (const change of [r=>r.route.coverage=null,r=>r.route.coveredLength=Infinity,r=>r.route.longestBlindStretch=3,
    r=>delete r.route.estimated,r=>r.route=null]) {
    const h=harness({plan}),bad=structuredClone(metrics);change(bad);h.worker.onmessage(result(h.worker,bad));
    assert.equal(h.received.length,0);assert.equal(h.errors.length,1);
  }
});

test('actual coverage worker uses the supplied low-wall hole snapshot without recomputing a legacy fan',async()=>{
  const previous=globalThis.self,messages=[];
  globalThis.self={postMessage:value=>messages.push(value)};
  try {
    const {blankFacility,validateFacility}=await import('../src/facility.mjs');
    const {planVisibility}=await import('../src/facility-visibility.mjs');
    const rect=(a,b,c,d)=>[[a,b],[c,b],[c,d],[a,d],[a,b]];
    const camera={id:'C1',name:'C1',x:0,y:0,z:4,bearing:0,tilt:30,hfov:90,vfov:60,range:50,enabled:true};
    const plan=validateFacility({...blankFacility(),cameras:[camera],buildings:[{id:'b',name:'Low wall',footprint:rect(-2,5,2,6),height:2,floors:1}],
      zones:[{id:'z',name:'Shadowed zone',footprint:rect(-.5,7,.5,9),type:'restricted',dwellSeconds:0,expectedClasses:['person'],enabled:true}],route:[[0,7],[0,9]]});
    const snapshot=planVisibility(plan);assert.equal(acceptVisibilitySnapshot(snapshot,plan),true);
    await import('../src/facility-coverage-worker.mjs?generated-coverage-snapshot-test');
    self.onmessage({data:{schema:COVERAGE_TASK_SCHEMA,id:19,plan,snapshot:structuredClone(snapshot)}});
    assert.equal(messages.length,1);assert.equal(messages[0].type,'result');
    assert.equal(messages[0].metrics.zones[0].coverage,0);assert.equal(messages[0].metrics.route.coverage,0);
    const delivered=harness({plan,snapshot});delivered.worker.onmessage(result(delivered.worker,messages[0].metrics));
    assert.equal(delivered.received.length,1);
    self.onmessage({data:{schema:COVERAGE_TASK_SCHEMA,id:20,plan,snapshot:null}});assert.equal(messages[1].type,'error');
  } finally {if(previous===undefined)delete globalThis.self;else globalThis.self=previous;}
});
