import test from 'node:test';
import assert from 'node:assert/strict';
import {editableLineLength,lineInputValue,lineMetres,setLineSegmentLength,setLineVertex,validateEditableLine} from '../src/facility-line-edit.mjs';
const length=(a,b)=>Math.hypot(b[0]-a[0],b[1]-a[1]);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} should equal ${b}`);

test('resize translates the downstream path while keeping earlier vertices and later lengths',()=>{
  const source=[[0,0],[5,0],[8,4],[8,10],[12,10]],snapshot=structuredClone(source);
  const next=setLineSegmentLength(source,1,10);
  assert.deepEqual(next,[[0,0],[5,0],[11,8],[11,14],[15,14]]);
  near(length(next[1],next[2]),10);
  for(let i=2;i<next.length-1;i++) near(length(source[i],source[i+1]),length(next[i],next[i+1]));
  assert.deepEqual(source,snapshot);assert.notEqual(source[0],next[0]);
  near(editableLineLength(next),editableLineLength(source)+5);
});

test('feet input is stored as metres and conversion does not round geometry',()=>{
  const next=setLineSegmentLength([[0,0],[1,0],[1,1]],0,10,'imperial');
  near(next[1][0],3.048);near(next[2][0],3.048);near(next[2][1],1);
  near(lineInputValue(3.048,'imperial'),10);near(lineMetres(10,'imperial'),3.048);
  const vertex=setLineVertex([[0,0],[1,1],[2,1]],1,10,5,'imperial');
  near(vertex[1][0],3.048);near(vertex[1][1],1.524);
});

test('editing one vertex leaves every other point unchanged',()=>{
  const source=[[0,0],[4,0],[4,3]],next=setLineVertex(source,1,6,-1);
  assert.deepEqual(next,[[0,0],[6,-1],[4,3]]);
  assert.deepEqual(source,[[0,0],[4,0],[4,3]]);
  assert.throws(()=>setLineVertex(source,1,0,0),/neighboring/);
});

test('invalid or out-of-bounds edits fail without mutating input',()=>{
  const source=[[0,0],[1999,0],[2000,0]],snapshot=structuredClone(source);
  for(const args of [[0,2000],[-1,5],[2,5],[0,0],[0,-1],[0,NaN],[0,Infinity],[0,'5'],[.5,5]])
    assert.throws(()=>setLineSegmentLength(source,...args));
  assert.throws(()=>setLineVertex(source,1,2001,0),/within 2 km/);
  assert.throws(()=>setLineVertex(source,3,1,1),/existing line vertex/);
  assert.throws(()=>setLineVertex(source,1,NaN,1),/finite/);
  assert.throws(()=>setLineSegmentLength(source,0,5,'unknown'),/metres or feet/);
  assert.deepEqual(source,snapshot);
});

test('empty, oversized, malformed and degenerate loop inputs are refused',()=>{
  for(const source of [null,[],[[0,0]],[[0,0],[1,Infinity]],[[0,0,2],[1,2]],Array.from({length:201},(_,i)=>[i,0])])
    assert.throws(()=>validateEditableLine(source),/2–200 points/);
  assert.throws(()=>validateEditableLine([[0,0],[1,0],[0,0]]),/three distinct points/);
  assert.throws(()=>setLineSegmentLength([[0,0],[0,0],[1,1]],0,5),/no direction/);
});

test('the maximum-size line stays bounded and detached from the input',()=>{
  const points=Array.from({length:200},(_,i)=>[i,0]);
  const next=setLineSegmentLength(points,198,2);
  assert.equal(next.length,200);assert.deepEqual(next.at(-1),[200,0]);
  near(editableLineLength(next),200);
  next[0][0]=5;assert.equal(points[0][0],0);
});
import {parsePointList} from '../src/facility-line-edit.mjs';
test('keyboard point lists accept one east, north pair per line in metres or feet',()=>{
  assert.deepEqual(parsePointList('0, -20\n 15 -20 \n\n30;5'),[[0,-20],[15,-20],[30,5]]);
  assert.deepEqual(parsePointList('10, 0\n0, 10','imperial'),[[3.048,0],[0,3.048]]);
  for(const text of ['5','1,2,3\n4,5','a,b\n1,2','1,2','0,0\n5,5\n0,0','3000,0\n0,0']) assert.throws(()=>parsePointList(text));
});
import {isClosedLine} from '../src/facility-line-edit.mjs';
test('closed loop routes stay editable and stay closed',()=>{
  const loop=[[0,0],[10,0],[10,10],[0,10],[0,0]];
  assert.equal(isClosedLine(validateEditableLine(loop)),true);
  const longer=setLineSegmentLength(loop,0,12);
  assert.deepEqual(longer,[[0,0],[12,0],[12,10],[2,10],[0,0]]);
  const closing=setLineSegmentLength(loop,3,5);
  assert.deepEqual(closing.slice(0,3),loop.slice(0,3));assert.deepEqual(closing[3],[0,5]);assert.deepEqual(closing.at(-1),[0,0]);
  for(const index of [0,4]){const moved=setLineVertex(loop,index,-1,-1);assert.deepEqual(moved[0],[-1,-1]);assert.deepEqual(moved.at(-1),[-1,-1]);}
  assert.throws(()=>setLineVertex(loop,0,0,10),/neighboring/);
  assert.deepEqual(loop,[[0,0],[10,0],[10,10],[0,10],[0,0]]);
});
test('entered feet and metres are stored to 0.1 mm without float noise',()=>{
  assert.equal(lineMetres(26.2467,'imperial'),8);assert.equal(lineMetres(2.80000001),2.8);assert.equal(lineMetres(11/12,'imperial'),.2794);
});
