import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredFacilitySources, facilityPreviewController, plannedViewAngles } from '../src/facility-camera-preview.mjs';
const ID = 'a'.repeat(32);
const catalog = {ready:true,token:'test-token',sources:[{id:'dock',name:'Dock substream',kind:'rtsp'}]};
const tick = () => new Promise(resolve => setImmediate(resolve));
function stream() {
  const track = new EventTarget(); track.readyState = 'live'; track.stop = () => {track.readyState='ended';};
  return {track,getTracks:()=>[track],getVideoTracks:()=>[track]};
}
function setup(request, media) {
  const states=[], urls=[], revoked=[], callbacks=[];
  const controller=facilityPreviewController({request,media,onState:s=>states.push(s),
    schedule:callback=>{callbacks.push(callback);return callbacks.length;},cancel:()=>{},
    urls:{createObjectURL:()=>{const value='blob:'+urls.length;urls.push(value);return value;},revokeObjectURL:value=>revoked.push(value)}});
  return {controller,states,urls,revoked,callbacks};
}
test('planned bearings wrap around north and do not infer calibration',()=>{
  assert.deepEqual(plannedViewAngles({bearing:350,hfov:80,vfov:50,tilt:20}),{left:310,center:350,right:30,horizontal:80,vertical:50,tilt:20});
  assert.equal(plannedViewAngles({bearing:NaN}),null);
});
test('facility source choices include only bounded configured LAN source IDs',()=>{
  assert.deepEqual(configuredFacilitySources({...catalog,sources:[...catalog.sources,{id:'https://remote',name:'bad',kind:'rtsp'},{id:'public',name:'public',kind:'public-jpeg'}]}),catalog.sources);
});
test('constructing the preview makes no requests and cannot connect arbitrary URLs or public sources',async()=>{
  const calls=[];const {controller}=setup(async(...args)=>{calls.push(args);});
  assert.equal(calls.length,0);
  await assert.rejects(controller.connectNetwork(catalog,'https://untrusted'),/configured local DVR/);
  await assert.rejects(controller.connectNetwork({...catalog,ready:false},'dock'),/configured local DVR/);
  assert.equal(calls.length,0);
});
test('network preview retains one bounded JPEG and disconnect revokes it with authenticated cleanup',async()=>{
  const calls=[];
  const {controller,states,callbacks,urls,revoked}=setup(async(path,options)=>{
    calls.push({path,options});
    if(path==='/connect')return {json:async()=>({id:ID,state:'connecting'})};
    if(path===`/${ID}`)return {json:async()=>({state:'live'})};
    if(path.endsWith('/frame'))return {blob:async()=>new Blob(['frame'],{type:'image/jpeg'})};
    return {};
  });
  await controller.connectNetwork(catalog,'dock');await tick();
  assert.equal(states.at(-1).sourceName,'Dock substream');assert.equal(states.at(-1).state,'live');
  assert.equal(urls.length,1);callbacks.shift()();await tick();
  assert.equal(urls.length,2);assert.deepEqual(revoked,['blob:0']);
  await controller.stop();assert.deepEqual(revoked,['blob:0','blob:1']);
  assert.equal(calls.at(-1).path,`/${ID}/disconnect`);assert.equal(calls.at(-1).options.token,'test-token');
  assert.equal(states.at(-1).state,'disconnected');
  const count=calls.length;callbacks.shift()();await tick();assert.equal(calls.length,count);
});
test('cancelling while a network connect is pending cleans up the late session without polling it',async()=>{
  let resolve;const calls=[];
  const {controller,states}=setup(async(path,options)=>{
    calls.push(path);
    if(path==='/connect')return new Promise(r=>resolve=r);
    return {};
  });
  const pending=controller.connectNetwork(catalog,'dock');await tick();await controller.stop();
  resolve({json:async()=>({id:ID})});await pending;
  assert.deepEqual(calls,['/connect',`/${ID}/disconnect`]);
  assert.equal(states.some(s=>s.state==='live'),false);
});
test('malformed session IDs never become request paths',async()=>{
  const calls=[];const {controller,states}=setup(async(path)=>{calls.push(path);return {json:async()=>({id:'../../admin'})};});
  await controller.connectNetwork(catalog,'dock');assert.deepEqual(calls,['/connect']);assert.equal(states.at(-1).state,'failed');
});
test('oversized and non-JPEG frames are discarded and their sessions stopped',async()=>{
  for(const blob of [new Blob(['bad'],{type:'text/html'}),new Blob([new Uint8Array(512*1024+1)],{type:'image/jpeg'})]) {
    const calls=[];const {controller,states,urls}=setup(async(path)=>{
      calls.push(path);if(path==='/connect')return {json:async()=>({id:ID})};
      if(path===`/${ID}`)return {json:async()=>({state:'live'})};
      if(path.endsWith('/frame'))return {blob:async()=>blob};return {};
    });
    await controller.connectNetwork(catalog,'dock');await tick();
    assert.equal(urls.length,0);assert.equal(states.at(-1).state,'failed');assert.equal(calls.at(-1),`/${ID}/disconnect`);
  }
});
test('webcam requests remain video-only and camera changes cancel late permission results',async()=>{
  let resolve, options;const value=stream();
  const {controller,states}=setup(async()=>{}, {getUserMedia:args=>{options=args;return new Promise(r=>resolve=r);}});
  const pending=controller.connectWebcam('selected','USB camera');await tick();
  assert.equal(options.audio,false);assert.equal(options.video.width.max,1920);
  await controller.stop();resolve(value);await pending;
  assert.equal(value.track.readyState,'ended');assert.equal(states.some(s=>s.state==='live'),false);
});
test('cancel during network cleanup prevents a pending webcam activation',async()=>{
  let close;let webcamCalls=0;
  const {controller}=setup(async(path)=>{
    if(path==='/connect')return {json:async()=>({id:ID})};
    if(path===`/${ID}`)return {json:async()=>({state:'connecting'})};
    if(path.endsWith('/disconnect'))return new Promise(resolve=>close=resolve);
  },{getUserMedia:async()=>{webcamCalls++;return stream();}});
  await controller.connectNetwork(catalog,'dock');await tick();
  const pending=controller.connectWebcam();await tick();await controller.stop();close({});await pending;
  assert.equal(webcamCalls,0);
});
test('a superseded webcam promise cannot stop the newer preview',async()=>{
  const resolvers=[], older=stream(), newer=stream();
  const {controller,states}=setup(async()=>{}, {getUserMedia:()=>new Promise(resolve=>resolvers.push(resolve))});
  const first=controller.connectWebcam('first','First');await tick();
  const second=controller.connectWebcam('second','Second');await tick();
  resolvers[1](newer);await second;resolvers[0](older);await first;
  assert.equal(older.track.readyState,'ended');assert.equal(newer.track.readyState,'live');
  assert.equal(states.at(-1).sourceName,'Second');await controller.stop();
});
