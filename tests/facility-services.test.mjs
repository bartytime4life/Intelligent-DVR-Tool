import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedJson, createPlaceSearch, parsePlaces } from '../src/facility-services.mjs';
import { fetchOsmBuildings, parseOsmBuildings, searchBounds, shapeFootprint } from '../src/facility-starter.mjs';
import { blankFacility, toLngLat, validateFacility, validPolygon } from '../src/facility.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const fc = (features=[]) => ({type:'FeatureCollection',features});
const place = (p=[11.2575,46.4553],name='Recorded example') => ({type:'Feature',geometry:{type:'Point',coordinates:p},properties:{name}});
const origin=[-98,38.5], bounds=searchBounds(origin,0,0,250,250);
const ring=(x=0)=>shapeFootprint('Rectangle',20,30,2,0,x,0).map(p=>{const [lon,lat]=toLngLat(p,origin);return {lon,lat};});
const relation=(members,id=100)=>({type:'relation',id,tags:{type:'multipolygon',building:'yes'},members});
const member=(geometry,ref=1,role='outer')=>({type:'way',ref,role,geometry});
test('address search validates queries, bounds, and remote labels as text', async()=>{
  const search=createPlaceSearch();
  await assert.rejects(()=>search('ab','public'),/3–180/);
  await assert.rejects(()=>search('test','unknown'),/3–180/);
  const parsed=parsePlaces(fc([place(),place([0,90]),place([NaN,2]),place([1,2],'<img onerror=bad>')]));
  assert.equal(parsed.length,2); assert.equal(parsed[1].label,'<img onerror=bad>');
  assert.throws(()=>parsePlaces(fc(Array(11).fill(place()))));
});
test('submitted address requests omit credentials, cache only in memory, and rate-limit',async()=>{
  let calls=0,request;let time=0;
  const search=createPlaceSearch(async(url,opts)=>{calls++;request={url,...opts};return new Response(JSON.stringify(fc([place()])));},()=>time);
  const first=await search('Example library','public');first[0].label='changed';
  assert.equal((await search('Example library','public'))[0].label,'Recorded example');
  assert.equal(calls,1);assert.match(request.url,/limit=5/);assert.equal(request.credentials,'omit');assert.equal(request.redirect,'error');
  await assert.rejects(()=>search('Another library','public'),/Wait/);
  time=2000;await search('Another library','local');assert.match(request.url,/^\/geo\/search\?/);
});
test('concurrent and aborted searches cannot be cached as successes',async()=>{
  let resolve;
  const search=createPlaceSearch(()=>new Promise(r=>{resolve=r;}));
  const c=new AbortController(),pending=search('Library one','public',c.signal);
  await assert.rejects(()=>search('Library two','public'),/Wait/);
  c.abort();resolve(new Response(JSON.stringify(fc([place()]))));
  await assert.rejects(()=>pending,{name:'AbortError'});
});
test('bounded readers reject oversized, empty, malformed and rate-limited bodies',async()=>{
  await assert.rejects(()=>boundedJson(new Response('not json')),/valid JSON/);
  await assert.rejects(()=>boundedJson(new Response('x'.repeat(101)),100),/size limit/);
  await assert.rejects(()=>boundedJson(new Response(null,{status:204})),/no response body/);
  await assert.rejects(()=>boundedJson(new Response('',{status:429})),/busy/);
  await assert.rejects(()=>fetchOsmBuildings(bounds,undefined,async()=>new Response(JSON.stringify({elements:[],remark:'timeout'}))),/Incomplete/);
});
test('complete relation outers stitch reversed segments and preserve source on export',()=>{
  const r=ring(),data={elements:[relation([member(r.slice(0,3),1),member([...r.slice(2)].reverse(),2)])]};
  const result=parseOsmBuildings(data,origin,bounds,'2026-10-27T00:00:00Z');
  assert.equal(result.buildings.length,1);
  const plan=validateFacility({...blankFacility(),buildings:result.buildings});assert.equal(plan.buildings[0].source.id,'relation/100');
  assert.equal(plan.buildings[0].footprint.length,5);
});
test('disjoint outers split; invalid holes/nesting are excluded and independent parts retain their role',()=>{
  const r=ring(),disjoint=ring(60);
  const result=parseOsmBuildings({elements:[relation([member(r),member(disjoint,2)])]},origin,bounds);
  assert.deepEqual(result.buildings.map(b=>b.id),['osm-relation-100-1','osm-relation-100-2']);
  for(const members of [[member(r),member(r,2,'inner')],[member(r.slice(0,3))],[member(r),member(r,2)],[member(r),member(r,2,'')]]){
    assert.equal(parseOsmBuildings({elements:[relation(members)]},origin,bounds).buildings.length,0);
  }
  const parts=relation([member(r)]);parts.tags['building:part']='yes';
  assert.equal(parseOsmBuildings({elements:[parts]},origin,bounds).buildings[0].part,true);
});
test('recorded licensed exterior extracts import; the real courtyard stays excluded',()=>{
  const ex=JSON.parse(readFileSync(new URL('./fixtures/facility/eppan-exteriors.json',import.meta.url)));
  const o=[11.2574936,46.45528628];
  const result=parseOsmBuildings(ex,o,searchBounds(o,0,0,250,250));assert.equal(result.buildings.length,2);
  const p=validateFacility({...blankFacility(),origin:o,buildings:result.buildings});assert.equal(p.buildings.length,2);
  const courtyard=JSON.parse(readFileSync(new URL('./fixtures/facility/eppan-courtyard.json',import.meta.url)));
  assert.equal(parseOsmBuildings(courtyard,o,searchBounds(o,0,0,250,250)).buildings.length,0);
  const block=JSON.parse(readFileSync(new URL('./fixtures/facility/recorded-block.json',import.meta.url)));
  const b=[26.243,50.6134];assert.equal(parseOsmBuildings(block,b,searchBounds(b,0,0,250,250)).buildings.length,3);
});
test('pinned extract bytes match the source manifest',()=>{
  const manifest=JSON.parse(readFileSync(new URL('./fixtures/facility/manifest.json',import.meta.url)));
  for(const f of manifest.files){const bytes=readFileSync(new URL('./fixtures/facility/'+f.file,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256);}
});
test('retraced edges and nonconsecutive duplicate vertices cannot invent a simple shell',()=>{
  assert.equal(validPolygon([[0,0],[10,0],[5,0],[5,10],[0,10],[0,0]]),false);
  assert.equal(validPolygon([[0,0],[10,0],[10,10],[0,10],[10,0],[0,0]]),false);
  assert.equal(validPolygon([[0,0],[5,0],[10,0],[10,10],[0,10],[0,0]]),true);
});
