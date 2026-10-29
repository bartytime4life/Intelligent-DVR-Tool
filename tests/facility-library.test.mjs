import test from 'node:test';
import assert from 'node:assert/strict';
import {blankFacility, exampleFacility} from '../src/facility.mjs';
import {LIBRARY_KEY, LEGACY_KEY, LIBRARY_SCHEMA, MAX_LIBRARY_BYTES, MAX_FACILITY_BYTES, createLibrary, validateLibrary, loadLibrary, persistLibrary, addFacility, replaceActive, selectFacility, duplicateActive, importFacilities, facilityFilename, parseFacilityFile} from '../src/facility-library.mjs';

function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {values, writes:[], getItem:key=>values.get(key) ?? null, setItem(key,value){this.writes.push([key,value]);values.set(key,value);}};
}

test('a new install reads as one blank facility without creating a sample or writing storage',()=>{
  const storage=memoryStorage(), loaded=loadLibrary(storage), plan=loaded.library.facilities[0].plan;
  assert.deepEqual(plan,blankFacility());assert.equal(loaded.library.facilities.length,1);
  assert.equal(loaded.library.activeId,loaded.library.facilities[0].id);
  assert.equal(loaded.library.revision,0);assert.equal(loaded.blocked,false);assert.equal(loaded.expectedRaw,null);
  assert.equal(loaded.migrated,false);assert.equal(loaded.error,'');assert.deepEqual(storage.writes,[]);
});

test('legacy v1 and v2 plans migrate into an independent collection without altering their backup',()=>{
  for(const schema of ['intelligent-dvr.facility.v1','intelligent-dvr.facility.v2']) {
    const plan=exampleFacility();plan.schema=schema;delete plan.openings;delete plan.stairs;delete plan.paths;
    const legacy=JSON.stringify(plan),storage=memoryStorage({[LEGACY_KEY]:legacy}),loaded=loadLibrary(storage);
    assert.equal(loaded.migrated,true);assert.equal(loaded.blocked,false);assert.equal(loaded.expectedRaw,null);
    assert.equal(loaded.library.facilities[0].plan.name,plan.name);
    assert.deepEqual(loaded.library.facilities[0].plan.buildings,plan.buildings);
    assert.deepEqual(storage.writes,[]);
    const saved=persistLibrary(storage,loaded.library,loaded.expectedRaw);
    assert.equal(saved.library.revision,1);assert.equal(storage.values.get(LEGACY_KEY),legacy);
    assert.equal(storage.writes.length,1);assert.equal(storage.writes[0][0],LIBRARY_KEY);
    assert.deepEqual(loadLibrary(storage).library,saved.library);assert.equal(loadLibrary(storage).migrated,false);
  }
});

test('new saves take priority over a stale legacy key and preserve the selected facility across reload',()=>{
  let library=createLibrary({...blankFacility(),name:'Office'});
  library=addFacility(library,{...blankFacility(),name:'Warehouse'});
  const storage=memoryStorage({[LEGACY_KEY]:JSON.stringify(exampleFacility())});
  const saved=persistLibrary(storage,library,null),loaded=loadLibrary(storage);
  assert.deepEqual(loaded.library,saved.library);assert.equal(loaded.expectedRaw,saved.raw);
  assert.equal(loaded.library.facilities.find(item=>item.id===loaded.library.activeId).plan.name,'Warehouse');
});

test('corrupt, over-limit and unreadable storage stays untouched with a blocked blank recovery state',()=>{
  for(const entries of [{[LIBRARY_KEY]:'{'}, {[LIBRARY_KEY]:''}, {[LIBRARY_KEY]:'x'.repeat(MAX_LIBRARY_BYTES+1)}, {[LEGACY_KEY]:'{'}, {[LEGACY_KEY]:'x'.repeat(MAX_FACILITY_BYTES+1)}]) {
    const storage=memoryStorage(entries),loaded=loadLibrary(storage);
    assert.equal(loaded.blocked,true);assert.match(loaded.error,/not been changed/);
    assert.deepEqual(loaded.library.facilities[0].plan,blankFacility());assert.deepEqual(storage.writes,[]);
    assert.deepEqual(Object.fromEntries(storage.values),entries);
    assert.equal(loaded.recoveryRaw,entries[LIBRARY_KEY] ?? entries[LEGACY_KEY]);
  }
  const loaded=loadLibrary({getItem(){throw Error('denied');}});
  assert.equal(loaded.blocked,true);assert.equal(loaded.expectedRaw,null);assert.match(loaded.error,/denied/);
  assert.equal(loaded.recoveryRaw,null);
});

test('a corrupt legacy save exposes exact recovery bytes without changing the new-key revision',()=>{
  const raw='{"schema":"intelligent-dvr.facility.v2",broken',storage=memoryStorage({[LEGACY_KEY]:raw});
  const loaded=loadLibrary(storage);
  assert.equal(loaded.blocked,true);assert.equal(loaded.expectedRaw,null);assert.equal(loaded.recoveryRaw,raw);
  assert.equal(storage.getItem(LEGACY_KEY),raw);assert.equal(storage.getItem(LIBRARY_KEY),null);assert.deepEqual(storage.writes,[]);
});

test('saving detects a changed stored revision and refuses to overwrite or mutate either side',()=>{
  const storage=memoryStorage(),first=persistLibrary(storage,createLibrary(),null);
  const original=structuredClone(first.library),other=persistLibrary(storage,addFacility(first.library),first.raw);
  assert.throws(()=>persistLibrary(storage,replaceActive(first.library,{...blankFacility(),name:'Unsaved work'}),first.raw),error=>error.code==='FACILITY_CONFLICT');
  assert.deepEqual(first.library,original);assert.equal(storage.values.get(LIBRARY_KEY),other.raw);assert.equal(storage.writes.length,2);
  assert.throws(()=>persistLibrary(storage,first.library,undefined),/known saved revision/);
});

test('quota/read failures never report success or advance the in-memory revision',()=>{
  const library=createLibrary(),original=structuredClone(library),storage=memoryStorage();
  storage.setItem=()=>{const error=new Error('full');error.name='QuotaExceededError';throw error;};
  assert.throws(()=>persistLibrary(storage,library,null),error=>error.code==='FACILITY_QUOTA');
  assert.equal(storage.values.size,0);assert.deepEqual(library,original);
  assert.throws(()=>persistLibrary({getItem(){throw Error('no');}},library,null),error=>error.code==='FACILITY_STORAGE');
  assert.throws(()=>persistLibrary({getItem:()=>null,setItem(){throw Error('no');}},library,null),error=>error.code==='FACILITY_STORAGE');
});

test('adding, switching, replacing and duplicating isolate facilities while keeping exact geometry',()=>{
  const plan=exampleFacility();plan.buildings[0].height=4*.3048;
  const first=createLibrary(plan),firstId=first.activeId,second=addFacility(first,{...blankFacility(),name:'Second'});
  const changed=replaceActive(second,{...blankFacility(),name:'Renamed second'});
  assert.equal(first.facilities.length,1);assert.equal(changed.facilities[0].plan.buildings[0].height,1.2192);
  assert.equal(changed.facilities[1].plan.name,'Renamed second');assert.equal(second.facilities[1].plan.name,'Second');
  const selected=selectFacility(changed,firstId),copy=duplicateActive(selected),copied=copy.facilities.at(-1);
  assert.notEqual(copied.id,firstId);assert.equal(copied.plan.name,plan.name+' copy');
  assert.deepEqual(copied.plan.buildings,plan.buildings);copied.plan.buildings[0].height=99;
  assert.equal(selected.facilities[0].plan.buildings[0].height,1.2192);assert.equal(copy.facilities[0].plan.buildings[0].height,1.2192);
  assert.throws(()=>selectFacility(first,'missing'),/existing/);
  assert.equal(addFacility(createLibrary()).facilities[1].plan.name,'My facility 2');
});

test('collections reject bad revisions, IDs, timestamps, active IDs, counts and oversized plans',()=>{
  const good=createLibrary();
  for(const delta of [{schema:'other'}, {revision:-1}, {revision:1.1}, {revision:Number.MAX_SAFE_INTEGER+1}, {activeId:'missing'}, {facilities:[]}, {facilities:null}]) assert.throws(()=>validateLibrary({...good,...delta}));
  for(const delta of [{id:'bad/id'}, {updatedAt:'today'}, {updatedAt:'2026-02-31T00:00:00.000Z'}, {plan:null}]) assert.throws(()=>validateLibrary({...good,facilities:[{...good.facilities[0],...delta}]}));
  assert.throws(()=>validateLibrary({...good,facilities:[good.facilities[0],good.facilities[0]]}),/unique/);
  assert.throws(()=>createLibrary({...blankFacility(),junk:'x'.repeat(MAX_FACILITY_BYTES)}),/2 MB/);
  assert.throws(()=>validateLibrary({...good,junk:'x'.repeat(MAX_LIBRARY_BYTES)}),/4 MB/);
  let max=good;for(let i=1;i<30;i++)max=addFacility(max);
  assert.equal(max.facilities.length,30);assert.throws(()=>addFacility(max),/30 facilities/);
  assert.throws(()=>persistLibrary(memoryStorage(),{...good,revision:Number.MAX_SAFE_INTEGER},null),/revision limit/);
});

test('portable single-facility and complete-collection files validate before any plan is returned',()=>{
  const one=exampleFacility(),library=addFacility(createLibrary(one),{...blankFacility(),name:'Second'});
  assert.deepEqual(parseFacilityFile(JSON.stringify(one)),[one]);
  const parsed=parseFacilityFile(JSON.stringify(library));assert.equal(parsed.length,2);assert.equal(parsed[0].name,one.name);
  assert.deepEqual(parsed[0],one);parsed[0].buildings[0].height=99;assert.notEqual(library.facilities[0].plan.buildings[0].height,99);
  const invalid=structuredClone(library);invalid.facilities[1].plan.origin=[NaN,20];
  assert.throws(()=>parseFacilityFile(JSON.stringify(invalid)));assert.throws(()=>parseFacilityFile('{'));
  assert.throws(()=>parseFacilityFile(' '.repeat(MAX_LIBRARY_BYTES+1)),/4 MB/);
  assert.throws(()=>parseFacilityFile(JSON.stringify({...one,junk:'x'.repeat(MAX_FACILITY_BYTES)})),/2 MB/);
  assert.equal(library.schema,LIBRARY_SCHEMA);
});

test('imported collection records get fresh IDs when added and cannot replace a matching saved name',()=>{
  const current=createLibrary({...blankFacility(),name:'Office'}),backup=JSON.stringify(current),originalId=current.activeId;
  let next=current;for(const plan of parseFacilityFile(backup))next=addFacility(next,plan);
  assert.equal(next.facilities.length,2);assert.equal(next.facilities[0].id,originalId);assert.notEqual(next.facilities[1].id,originalId);
  assert.deepEqual(next.facilities[0].plan,next.facilities[1].plan);assert.equal(current.facilities.length,1);
});

test('a complete 30-facility backup fits a fresh install by replacing only its automatic starter',()=>{
  let source=createLibrary({...blankFacility(),name:'Site 1'});
  for(let i=2;i<=30;i++)source=addFacility(source,{...blankFacility(),name:`Site ${i}`});
  const plans=parseFacilityFile(JSON.stringify(source)),sourceIds=new Set(source.facilities.map(item=>item.id));
  for(const revision of [0,1]) {
    const starter={...createLibrary(),revision},before=structuredClone(starter);
    const restored=importFacilities(starter,plans);
    assert.equal(restored.facilities.length,30);assert.equal(restored.revision,revision);
    assert.deepEqual(restored.facilities.map(item=>item.plan),source.facilities.map(item=>item.plan));
    assert.ok(restored.facilities.every(item=>!sourceIds.has(item.id) && item.id!==starter.activeId));
    assert.equal(restored.activeId,restored.facilities.at(-1).id);assert.deepEqual(starter,before);
    assert.equal(validateLibrary(JSON.parse(JSON.stringify(restored))).facilities.length,30);
  }
});

test('imports preserve authored or previously edited blank facilities and remain all-or-nothing',()=>{
  const plans=Array.from({length:30},(_,i)=>({...blankFacility(),name:`Imported ${i+1}`}));
  const authored=[createLibrary({...blankFacility(),name:'Saved empty site'}),
    createLibrary({...blankFacility(),origin:[0,0]}),
    {...createLibrary(),revision:2},createLibrary(exampleFacility()),addFacility(createLibrary())];
  for(const library of authored) {
    const before=structuredClone(library);
    assert.throws(()=>importFacilities(library,plans),/30 facilities/);
    assert.deepEqual(library,before);
  }
  const starter=createLibrary(),normal=importFacilities(starter,plans.slice(0,2));
  assert.equal(normal.facilities.length,3);assert.equal(normal.facilities[0].id,starter.activeId);
  const invalid=[...plans];invalid[29]={...blankFacility(),origin:[NaN,0]};
  const before=structuredClone(starter);assert.throws(()=>importFacilities(starter,invalid));assert.deepEqual(starter,before);
  for(const incoming of [[],null,[...plans,blankFacility()]])assert.throws(()=>importFacilities(starter,incoming),/1 and 30/);
});

test('download filenames contain no path, control, device-name or Unicode surprises',()=>{
  assert.equal(facilityFilename({name:'../Warehouse: East / A'}),'dvr-warehouse-east-a.json');
  assert.equal(facilityFilename({name:'Café HQ'}),'dvr-cafe-hq.json');
  assert.equal(facilityFilename({name:'CON'}),'dvr-con.json');
  assert.equal(facilityFilename({name:'\u0000/\\'}),'dvr-facility.json');
  assert.match(facilityFilename({name:'x'.repeat(100)}),/^dvr-[a-z0-9-]{1,64}\.json$/);
});
