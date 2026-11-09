import test from 'node:test';
import assert from 'node:assert/strict';
import {blankFacility} from '../src/facility.mjs';
import {LIBRARY_KEY, LEGACY_KEY, createLibrary, replaceActive, parseFacilityFile, validateLibrary, MAX_LIBRARY_BYTES} from '../src/facility-library.mjs';
import {createFacilitySave,facilityCopyDownload} from '../src/facility-save.mjs';
import {workspaceBackupKey} from '../src/workspace-save.mjs';

function harness(entries = {}) {
  const values = new Map(Object.entries(entries));
  const storage = {getItem:key=>values.get(key) ?? null, setItem:(key,value)=>values.set(key,value), removeItem:key=>values.delete(key)};
  let tail = Promise.resolve();
  const withLock = work => { const result = tail.then(work); tail = result.catch(()=>{}); return result; };
  return {values,storage,withLock,session:options=>createFacilitySave(storage,{withLock,...options})};
}
const rename = (session,name) => session.update(replaceActive(session.snapshot().library,{...blankFacility(),name}));
const names = session => session.snapshot().library.facilities.map(f=>f.plan.name);
const backups = h => [...h.values].filter(([key])=>key.startsWith(`${LIBRARY_KEY}.conflict-backup.`)).map(([,raw])=>JSON.parse(raw).raw);

test('queued facility edits save the latest complete collection under a shared lock',async()=>{
  const h=harness(), session=h.session();
  await session.flush();
  let release;const barrier=new Promise(resolve=>{release=resolve;});
  const block=h.withLock(()=>barrier);
  rename(session,'First');const first=session.flush();
  rename(session,'Latest');const latest=session.flush();
  assert.equal(session.snapshot().saved,false);assert.equal(session.snapshot().pending,true);
  release();await Promise.all([block,first,latest]);
  assert.equal(JSON.parse(h.values.get(LIBRARY_KEY)).facilities[0].plan.name,'Latest');
  assert.equal(session.snapshot().saved,true);
});

test('concurrent tabs cannot overwrite a shared baseline and either choice preserves the other version',async()=>{
  for(const choice of ['keepLocal','useRemote']) {
    const h=harness(), a=h.session();await a.flush();const b=h.session();
    rename(a,'Other tab');rename(b,'This tab');
    await Promise.all([a.flush(),b.flush()]);
    assert.equal(b.snapshot().saved,false);assert.equal(b.snapshot().conflict.remoteValue.facilities[0].plan.name,'Other tab');
    assert.equal(await b.snapshot().conflict[choice](),true);
    assert.deepEqual(names(b),[choice==='keepLocal'?'This tab':'Other tab']);
    assert.equal(JSON.parse(backups(h)[0]).facilities[0].plan.name,choice==='keepLocal'?'Other tab':'This tab');
    assert.equal(b.snapshot().saved,true);
  }
});

test('corrupt collection recovery preserves exact original bytes and corrupt legacy stays untouched',async()=>{
  for(const key of [LIBRARY_KEY,LEGACY_KEY]) {
    const h=harness({[key]:'{broken'}),session=h.session();
    rename(session,'Recovered work');assert.equal(await session.flush(),false);
    assert.equal(h.values.get(key),'{broken');
    assert.equal(session.snapshot().conflict.remoteValid,false);
    assert.equal(await session.snapshot().conflict.keepLocal(),true);
    assert.equal(JSON.parse(h.values.get(LIBRARY_KEY)).facilities[0].plan.name,'Recovered work');
    if(key===LIBRARY_KEY)assert.ok(backups(h).includes('{broken'));
    else assert.equal(h.values.get(key),'{broken');
  }
});

test('a delayed choice refuses changed remote data, local edits and new uncommitted previews',async()=>{
  for(const change of ['remote','local','preview']) {
    let clean=true;
    const h=harness(),a=h.session();await a.flush();const b=h.session({canResolve:()=>clean});
    rename(a,'Other');await a.flush();b.receive();
    let release;const barrier=new Promise(resolve=>{release=resolve;});const hold=h.withLock(()=>barrier);
    const choice=b.snapshot().conflict.useRemote();
    if(change==='remote')h.values.set(LIBRARY_KEY,JSON.stringify(createLibrary({...blankFacility(),name:'Newer'})));
    if(change==='local')rename(b,'Newer local');
    if(change==='preview')clean=false;
    release();await hold;assert.equal(await choice,false);
    assert.ok(b.snapshot().conflict);assert.equal(backups(h).length,0);
    assert.notEqual(names(b)[0],'Other');
  }
});

test('recovery refuses full backup slots and failed backups before replacing facilities',async()=>{
  for(const mode of ['full','quota']) {
    const h=harness(),a=h.session();await a.flush();const b=h.session();
    rename(a,'Saved remotely');await a.flush();b.receive();const before=h.values.get(LIBRARY_KEY);
    if(mode==='full')for(let i=1;i<=10;i++)h.values.set(workspaceBackupKey(LIBRARY_KEY,i),'occupied');
    else {const set=h.storage.setItem;h.storage.setItem=(key,raw)=>{if(key!==LIBRARY_KEY)throw Error('quota');set(key,raw);};}
    assert.equal(await b.snapshot().conflict.keepLocal(),false);
    assert.equal(h.values.get(LIBRARY_KEY),before);assert.ok(b.snapshot().conflict);
  }
});

test('saved copies require downloading exact bytes before locked removal',async()=>{
  const h=harness(),a=h.session();await a.flush();const b=h.session();rename(a,'Remote');await a.flush();b.receive();
  await b.snapshot().conflict.keepLocal();
  rename(a,'Another');a.receive();
  let copy=a.snapshot().conflict.savedCopies.copies[0];
  assert.equal(await copy.remove(),false);assert.equal(copy.markDownloaded(),true);
  const key=workspaceBackupKey(LIBRARY_KEY,copy.slot);h.values.set(key,'changed');
  assert.equal(await copy.remove(),false);assert.equal(h.values.get(key),'changed');
  copy=a.snapshot().conflict.savedCopies.copies[0];assert.equal(copy.markDownloaded(),true);
  assert.equal(await copy.remove(),true);assert.equal(h.values.has(key),false);
});

test('deleted saves can be explicitly restored or restarted without dropping the current collection',async()=>{
  for(const choice of ['keepLocal','useRemote']) {
    const h=harness(),session=h.session();rename(session,'Local plan');await session.flush();
    h.values.delete(LIBRARY_KEY);session.receive();
    assert.equal(session.snapshot().conflict.remoteDeleted,true);
    assert.equal(await session.snapshot().conflict[choice](),true);
    assert.equal(names(session)[0],choice==='keepLocal'?'Local plan':'My facility');
    if(choice==='useRemote')assert.equal(JSON.parse(backups(h)[0]).facilities[0].plan.name,'Local plan');
  }
});

test('unsupported locking and storage write failures keep facilities in memory and allow retry',async()=>{
  const h=harness(),unsupported=createFacilitySave(h.storage,{withLock:null});
  assert.equal(await unsupported.flush(),false);assert.equal(h.values.size,0);assert.match(unsupported.snapshot().error,/shared save locking/);
  const session=h.session();const set=h.storage.setItem;h.storage.setItem=()=>{throw Error('full');};
  rename(session,'Keep me');assert.equal(await session.flush(),false);assert.equal(session.snapshot().saved,false);
  h.storage.setItem=set;assert.equal(await session.flush(),true);assert.equal(names(session)[0],'Keep me');
});

test('downloaded conflict copies restore validated facilities with the normal importer',()=>{
  const library=createLibrary({...blankFacility(),name:'Restorable copy'});
  const copy={schema:'intelligent-dvr.workspace-backup.v1',key:LIBRARY_KEY,raw:JSON.stringify(library)};
  assert.equal(parseFacilityFile(JSON.stringify(copy))[0].name,'Restorable copy');
  assert.throws(()=>parseFacilityFile(JSON.stringify({...copy,key:'dvr.events.v1'})));
  assert.throws(()=>parseFacilityFile(JSON.stringify({...copy,raw:'{broken'})));
  assert.throws(()=>parseFacilityFile(JSON.stringify({...copy,raw:JSON.stringify(copy)})));
});

test('large conflict copies download original importable bytes rather than an oversized escaped envelope',()=>{
  const plan={...blankFacility(),labels:Array.from({length:1000},(_,i)=>({id:`label-${i}`,name:'"'.repeat(70),x:0,y:0,z:0}))};
  const base=createLibrary(plan),library=validateLibrary({...base,facilities:Array.from({length:19},(_,i)=>({...base.facilities[0],id:i?`facility-${i}`:base.activeId}))});
  const raw=JSON.stringify(library),archive=JSON.stringify({schema:'intelligent-dvr.workspace-backup.v1',key:LIBRARY_KEY,raw});
  assert.ok(Buffer.byteLength(raw)<MAX_LIBRARY_BYTES);assert.ok(Buffer.byteLength(archive)>MAX_LIBRARY_BYTES);
  assert.equal(facilityCopyDownload(archive),raw);
  assert.equal(parseFacilityFile(facilityCopyDownload(archive)).length,19);
  for(const malformed of ['broken',JSON.stringify({schema:'wrong',key:LIBRARY_KEY,raw}),JSON.stringify({schema:'intelligent-dvr.workspace-backup.v1',key:LIBRARY_KEY,raw:'{broken'})])assert.equal(facilityCopyDownload(malformed),malformed);
});
