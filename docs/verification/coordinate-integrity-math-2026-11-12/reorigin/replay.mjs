import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';

const args=process.argv.slice(2),at=args.indexOf('--repo');
if(at<0 || !args[at+1] || args[at+1].startsWith('--') ||
 args.filter(arg=>arg==='--repo').length!==1 || args.some((arg,i)=>i!==at+1 && !['--repo','--require-pass'].includes(arg)))
 throw Error('Usage: node replay.mjs --repo <checkout> [--require-pass]');
const repo=resolve(args[at+1]),requirePass=args.includes('--require-pass');
const artifact=new URL('./',import.meta.url),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifest=JSON.parse(await readFile(new URL('baseline-manifest.json',artifact),'utf8'));
const originalBytes=await readFile(new URL('original-baseline-receipt.json',artifact));
assert.equal(sha(originalBytes),'916a7e9e2c16a9c5f80b0a7cb261673a92dadf39078c22e7c8590c1de47bb866');
assert.equal(manifest.source_revision,'33fedd1bc364fc07cdb9331594aefef06bf52e6e');
assert.equal(manifest.files.find(file=>file.path==='baseline-src/facility.mjs')?.sha256,
 '1ef907792316c57251d5609b89cce27db79bea8721eee8842cd00d8c5cfcc33b');
const original=JSON.parse(originalBytes),{plan,target}=original;
const scratch=await mkdtemp(join(tmpdir(),'dvr-reorigin-replay-'));
try{
 for(const file of manifest.files){
  assert.match(file.path,/^baseline-src\/facility(?:-(?:stairs|doorways|windows|zones))?\.mjs$/);
  const bytes=await readFile(new URL(file.path,artifact));
  assert.equal(bytes.length,file.bytes);assert.equal(sha(bytes),file.sha256);
  await writeFile(join(scratch,file.path.slice('baseline-src/'.length)),bytes);
 }
 const baseline=await import(pathToFileURL(join(scratch,'facility.mjs')));
 baseline.validateFacility(plan);
 const old=baseline.reoriginPlan(plan,target);
 assert.deepEqual(old,original.candidate);
 let baselineError=null;
 try{baseline.validateFacility(old);}catch(error){baselineError=error.message;}
 assert.equal(baselineError,original.candidateError);

 // Independent algebra for the documented local equirectangular grid.
 // Expected truth never calls either geographic helper or reoriginPlan.
 const radians=Math.PI/180,sx=Math.cos(target[1]*radians)/Math.cos(plan.origin[1]*radians);
 const dx=(plan.origin[0]-target[0])*111320*Math.cos(target[1]*radians),dy=(plan.origin[1]-target[1])*111320;
 const point=([x,y])=>[sx*x+dx,y+dy];
 const expected={...plan,origin:target,buildings:plan.buildings.map(item=>({...item,footprint:item.footprint.map(point)})),
  rooms:plan.rooms.map(item=>({...item,footprint:item.footprint.map(point)}))};
 baseline.validateFacility(expected);

 const source=await readFile(join(repo,'src/facility.mjs'));
 const candidate=await import(pathToFileURL(join(repo,'src/facility.mjs')));
 const before=structuredClone(plan);let output=null,candidateError=null;
 try{output=candidate.reoriginPlan(plan,target);candidate.validateFacility(output);}catch(error){candidateError=error.message;}
 assert.deepEqual(plan,before);
 let maximumError=null,midpointError=null;
 if(output){
  maximumError=0;
  for(const key of ['buildings','rooms'])for(const [i,item] of expected[key].entries())
   for(const [j,p] of item.footprint.entries())for(let axis=0;axis<2;axis++)
    maximumError=Math.max(maximumError,Math.abs(output[key][i].footprint[j][axis]-p[axis]));
  const edge=output.buildings[0].footprint,mid=output.rooms[0].footprint[1];
  midpointError=Math.max(...mid.map((value,axis)=>Math.abs(value-(edge[0][axis]+edge[1][axis])/2)));
 }
 const passed=candidateError===null && Number.isFinite(maximumError) && maximumError<=1e-9 &&
  Number.isFinite(midpointError) && midpointError<=1e-12;
 console.log(JSON.stringify({schema:'dvr.coordinate-integrity.replay.v1',
  baseline_source_revision:manifest.source_revision,baseline_source_sha256:manifest.files[0].sha256,
  original_receipt_sha256:sha(originalBytes),candidate_source_sha256:sha(source),
  generated_input_valid:true,independent_affine_plan_valid:true,baseline_plan_valid:false,baseline_error:baselineError,
  candidate_plan_valid:candidateError===null,candidate_error:candidateError,
  maximum_affine_error_metres:maximumError,boundary_midpoint_error_metres:midpointError,passed},null,2));
 if(requirePass && !passed)process.exitCode=1;
}finally{await rm(scratch,{recursive:true,force:true});}
