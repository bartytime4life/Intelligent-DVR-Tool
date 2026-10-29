import test from 'node:test';
import assert from 'node:assert/strict';
import {exampleFacility, blankFacility, validateFacility, parseFacility, addBuildingLevel, copyRoomsToNextLevel, wallObstacles, createFloorOpening, floorSlabRings, ceilingOpenings, createFloorPath, SCHEMA} from '../src/facility.mjs';
import {createFacilityZone, compileZoneRules, FACILITY_CLASSES} from '../src/facility-zones.mjs';
const square = [[0,0],[10,0],[10,10],[0,10],[0,0]];
const zone = () => ({...createFacilityZone(square),id:'zone-test'});

test('legacy facilities gain empty zones and current zones round trip without URLs or arbitrary metadata',()=>{
  const legacy=blankFacility();legacy.schema='intelligent-dvr.facility.v1';delete legacy.zones;
  assert.deepEqual(parseFacility(JSON.stringify(legacy)).zones,[]);
  const plan={...exampleFacility(),zones:[{...zone(),streamUrl:'https://untrusted.invalid',html:'<script>'}]};
  const clean=validateFacility(plan);
  assert.equal(clean.zones[0].streamUrl,undefined);assert.equal(clean.zones[0].html,undefined);
  assert.deepEqual(parseFacility(JSON.stringify(clean)),clean);
  assert.throws(()=>validateFacility({...plan,schema:'intelligent-dvr.facility.v1'}),/Zones require/);
});

test('zones reject invalid IDs, polygons, class inventories, type, dwell, floor and image rules',()=>{
  for(const mutation of [z=>z.id='b1',z=>z.type='auto_anomaly',z=>z.footprint=[[0,0],[10,10],[0,10],[10,0],[0,0]],
    z=>z.expectedClasses=['unrecognized alien'],z=>z.expectedClasses=['person','person'],z=>z.expectedClasses=null,
    z=>z.dwellSeconds=Infinity,z=>z.dwellSeconds=true,z=>z.enabled='true',z=>z.buildingId='b2',z=>z.level=0,
    z=>z.imageRegion={cameraId:'missing',rect:[0,0,1,1],threshold:.7,maxGap:2}]) {
    const z=zone();mutation(z);assert.throws(()=>validateFacility({...exampleFacility(),zones:[z]}));
  }
  assert.throws(()=>validateFacility({...blankFacility(),zones:null}));
  assert.throws(()=>validateFacility({...blankFacility(),zones:[null]}));
});

test('indoor zones require solid modeled floor space and a valid level',()=>{
  const p=blankFacility();p.buildings=[{id:'b',name:'Building',footprint:[[0,0],[30,0],[30,30],[0,30],[0,0]],holes:[[[12,12],[18,12],[18,18],[12,18],[12,12]]],height:10,floors:2}];
  p.zones=[{...zone(),buildingId:'b',level:1}];assert.equal(validateFacility(p).zones[0].level,1);
  p.zones[0].level=2;assert.throws(()=>validateFacility(p),/Indoor zones/);p.zones[0].level=1;
  p.zones[0].footprint=[[10,10],[20,10],[20,20],[10,20],[10,10]];assert.throws(()=>validateFacility(p),/Indoor zones/);
});

test('add-top-level keeps earlier floor and room elevations, base, footprint and source metadata',()=>{
  const plan=exampleFacility(), b=plan.buildings.find(b=>b.id==='b2');b.base=1.2;b.height=10.8;plan.rooms[1].level=2;b.source={provider:'OpenStreetMap',id:'way/123',license:'ODbL-1.0',retrieved:'2026-10-29',updated:'2026-10-28',heightBasis:'mapped',floorsBasis:'mapped'};
  const before=wallObstacles(plan).slice(-plan.rooms.length), snapshot=structuredClone(plan);
  const next=addBuildingLevel(plan,'b2'), result=next.buildings.find(b=>b.id==='b2');
  assert.equal(result.floors,4);assert.ok(Math.abs(result.height-14)<1e-9);
  const after=wallObstacles(next).slice(-next.rooms.length);
  after.forEach((o,i)=>{assert.ok(Math.abs(o.base-before[i].base)<1e-9);assert.ok(Math.abs(o.top-before[i].top)<1e-9);});
  assert.deepEqual(result.footprint,b.footprint);assert.deepEqual(result.source,b.source);assert.deepEqual(plan,snapshot);
});

test('copy rooms upstairs preserves geometry and creates independent IDs, while refusing collisions and limits',()=>{
  const plan=exampleFacility(),next=copyRoomsToNextLevel(plan,'b2',0);
  const originals=next.rooms.filter(r=>r.level===0),copies=next.rooms.filter(r=>r.level===1);
  assert.equal(copies.length,2);copies.forEach((r,i)=>{assert.notEqual(r.id,originals[i].id);assert.deepEqual(r.footprint,originals[i].footprint);assert.notEqual(r.footprint,originals[i].footprint);});
  assert.throws(()=>copyRoomsToNextLevel(next,'b2',0),/already has rooms/);
  const highest={...plan,rooms:plan.rooms.map(r=>({...r,level:2}))};const newTop=copyRoomsToNextLevel(highest,'b2',2);
  assert.equal(newTop.buildings.find(b=>b.id==='b2').floors,4);assert.equal(newTop.rooms.filter(r=>r.level===3).length,2);
  const max=exampleFacility();max.buildings[1].floors=40;assert.throws(()=>addBuildingLevel(max,'b2'),/40/);
  max.buildings[1].floors=1;max.buildings[1].height=100;assert.throws(()=>addBuildingLevel(max,'b2'),/150/);
});

test('restricted rules and unexpected-class rules use explicit matching-camera image bounds',()=>{
  const cameras=exampleFacility().cameras;
  const restricted={...zone(),imageRegion:{cameraId:'C-07',rect:[.1,.2,.6,.7],threshold:.75,maxGap:2}};
  const rules=compileZoneRules(restricted,cameras);assert.equal(rules.length,1);assert.equal(rules[0].label,'person');assert.deepEqual(rules[0].rect,[.1,.2,.6,.7]);
  const objects=compileZoneRules({...restricted,type:'object_watch',expectedClasses:['person','chair']},cameras);
  assert.equal(objects.length,FACILITY_CLASSES.length-2);assert.ok(objects.every(r=>!['person','chair'].includes(r.label)));
  assert.equal(new Set(objects.map(r=>r.name)).size,objects.length);assert.ok(objects.every(r=>r.name.length<=60));
  assert.throws(()=>compileZoneRules({...restricted,imageRegion:undefined},cameras));
  assert.throws(()=>compileZoneRules({...restricted,enabled:false},cameras),/Enable/);
  assert.throws(()=>compileZoneRules({...restricted,type:'object_watch',expectedClasses:[...FACILITY_CLASSES]},cameras),/All model classes/);
  for(const rect of [[0,0,1.1,1],[0,0,0,1],[-.1,0,.2,.2],[0,0,NaN,1]]) assert.throws(()=>compileZoneRules({...restricted,imageRegion:{...restricted.imageRegion,rect}},cameras));
});


// Replacing the complete layout must not retain references to removed cameras/floors.
test('replacing a facility clears zones while appending retains them', async () => {
  const {draftFacility} = await import('../src/facility-starter.mjs');
  const plan = exampleFacility();
  plan.zones = [createFacilityZone([[0,0],[10,0],[10,10],[0,10],[0,0]])];
  const building = {...plan.buildings[0], id:'replacement'};
  assert.equal(draftFacility(plan,[building],true).zones.length,0);
  assert.equal(draftFacility(plan,[],false).zones.length,1);
});

const openingPlan = () => ({...blankFacility(),buildings:[{id:'block',name:'Block',height:12,floors:3,footprint:[[0,0],[30,0],[30,30],[0,30],[0,0]]}]});
const interior = [[3,3],[6,3],[6,8],[3,8],[3,3]];
test('v3 protects independent slab openings while accepting earlier plans without advanced shapes',()=>{
  const plan=openingPlan(), opening=createFloorOpening(plan,'block',1,interior);
  const withOpening=validateFacility({...plan,openings:[opening]});
  assert.equal(withOpening.schema,'intelligent-dvr.facility.v3');
  assert.deepEqual(parseFacility(JSON.stringify(withOpening)),withOpening);
  for(const old of ['intelligent-dvr.facility.v1','intelligent-dvr.facility.v2']) {
    assert.throws(()=>validateFacility({...withOpening,schema:old}),/require facility v3/);
    assert.equal(validateFacility({...plan,schema:old}).schema,SCHEMA);
  }
  assert.equal(floorSlabRings(withOpening,'block',1).length,2);
  assert.equal(floorSlabRings(withOpening,'block',0).length,1);
  assert.equal(floorSlabRings(withOpening,'block',2).length,1);
  assert.equal(ceilingOpenings(withOpening,'block',0)[0].id,opening.id);
  assert.deepEqual(ceilingOpenings(withOpening,'block',1),[]);
  assert.deepEqual(ceilingOpenings(withOpening,'block',2),[]);
  const exported=floorSlabRings(withOpening,'block',1);exported[1][0][0]=999;
  assert.equal(withOpening.openings[0].footprint[0][0],3);
});

test('floor openings reject invalid floors, overlap, courtyard crossings and touching outer walls',()=>{
  const plan=openingPlan(),opening=createFloorOpening(plan,'block',1,interior);
  for(const level of [-1,3,.5,NaN]) assert.throws(()=>createFloorOpening(plan,'block',level,interior));
  assert.throws(()=>createFloorOpening(plan,'missing',0,interior));
  for(const footprint of [[[0,3],[3,3],[3,8],[0,8],[0,3]],[[29,3],[32,3],[32,8],[29,8],[29,3]]]) assert.throws(()=>createFloorOpening(plan,'block',0,footprint),/strictly inside/);
  const sameFloor={...plan,openings:[opening]};
  assert.throws(()=>createFloorOpening(sameFloor,'block',1,interior),/strictly inside/);
  assert.doesNotThrow(()=>createFloorOpening(sameFloor,'block',2,interior));
  const courtyard=openingPlan();courtyard.buildings[0].holes=[[[10,10],[15,10],[15,15],[10,15],[10,10]]];
  assert.throws(()=>createFloorOpening(courtyard,'block',1,[[9,9],[16,9],[16,16],[9,16],[9,9]]),/strictly inside/);
  assert.throws(()=>createFloorOpening(plan,'block',0,[[NaN,1],[2,1],[2,3],[NaN,1]]),/local-meter/);
});

test('opening and camera IDs share a namespace and room copying does not duplicate slab openings',()=>{
  const plan=exampleFacility(),opening=createFloorOpening(plan,'b2',0,[[-80,-68],[-77,-68],[-77,-65],[-80,-65],[-80,-68]]);
  plan.openings=[opening];
  const copied=copyRoomsToNextLevel(plan,'b2',0);
  assert.deepEqual(copied.openings,plan.openings);
  assert.throws(()=>validateFacility({...plan,openings:[{...opening,id:plan.cameras[0].id}]}),/unique ID/);
  const noBuilding={...plan,buildings:plan.buildings.filter(b=>b.id!=='b2'),rooms:[]};
  assert.throws(()=>validateFacility(noBuilding),/Floor openings/);
});

test('stairs persist bounded physical parameters and reject invalid floors or courtyard footprint',()=>{
  const p=openingPlan(), stair={id:'stair-a',name:'Stairs',buildingId:'block',fromLevel:0,toLevel:1,x:15,y:15,bearing:0,width:1.2,tread:.28,risers:24,landing:1.2};
  p.stairs=[stair];assert.deepEqual(validateFacility(p).stairs,[stair]);assert.deepEqual(parseFacility(JSON.stringify(p)),p);
  for(const mutation of [s=>s.fromLevel=-1,s=>s.toLevel=3,s=>s.toLevel=2,s=>s.risers=1000,s=>s.x=29.9,s=>s.width=NaN]){
    const q=structuredClone(p);mutation(q.stairs[0]);assert.throws(()=>validateFacility(q));
  }
  const hole=structuredClone(p);hole.buildings[0].holes=[[[14,14],[16,14],[16,16],[14,16],[14,14]]];assert.throws(()=>validateFacility(hole),/Stair flights/);
  assert.throws(()=>validateFacility({...p,schema:'intelligent-dvr.facility.v2'}),/require facility v3/);
  const clean=validateFacility({...p,stairs:[{...stair,streamUrl:'https://bad.invalid'}]});assert.equal(clean.stairs[0].streamUrl,undefined);
});

test('per-floor pathways stay within solid floor and reject concave shortcuts and missing levels',()=>{
  const p=openingPlan(),opening=createFloorOpening(p,'block',1,interior);p.openings=[opening];
  const path=createFloorPath(p,'block',0,[[2,5],[8,5]]);p.paths=[path];assert.deepEqual(validateFacility(p).paths,[path]);
  assert.throws(()=>createFloorPath(p,'block',1,[[2,5],[8,5]]),/cannot cross or touch/);
  assert.throws(()=>createFloorPath(p,'block',1,[[3,3],[3,8]]),/cannot cross or touch/);
  assert.throws(()=>createFloorPath(p,'block',3,[[2,2],[8,8]]),/existing level/);
  assert.throws(()=>createFloorPath(p,'block',0,[[2,2],[2,2]]),/distinct consecutive/);
  assert.throws(()=>createFloorPath(p,'block',0,[[2,2],[35,2]]),/inside the building/);
  assert.throws(()=>validateFacility({...p,schema:'intelligent-dvr.facility.v2'}),/require facility v3/);
  const concave=openingPlan();concave.buildings[0].footprint=[[0,0],[20,0],[20,5],[5,5],[5,20],[0,20],[0,0]];
  assert.throws(()=>createFloorPath(concave,'block',0,[[15,4],[4,15]]),/inside the building/);
  const courtyard=openingPlan();courtyard.buildings[0].holes=[[[10,10],[15,10],[15,15],[10,15],[10,10]]];
  assert.throws(()=>createFloorPath(courtyard,'block',0,[[9,12],[16,12]]),/cannot cross or touch/);
});

test('whole open levels omit their slabs and open only the corresponding ceiling below',()=>{
  const plan=openingPlan();plan.buildings[0].openFloors=[2,1];
  const clean=validateFacility(plan);assert.deepEqual(clean.buildings[0].openFloors,[1,2]);
  assert.deepEqual(parseFacility(JSON.stringify(clean)),clean);
  assert.equal(floorSlabRings(clean,'block',0).length,1);
  assert.deepEqual(floorSlabRings(clean,'block',1),[]);assert.deepEqual(floorSlabRings(clean,'block',2),[]);
  const ceiling=ceilingOpenings(clean,'block',0);
  assert.equal(ceiling.length,1);assert.equal(ceiling[0].entireFloor,true);assert.equal(ceiling[0].level,1);
  assert.deepEqual(ceiling[0].footprint,clean.buildings[0].footprint);
  ceiling[0].footprint[0][0]=999;assert.equal(clean.buildings[0].footprint[0][0],0);
  assert.equal(ceilingOpenings(clean,'block',1)[0].level,2);assert.deepEqual(ceilingOpenings(clean,'block',2),[]);
});

test('open level inventories reject duplicates, invalid levels and schema downgrades; paths need solid floors',()=>{
  for(const openFloors of [null,'1',[1,1],[-1],[3],[.5],[true],[NaN]]) {
    const plan=openingPlan();plan.buildings[0].openFloors=openFloors;assert.throws(()=>validateFacility(plan),/Open floors/);
  }
  for(const schema of ['intelligent-dvr.facility.v1','intelligent-dvr.facility.v2']) {
    const plan=openingPlan();plan.buildings[0].openFloors=[];plan.schema=schema;assert.throws(()=>validateFacility(plan),/require facility v3/);
  }
  const plan=openingPlan();plan.buildings[0].openFloors=[1];
  assert.throws(()=>createFloorPath(plan,'block',1,[[2,2],[8,8]]),/solid floor/);
  assert.doesNotThrow(()=>createFloorPath(plan,'block',0,[[2,2],[8,8]]));
  const existing=openingPlan();existing.paths=[createFloorPath(existing,'block',1,[[2,2],[8,8]])];existing.buildings[0].openFloors=[1];
  assert.throws(()=>validateFacility(existing),/solid floor/);
});

test('opening and pathway helpers retain exact converted imperial dimensions without centimetre snapping',()=>{
  const plan=openingPlan(),fourFeet=4*.3048,left=3*.3048,bottom=2*.3048;
  const ring=[[left,bottom],[left+fourFeet,bottom],[left+fourFeet,bottom+2],[left,bottom+2],[left,bottom]];
  const opening=createFloorOpening(plan,'block',1,ring);
  assert.deepEqual(opening.footprint,ring);assert.notEqual(opening.footprint,ring);
  assert.ok(Math.abs((opening.footprint[1][0]-opening.footprint[0][0])-1.2192)<1e-14);
  const points=[[left,bottom],[left+fourFeet,bottom]];
  const path=createFloorPath(plan,'block',0,points);
  assert.deepEqual(path.points,points);assert.notEqual(path.points,points);
  const roundTrip=parseFacility(JSON.stringify({...plan,openings:[opening],paths:[path]}));
  assert.deepEqual(roundTrip.openings[0].footprint,ring);assert.deepEqual(roundTrip.paths[0].points,points);
  opening.footprint[0][0]=100;path.points[0][0]=100;
  assert.equal(ring[0][0],left);assert.equal(points[0][0],left);
});
