import fs from 'node:fs';
import {sha,readRepo,frozen,sourceCapture,engine,repoUrl,finish} from './replay-support.mjs';
const inputs=frozen('rehearsal-inputs.json.gz','57a234a10125544cdfe2a148393bc16c2b52124a675d2b470f2e616fb7e4d315'),scenes=JSON.parse(inputs);
const capture=sourceCapture(['src/facility-visibility.mjs','src/facility-polygon.mjs','src/facility-visibility-protocol.mjs','src/facility.mjs','node_modules/polyclip-ts/dist/esm/index.js','node_modules/bignumber.js/bignumber.mjs']);
if(!process.argv.includes('--baseline'))process.argv.push('--baseline');
const evaluated=await engine(),baseline=evaluated.module,candidate=await import(repoUrl('src/facility-visibility.mjs'));
const results=[];
for(const scene of scenes){
 const result={kind:scene.kind,cameras:500,samples:scene.samples};
 for(const [name,engine] of [['baseline',baseline],['candidate',candidate]]){
  const start=performance.now(),snapshot=engine.planVisibility(scene.plan),geometryMs=performance.now()-start;
  const before=performance.now(),rows=engine.rehearseVisibility(scene.plan,snapshot,scene.samples),rehearsalMs=performance.now()-before;
  const warm=performance.now(),again=engine.rehearseVisibility(scene.plan,snapshot,scene.samples),warmMs=performance.now()-warm;
  const bytes=Buffer.from(JSON.stringify(rows));
  result[name]={geometryMs,rehearsalMs,warmMs,estimated:snapshot.estimated,vertices:snapshot.cameras[0].polygons[0][0].length,observations:rows.reduce((sum,row)=>sum+row.cameras.length,0),outputSha256:sha(bytes),repeatSame:JSON.stringify(again)===bytes.toString()};
 }
 result.exactOutputMatch=result.baseline.outputSha256===result.candidate.outputSha256;results.push(result);
}
evaluated.cleanup();
const expected={coincident:{observations:50500,sha256:'ed5f4042534a1225be76d1db5784f57179b6036a9479748a45385b1d020ad53f'},'distinct-bearing':{observations:49502,sha256:'f8ae88cb8d532d570d12d0e6c02f416097ebed4c22bd5da71d487c4d8a16b010'}};
const failures=results.filter(r=>!r.exactOutputMatch||!r.baseline.repeatSame||!r.candidate.repeatSame||!r.baseline.estimated||!r.candidate.estimated||['baseline','candidate'].some(k=>r[k].observations!==expected[r.kind].observations||r[k].outputSha256!==expected[r.kind].sha256)).map(r=>({kind:r.kind,reason:'Output mismatch, repeat mismatch or unavailable geometry'}));
const receipt={cases:scenes.length,failures,baselineSourceSha256:evaluated.digest,candidateSourceSha256:sha(readRepo('src/facility-visibility.mjs')),inputsSha256:sha(inputs),scriptSha256:sha(fs.readFileSync(new URL(import.meta.url))),sources:capture.hashes,sourceUnchanged:capture.unchanged(),results,limits:'Single-machine generated metadata benchmark, explicit 101 samples, no footage/inference. First query includes geometry preparation; warm query reuses immutable prepared geometry. Timing is diagnostic, not an admission, latency guarantee or hardware/camera capacity claim.'};
finish(receipt,'dvr-frustum-rehearsal-replay.json');
