import test from 'node:test';
import assert from 'node:assert/strict';
import {startCoverageTask, COVERAGE_TASK_SCHEMA, COVERAGE_TIMEOUT_MS} from '../src/facility-coverage-task.mjs';

function harness(overrides={}) {
  const received=[],errors=[],timers=new Map(),cleared=[];
  const worker={messages:[],terminated:0,
    postMessage(message){this.messages.push(message);}, terminate(){this.terminated++;}};
  const cancel=startCoverageTask({plan:{name:'Current plan'},onResult:r=>received.push(r),onError:e=>errors.push(e),
    createWorker:()=>worker,setTimer:(fn,ms)=>{timers.set(7,{fn,ms});return 7;},
    clearTimer:id=>{cleared.push(id);timers.delete(id);},...overrides});
  return {worker,cancel,received,errors,timers,cleared};
}
const result=(worker,metrics={cameras:0,zones:[],route:null})=>({data:{
  schema:COVERAGE_TASK_SCHEMA,id:worker.messages[0].id,type:'result',metrics}});

test('coverage task binds its request, terminates after one response, and clears the deadline',()=>{
  const h=harness(), callback=h.worker.onmessage;
  assert.equal(h.worker.messages.length,1);assert.equal(h.worker.messages[0].schema,COVERAGE_TASK_SCHEMA);
  assert.deepEqual(h.worker.messages[0].plan,{name:'Current plan'});
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
  const fresh=harness({plan:{name:'New draft'}});
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
  const plan={cameras:[{enabled:true}],zones:[{id:'z',enabled:true}]};
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
