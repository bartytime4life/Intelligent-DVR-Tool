import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath,pathToFileURL} from 'node:url';
export const folder=path.dirname(fileURLToPath(import.meta.url));
export const root=path.resolve(folder,'../../../..');
export const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export const readRepo=file=>fs.readFileSync(path.join(root,file));
export const repoUrl=file=>pathToFileURL(path.join(root,file)).href;
export function option(name) { const i=process.argv.indexOf(name); if(i<0)return null; if(!process.argv[i+1]||process.argv[i+1].startsWith('--'))throw Error(`Missing ${name} value`);return process.argv[i+1]; }
export const requirePass=process.argv.includes('--require-pass');
export function frozen(name,digest) { const bytes=gunzipSync(fs.readFileSync(path.join(folder,name))); if(sha(bytes)!==digest)throw Error(`Frozen input digest mismatch: ${name}`);return bytes; }
export function sourceCapture(files) { const hashes=Object.fromEntries(files.map(file=>[file,sha(readRepo(file))]));return {hashes,unchanged:()=>Object.entries(hashes).every(([file,digest])=>sha(readRepo(file))===digest)}; }
export function finish(receipt,defaultName) { if(!receipt.sourceUnchanged)receipt.failures.push({kind:'source-changed-during-replay'});if(receipt.configRestored===false)receipt.failures.push({kind:'decimal-config-not-restored'});receipt.replaySupportSha256=sha(fs.readFileSync(fileURLToPath(import.meta.url))); const output=path.resolve(option('--output')||path.join(os.tmpdir(),defaultName)); fs.writeFileSync(output,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({output,cases:receipt.cases,assertions:receipt.assertions,failures:receipt.failures?.length??0,candidateSha256:receipt.candidateSha256||receipt.candidateSourceSha256||receipt.coverageSha256},null,2));if(requirePass&&receipt.failures?.length)process.exitCode=1; }
export async function engine() {
 if(!process.argv.includes('--baseline')) { const source=readRepo('src/facility-visibility.mjs');return {module:await import(repoUrl('src/facility-visibility.mjs')),digest:sha(source),baseline:false,cleanup:()=>{}}; }
 const bytes=frozen('baseline-c2f8e13a.mjs.gz','c2f8e13a86e1a0b4e15d92fa2e61a0585d143576dcaa48cda2c38aad6fcefb53');
 const executable=bytes.toString('utf8').replace(/from '(\.\/[^']+)'/g,(_,relative)=>`from '${repoUrl('src/'+relative.slice(2))}'`);
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'dvr-frustum-baseline-')),target=path.join(temporary,'baseline.mjs');fs.writeFileSync(target,executable);
 try {return {module:await import(pathToFileURL(target).href),digest:sha(bytes),executedSha256:sha(Buffer.from(executable)),baseline:true,cleanup:()=>fs.rmSync(temporary,{recursive:true,force:true})};}catch(error){fs.rmSync(temporary,{recursive:true,force:true});throw error;}
}
