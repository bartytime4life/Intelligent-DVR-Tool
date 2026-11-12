import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';

const args=process.argv.slice(2),at=args.indexOf('--repo');
if(at<0 || !args[at+1] || args[at+1].startsWith('--') || args.length!==2)
 throw Error('Usage: node replay.mjs --repo <checkout>');
const repo=resolve(args[at+1]),frozen=new URL('./frozen/',import.meta.url);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifestBytes=await readFile(new URL('manifest.json',frozen));
assert.equal(hash(manifestBytes),'61dc87795038cee4a29f688db7787a926cc01fc9715a1873e911708cddcd9062');
const manifest=JSON.parse(manifestBytes),files=new Map();
for(const file of manifest.files){
 assert.match(file.path,/^(?:SystemSetup\.jsx|FacilityBuilder\.jsx|resources\.mjs|facility-measurements\.mjs|facility-installer\.mjs|before\.json|inputs\.json)$/);
 const bytes=await readFile(new URL(file.path,frozen));assert.equal(hash(bytes),file.sha256);assert.equal(bytes.length,file.bytes);
 files.set(file.path,bytes.toString());
}
const inputs=JSON.parse(files.get('inputs.json')),before=JSON.parse(files.get('before.json'));
const load=name=>import(pathToFileURL(join(repo,'src',name)));
const {formatReadoutNumber,formatCoveragePercent}=await load('readout-format.mjs');
const {formatDistance}=await load('facility-measurements.mjs');
const {calculateSetup,validateSetup}=await load('resources.mjs');
const {blankFacility,validateFacility}=await load('facility.mjs');
const {planVisibility}=await load('facility-visibility.mjs');
const {coverageMetrics}=await load('facility-coverage.mjs');
const {installerRows}=await load('facility-installer.mjs');
// This record isolates display changes: the setup arithmetic must match its
// captured source. Other geometry/model sources are bound in source-manifest.json.
assert.equal(hash(await readFile(join(repo,'src/resources.mjs'))),before.source_sha256['resources.mjs']);
// Evaluate only hash-verified public formatter expressions, never arbitrary JSX.
const oldN=Function('return ('+files.get('SystemSetup.jsx').match(/const n = ([^\n]+);/)[1]+')')();
const oldPercent=Function('return ('+files.get('FacilityBuilder.jsx').match(/const percent = ([^\n]+);/)[1]+')')();
const oldNumber=Function('return ('+files.get('facility-measurements.mjs').match(/const number = ([^\n]+);/)[1]+')')();
const near=(a,b)=>assert.ok(Math.abs(a-b)<=1e-12,`${a} vs ${b}`);
const initial=structuredClone(inputs),model=calculateSetup(inputs.system),system={};
for(const [name,captured] of Object.entries(before.system.metrics)){
 assert.equal(model[name],captured.value);
 const digits=name==='ingressMbps'?0:1;
 assert.equal(oldN(model[name],digits),captured.display);
 const shown=formatReadoutNumber(model[name],{digits,locale:'en-US'});assert.notEqual(shown,'0');
 system[name]={value:model[name],before:captured.display,after:shown};
}
assert.deepEqual(validateSetup(JSON.parse(JSON.stringify(inputs.system))),inputs.system);
const plan=validateFacility({...blankFacility(),cameras:[inputs.camera],route:inputs.route,zones:[inputs.zone]});
const snapshot=planVisibility(plan),byId=new Map(snapshot.cameras.map(camera=>[camera.id,camera]));
const metrics=coverageMetrics(plan,camera=>byId.get(camera.id));
// Independent exact rational truth: side planes are x=0,y=0. Neither vertical
// near nor300m radial limit binds. No production polygon supplies expected truth.
near(metrics.route.coverage,3000/3001);near(metrics.route.uncoveredLength,1/25);
near(metrics.route.longestBlindStretch,1/25);near(metrics.zones[0].coverage,9999/10000);
near(metrics.zones[0].uncoveredArea,1/1000);assert.ok(metrics.zones[0].blindSpots.length>0);
assert.equal(oldPercent(metrics.route.coverage),'100.0%');assert.equal(oldNumber(metrics.route.uncoveredLength)+' m','0.0 m');
assert.equal(formatCoveragePercent(metrics.route.coverage),'>99.9%');assert.equal(formatDistance(metrics.route.uncoveredLength),'0.04 m');
assert.equal(formatCoveragePercent(metrics.zones[0].coverage),'>99.9%');
for(const value of [Number.MIN_VALUE,1e-300,1e-20,1-Number.EPSILON/2]){
 const shown=formatCoveragePercent(value);assert.notEqual(shown,'0.0%');assert.notEqual(shown,'100.0%');
}
const steep=validateFacility({...blankFacility(),cameras:[inputs.steepCamera]});
assert.equal(installerRows(steep)[0].range,'1.0 m · ground 0.000 m–0.031 m');
assert.equal(formatDistance(-.01),'-0.01 m');assert.equal(formatDistance(-0),'0.0 m');
assert.equal(formatCoveragePercent(NaN),'—');assert.deepEqual(inputs,initial);
const source={};
for(const name of ['readout-format.mjs','SystemSetup.jsx','FacilityBuilder.jsx','facility-measurements.mjs','facility-installer.mjs','FacilityStairs.jsx'])
 source[name]=hash(await readFile(join(repo,'src',name)));
console.log(JSON.stringify({schema:'dvr.planning-readouts.replay.v1',baseline_revision:manifest.source_revision,
 frozen_manifest_sha256:hash(manifestBytes),source,system,
 route:{coverage:metrics.route.coverage,uncoveredMetres:metrics.route.uncoveredLength,beforePercent:oldPercent(metrics.route.coverage),
  afterPercent:formatCoveragePercent(metrics.route.coverage),beforeGap:oldNumber(metrics.route.uncoveredLength)+' m',afterGap:formatDistance(metrics.route.uncoveredLength)},
 zone:{coverage:metrics.zones[0].coverage,uncoveredSquareMetres:metrics.zones[0].uncoveredArea,beforePercent:oldPercent(metrics.zones[0].coverage),afterPercent:formatCoveragePercent(metrics.zones[0].coverage)},
 method:'Display-only checks against captured formatter source and independent rational planning inputs; generated software evidence, not physical accuracy.',passed:true},null,2));
