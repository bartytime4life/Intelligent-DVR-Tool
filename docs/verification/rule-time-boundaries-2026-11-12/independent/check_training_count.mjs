import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2),arg=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const here=path.dirname(fileURLToPath(import.meta.url)),sourcePath=arg('--training'),output=arg('--output');
if(!sourcePath||!output)throw Error('Use --training module.mjs --output receipt.json [--require-pass]');
const inputsPath=arg('--inputs',path.join(here,'inputs.json.gz')),adapterPath=arg('--adapter-inputs',path.join(here,'js-adapter-inputs.json.gz'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const source=fs.readFileSync(sourcePath),stored=fs.readFileSync(inputsPath),raw=inputsPath.endsWith('.gz')?zlib.gunzipSync(stored):stored;
const adapterStored=fs.readFileSync(adapterPath),adapterRaw=adapterPath.endsWith('.gz')?zlib.gunzipSync(adapterStored):adapterStored;
const original=JSON.parse(raw),adapter=JSON.parse(adapterRaw);
if(sha(raw)!==adapter.original_inputs_sha256||original.cases.length!==adapter.cases.length)throw Error('Adapter is not bound to frozen exact expectations');
for(let i=0;i<original.cases.length;i++){
  if(original.cases[i].id!==adapter.cases[i].id||original.cases[i].expected_event_indices.length!==adapter.cases[i].expected_count)throw Error('Adapter changed expected count');
}
const module=await import(`data:text/javascript;base64,${source.toString('base64')}`),failures=[];
for(const c of adapter.cases){
  const labeled=c.times.map((seconds,i)=>({seconds,score:c.matches[i] ? .9 : 0}));
  try{
    const actual=module.countObservations(labeled,.5,{dwell:c.dwell,maxGap:c.gap});
    if(actual!==c.expected_count)failures.push({id:c.id,expected_count:c.expected_count,actual_count:actual,domain:c.domain});
  }catch(e){failures.push({id:c.id,error:e.message});}
}
if(!source.equals(fs.readFileSync(sourcePath))||!stored.equals(fs.readFileSync(inputsPath))||!adapterStored.equals(fs.readFileSync(adapterPath)))throw Error('Source or inputs changed during replay');
const receipt={schema:'dvr-rule-time-js-count-receipt-v1',source_sha256:sha(source),inputs_sha256:sha(raw),adapter_inputs_sha256:sha(adapterRaw),checker_sha256:sha(fs.readFileSync(fileURLToPath(import.meta.url))),cases:adapter.cases.length,samples:adapter.cases.reduce((n,c)=>n+c.times.length,0),assertions:adapter.cases.length,failure_count:failures.length,failures,source_and_inputs_unchanged:true,limits:['Supplemental browser-training count adapter; exact-rational expected event counts are copied from the unchanged Python corpus.','Does not assert invalid-input rejection because countObservations has a validated-input caller contract.','No media, camera or inference.']};
fs.writeFileSync(output,`${JSON.stringify(receipt,null,2)}\n`);
console.log(JSON.stringify(Object.fromEntries(['source_sha256','inputs_sha256','adapter_inputs_sha256','checker_sha256','cases','samples','assertions','failure_count'].map(k=>[k,receipt[k]])),null,2));
if(args.includes('--require-pass')&&failures.length)process.exitCode=1;
