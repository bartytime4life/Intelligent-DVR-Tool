import test from 'node:test';
import assert from 'node:assert/strict';
import {createPeopleOperations, initialPeopleState, verifiedPeople} from '../src/people-operation.mjs';
import {analysisJSON} from '../src/training-analysis.mjs';

const person = {id:'a'.repeat(16), name:'Generated Person', created:'2026-11-09T12:00:00+00:00', views:6, baseline:null};
const service = {token:'generated-token', people:{enabled:true}};
const deferred = () => {let resolve, reject; const promise = new Promise((yes,no) => {resolve=yes; reject=no;}); return {promise,resolve,reject};};
function fixture(request) {
  let state = initialPeopleState(), changes = 0;
  const operations = createPeopleOperations(value => {state=value; changes++;}, {request});
  return {operations, get state(){return state;}, get changes(){return changes;}};
}

test('people summaries require complete, unique identities before replacing a verified list', () => {
  assert.deepEqual(verifiedPeople({people:[person]}), [person]);
  for (const value of [{}, {people:null}, {people:[person,person]}, {people:[{...person,id:'bad'}]},
    {people:[{...person,created:null}]}, {people:[{...person,name:'bad\nname'}]},
    {people:[{...person,views:-1}]}, {people:[{...person,baseline:{usable:2,matched:3,rate:1}}]}])
    assert.throws(() => verifiedPeople(value), /could not be verified/);
  assert.deepEqual(verifiedPeople({people:[]}), []);
});

test('an initial malformed reply stays unknown rather than becoming an empty enrolled list', async () => {
  const f=fixture(async () => ({})); await f.operations.load(service);
  assert.equal(f.state.people,null); assert.match(f.state.error,/could not be refreshed/);
  assert.equal(f.state.loading,false); f.operations.close();
});

test('late older lists and errors cannot replace the newest verified list', async () => {
  const reads=[]; const f=fixture(() => {const read=deferred(); reads.push(read); return read.promise;});
  const first=f.operations.load(service), second=f.operations.load(service);
  reads[1].resolve({people:[person]}); await second;
  reads[0].resolve({people:[]}); await first;
  assert.deepEqual(f.state.people,[person]); assert.equal(f.state.error,'');
  const third=f.operations.load(service), fourth=f.operations.load(service);
  reads[3].resolve({people:[person]}); await fourth;
  reads[2].reject(Error('older connection failed')); await third;
  assert.deepEqual(f.state.people,[person]); assert.equal(f.state.error,'');
  const fifth=f.operations.load(service); reads[4].resolve({people:[{}]}); await fifth;
  assert.deepEqual(f.state.people,[person]); assert.match(f.state.error,/could not be verified/);
  f.operations.close();
});

test('deletion is single-flight across rows and needs the matching acknowledgement plus refreshed absence', async () => {
  const pending=deferred(); let deletes=0, reads=0;
  const f=fixture(async (path,options) => {
    if(options.method==='POST') {deletes++; assert.deepEqual(options.body,{}); return pending.promise;}
    return {people:reads++ ? [] : [person,{...person,id:'b'.repeat(16)}]};
  });
  await f.operations.load(service);
  const removal=f.operations.remove(person,service);
  assert.equal(await f.operations.remove(person,service),false);
  assert.equal(await f.operations.remove({...person,id:'b'.repeat(16)},service),false);
  assert.equal(await f.operations.load(service),false);
  assert.equal(f.state.deleting,person.id); assert.equal(deletes,1);
  pending.resolve({deleted:person.id}); assert.equal(await removal,true);
  assert.deepEqual(f.state.people,[]); assert.deepEqual(f.state.blocked,[]);
  assert.match(f.state.notice,/was deleted/); assert.equal(f.state.deleting,null);
  f.operations.close();
});

for (const failure of ['lost','500','malformed','wrong-id']) test(`${failure} deletion reply never treats list omission as proof of file removal`, async () => {
  let reads=0;
  const f=fixture(async (path,options) => {
    if(options.method==='POST') {
      if(failure==='lost') throw Error('Reply lost');
      if(failure==='500') throw Object.assign(Error('Storage failure'),{status:500});
      return failure==='wrong-id' ? {deleted:'f'.repeat(16)} : {};
    }
    return {people:reads++ ? [] : [person]};
  });
  await f.operations.load(service); assert.equal(await f.operations.remove(person,service),false);
  assert.match(f.state.notice,/could not be confirmed/); assert.match(f.state.notice,/absent entry alone does not prove/);
  assert.ok(f.state.blocked.includes(person.id)); f.operations.close();
});

test('a confirmed deletion with failed refresh blocks its stale row until a successful read confirms absence', async () => {
  let reads=0, deletes=0;
  const f=fixture(async (path,options) => {
    if(options.method==='POST') {deletes++; return {deleted:person.id};}
    if(reads++===0) return {people:[person]};
    if(reads===2) throw Error('Generated refresh failure');
    return {people:[]};
  });
  await f.operations.load(service); assert.equal(await f.operations.remove(person,service),false);
  assert.deepEqual(f.state.people,[person]); assert.deepEqual(f.state.blocked,[person.id]);
  assert.equal(await f.operations.remove(person,service),false); assert.equal(deletes,1);
  await f.operations.load(service);
  assert.deepEqual(f.state.people,[]); assert.deepEqual(f.state.blocked,[]); assert.match(f.state.notice,/was deleted/);
  f.operations.close();
});

test('closing during a submitted delete never publishes a late result or starts a reconciliation request', async () => {
  const pending=deferred(); let reads=0;
  const f=fixture(async (path,options) => options.method==='POST' ? pending.promise : (reads++,{people:[person]}));
  await f.operations.load(service); const removing=f.operations.remove(person,service);
  f.operations.close(); const changes=f.changes;
  pending.resolve({deleted:person.id}); await removing;
  assert.equal(f.changes,changes); assert.equal(reads,1);
});

test('a later successful deletion never erases an earlier unresolved deletion warning', async () => {
  const another={...person,id:'b'.repeat(16)}; let listed=[person,another];
  const f=fixture(async(path,options)=>{
    if(options.method==='POST') {
      listed=listed.filter(p=>!path.includes(p.id));
      if(path.includes(person.id)) throw Error('Generated lost deletion reply');
      return {deleted:another.id};
    }
    return {people:listed};
  });
  await f.operations.load(service);await f.operations.remove(person,service);
  await f.operations.remove(another,service);
  assert.match(f.state.notice,/was deleted/);
  assert.match(f.state.unresolved[person.id],/could not be confirmed/);
  assert.equal(f.state.unresolved[another.id],undefined);f.operations.close();
});

test('a stalled deletion reaches its deadline, reconciles read-only and keeps the row blocked', {timeout:1000}, async () => {
  const keepAlive=setTimeout(()=>{},900); let posts=0;
  const f=fixture((path,options) => analysisJSON(path,{...options,timeout:20,fetcher:async (url,request) => {
    if(request.method==='POST') {posts++; return {ok:true,json:()=>new Promise(()=>{})};}
    return {ok:true,json:async()=>({people:[person]})};
  }}));
  try {
    await f.operations.load(service); assert.equal(await f.operations.remove(person,service),false);
    assert.equal(f.state.deleting,null); assert.ok(f.state.blocked.includes(person.id));
    assert.match(f.state.notice,/could not be confirmed/); assert.equal(posts,1);
  } finally {f.operations.close(); clearTimeout(keepAlive);}
});
