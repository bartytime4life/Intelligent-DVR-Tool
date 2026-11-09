import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DEFAULT_LIBRARY_CONFIG, libraryRequest, libraryConfig, cameraConfig, openLibraryItem, libraryCoverage, storageSize } from '../src/backup-library.mjs';
import { MAX_VIDEO_BYTES } from '../src/recognition.mjs';
import { recognitionFixture } from './fixtures/recognition.mjs';

const video = Buffer.from('controlled DVR backup bytes');
const sha = createHash('sha256').update(video).digest('hex');
const row = {id:'a'.repeat(32),name:'driveway.mp4',state:'completed',sha256:sha,bytes:video.length};
const serve = (resultSha = sha, source = video) => async path => new Response(path.endsWith('/result') ? JSON.stringify(recognitionFixture(resultSha)) : source);
const folders = {...DEFAULT_LIBRARY_CONFIG,source_folder:'/media/oem',backup_folder:'/media/backup'};

test('folder settings accept explicit integers and send only known fields', () => {
  assert.deepEqual(libraryConfig({...folders,max_storage_gib:'100',reserve_gib:'2',settle_seconds:'60',unrelated:'ignored'}), folders);
  assert.equal(libraryConfig({...folders,source_folder:' /media/oem '} ).source_folder,'/media/oem');
});
test('folder settings refuse same directories, absent paths and invalid resource bounds', () => {
  assert.throws(() => libraryConfig({...folders,backup_folder:'/media/oem/'}),/separate/);
  assert.throws(() => libraryConfig({...folders,source_folder:''}),/Choose/);
  for (const [key,values] of [['max_storage_gib',[0,1000001,2.5,'']],['reserve_gib',[0,1025]],['settle_seconds',[29,3601]],['recursive',[1,'true']]]) {
    for (const value of values) assert.throws(() => libraryConfig({...folders,[key]:value}));
  }
});
test('camera setup accepts explicit private channel and preserves credentials only in body', async () => {
  const camera=cameraConfig({name:' Front entrance ',host:'192.168.1.20',port:'554',path:'/documented/channel?stream=main',username:'admin',password:'private secret'});
  assert.equal(camera.name,'Front entrance'); assert.equal(camera.port,554);
  await libraryRequest('/cameras',{setup:true,token:'private-token',body:camera,fetcher:async (url,options) => {
    assert.equal(url,'/api/setup/cameras'); assert.equal(options.method,'POST');
    assert.equal(options.headers['X-DVR-Token'],'private-token'); assert.equal(options.credentials,'same-origin');
    assert.equal(options.redirect,'error'); assert.equal(options.cache,'no-store');
    assert.equal(JSON.parse(options.body).password,'private secret');
    assert.ok(options.signal instanceof AbortSignal); return new Response('{}');
  }});
});
test('camera setup refuses public, loopback, ambiguous or URL host inputs and undocumented path forms', () => {
  const values={name:'Driveway',host:'10.0.0.20',port:554,path:'/known'};
  for (const host of ['8.8.8.8','127.0.0.1','172.32.0.1','192.168.01.1','10.0.0.999','rtsp://192.168.1.20','camera.local']) assert.throws(()=>cameraConfig({...values,host}),/private|IPv4/);
  for (const host of ['10.0.0.1','172.16.0.1','172.31.255.254','192.168.2.30']) assert.equal(cameraConfig({...values,host}).host,host);
  for (const path of ['','channel','//elsewhere','/newline\n','/fragment#secret']) assert.throws(()=>cameraConfig({...values,path}),/channel path/);
  for (const port of [0,65536,2.2,'bad']) assert.throws(()=>cameraConfig({...values,port}),/port/);
});
test('status is read only; actions require bodies; local endpoint errors preserve status and explanation', async () => {
  const requests=[];
  const fetcher=async(url,options)=>{requests.push([url,options]); return new Response('{}');};
  await libraryRequest('/status',{token:'t',fetcher}); await libraryRequest('/stop',{token:'t',body:{},fetcher});
  assert.equal(requests[0][0],'/api/library/status'); assert.equal(requests[0][1].method,'GET'); assert.equal(requests[1][1].body,'{}');
  for (const error of ['Check backup disk',{message:'Check backup disk'}]) {
    await assert.rejects(libraryRequest('/status',{fetcher:async()=>new Response(JSON.stringify({error}),{status:503})}),err=>err.status===503&&err.message==='Check backup disk');
  }
  await assert.rejects(libraryRequest('/status',{fetcher:async()=>{throw Error('Failed to fetch');}}),/backup service.*unavailable/);
  await assert.rejects(libraryRequest('/../private',{fetcher}),/Invalid/);
});
test('backup review reuses recognition parser and verifies result and exact copied source', async () => {
  const opened=await openLibraryItem(row,'token',undefined,serve());
  assert.equal(opened.bundle.receipt.source_sha256,sha); assert.equal(opened.file.size,video.length); assert.equal(opened.name,row.name);
  await assert.rejects(openLibraryItem(row,'token',undefined,serve('f'.repeat(64))),/fingerprint changed/);
  await assert.rejects(openLibraryItem(row,'token',undefined,serve(sha,Buffer.from('changed'))),/does not match/);
});
test('incomplete, invalid-id, oversized and cancelled reviews cannot replace a current review', async () => {
  for (const change of [{state:'queued'},{id:'../../private'},{sha256:'bad'}]) await assert.rejects(openLibraryItem({...row,...change},'t'),/completed/);
  await assert.rejects(openLibraryItem({...row,bytes:MAX_VIDEO_BYTES+1},'t'),/too large/);
  const controller=new AbortController(); controller.abort();
  await assert.rejects(openLibraryItem(row,'t',controller.signal,async()=>assert.fail('Cancelled opening must not fetch')),/cancelled/);
  await assert.rejects(openLibraryItem(row,'t',undefined,async()=>new Response('too big',{headers:{'content-length':String(MAX_VIDEO_BYTES+1)}})),/size limit/);
});
test('cancelling a backup review terminates its hashing worker', {timeout:1000}, async () => {
  const originalWorker=globalThis.Worker, controller=new AbortController(); let terminated=false;
  globalThis.Worker=class {
    postMessage() { queueMicrotask(()=>controller.abort()); }
    terminate() { terminated=true; }
  };
  try {
    await assert.rejects(openLibraryItem(row,'t',controller.signal,serve()),error=>error.name==='AbortError');
    assert.equal(terminated,true);
  } finally {globalThis.Worker=originalWorker;}
});
test('coverage is absent until completion and remains qualified for partial or missing metadata', () => {
  assert.equal(libraryCoverage({state:'analyzing',coverage:'completed'}),'');
  assert.equal(libraryCoverage({state:'completed',coverage:'completed'}),'Analysis finished · recording coverage unverified');
  assert.equal(libraryCoverage({state:'completed',coverage:'partial'}),'Partial analysis · recording coverage unverified');
  assert.match(libraryCoverage({state:'completed',coverage:'unverified'}),/unverified/);
  assert.match(libraryCoverage({state:'completed',coverage:{}}),/unverified/);
  assert.match(libraryCoverage({state:'completed',coverage:{termination:'frame-limit',status:'not-checked'}}),/frame limit|frame-limit|frame limit|decoded-frame limit/);
  assert.equal(storageSize(1024**3),'1.0 GiB'); assert.equal(storageSize(undefined),'not available');
});
