// Frozen Fraction expectations were written before the actual app helper existed.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath,pathToFileURL} from 'node:url';
const folder=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(folder,'../../../..');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function frozen(name,digest){const bytes=gunzipSync(fs.readFileSync(path.join(folder,name)));if(sha(bytes)!==digest)throw Error(`Frozen digest mismatch: ${name}`);return bytes;}
const input=frozen('inputs.json.gz','053566499b241abc8a3135a4e9b0b3c6b046f2b64f5968ebbd3db9f032dba0a5');
const expectedBytes=frozen('expected.json.gz','268d2b4c4c9f14f52fbda9e224fa52609f7afaa9e1bbdf482a91fb347825c12a');
const cases=JSON.parse(input),expected=JSON.parse(expectedBytes),prototype=process.argv.includes('--prototype');
const selected=prototype?path.join(folder,'prototype.mjs'):path.join(root,'src/planar-predicates.mjs');
const before=fs.readFileSync(selected),calibration=fs.readFileSync(path.join(root,'src/facility-calibration.mjs'));
const {orientationSign}=await import(pathToFileURL(selected).href);
if(cases.length!==2707||expected.length!==cases.length)throw Error('Incomplete frozen corpus.');
const failures=[];let assertions=0;
for(let i=0;i<cases.length;i++){
 const [o,a,b]=cases[i];
 for(const [points,want]of [[[o,a,b],expected[i]],[[o,b,a],-expected[i]],[[a,b,o],expected[i]]]){
  assertions++;const actual=orientationSign(...points);if(actual!==want)failures.push({i,actual,want});
 }
}
const sourceUnchanged=sha(before)===sha(fs.readFileSync(selected))&&sha(calibration)===sha(fs.readFileSync(path.join(root,'src/facility-calibration.mjs')));
if(!sourceUnchanged)failures.push({kind:'source-changed-during-replay'});
const receipt={schema:'intelligent-dvr-exact-orientation-evidence-v1',evaluated:prototype?'standalone-prototype':'actual-app-helper',cases:cases.length,assertions,failures,inputSha256:sha(input),expectedSha256:sha(expectedBytes),helperSha256:sha(before),calibrationSha256:sha(calibration),scriptSha256:sha(fs.readFileSync(fileURLToPath(import.meta.url))),sourceUnchanged,limits:'Exact sign checks of represented finite binary64 triples against Python Fraction expectations. This does not test the homography solver, physical calibration or measurement uncertainty. Historical prototype assumes valid pairs; actual malformed-input behavior is covered separately by focused unit tests.'};
const option=process.argv.indexOf('--output');
if(option>=0&&(!process.argv[option+1]||process.argv[option+1].startsWith('--')))throw Error('Supply an output path.');
const output=path.resolve(option>=0?process.argv[option+1]:path.join(os.tmpdir(),prototype?'dvr-orientation-prototype.json':'dvr-orientation-actual.json'));
fs.writeFileSync(output,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({output,evaluated:receipt.evaluated,cases:cases.length,assertions,failures:failures.length,helperSha256:receipt.helperSha256},null,2));
if(failures.length&&process.argv.includes('--require-pass'))process.exitCode=1;
