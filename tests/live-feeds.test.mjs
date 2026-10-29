import test from 'node:test';
import assert from 'node:assert/strict';
import {webcamController, webcamError, feedRequest, localFeedOrigin, visibleFeedTiles} from '../src/live-feeds.mjs';
function stream() {
  const track=new EventTarget();track.readyState='live';track.stop=()=>{track.readyState='ended';};
  return {track,getTracks:()=>[track],getVideoTracks:()=>[track]};
}
test('stopping an unused webcam keeps the source absent after network-only previews',async()=>{
  const states=[];let requests=0;
  const controller=webcamController({getUserMedia:async()=>{requests++;return stream();}},s=>states.push(s));
  controller.stop();
  controller.stop('Preview stopped while the page was hidden. Connect again when ready.');
  assert.equal(requests,0);
  assert.deepEqual(states.at(-1),{state:'disconnected',message:'No webcam connected'});
  await controller.connect();controller.stop();
  assert.equal(states.at(-1).message,'Disconnected');
  controller.stop('No webcam connected');controller.stop();
  assert.deepEqual(states.at(-1),{state:'disconnected',message:'No webcam connected'});
});
test('webcam is explicit, video-only, bounded and releases tracks on disconnect',async()=>{
  const states=[], value=stream();let options;
  const controller=webcamController({getUserMedia:async(o)=>{options=o;return value;}},s=>states.push(s));
  assert.equal(options,undefined);await controller.connect('selected-device');
  assert.equal(options.audio,false);assert.deepEqual(options.video.deviceId,{exact:'selected-device'});
  assert.equal(options.video.width.max,1920);assert.equal(states.at(-1).state,'live');
  controller.stop();assert.equal(value.track.readyState,'ended');assert.equal(states.at(-1).state,'disconnected');
});
test('cancel while permission is pending stops a late stream and never opens it',async()=>{
  const states=[], value=stream();let resolve;
  const controller=webcamController({getUserMedia:()=>new Promise(r=>resolve=r)},s=>states.push(s));
  const pending=controller.connect();controller.stop();resolve(value);await pending;
  assert.equal(value.track.readyState,'ended');assert.equal(states.some(s=>s.state==='live'),false);
});
test('permission errors are actionable and reconnect recovers',async()=>{
  const states=[], value=stream();let failed=true;
  const controller=webcamController({getUserMedia:async()=>{if(failed)throw {name:'NotAllowedError'};return value;}},s=>states.push(s));
  await controller.connect();assert.match(states.at(-1).message,/Allow camera access/);
  failed=false;await controller.connect();assert.equal(states.at(-1).state,'live');
  value.track.dispatchEvent(new Event('mute'));assert.equal(states.at(-1).state,'interrupted');
  value.track.dispatchEvent(new Event('unmute'));assert.equal(states.at(-1).state,'live');
  value.track.dispatchEvent(new Event('ended'));assert.equal(states.at(-1).state,'disconnected');
});
test('switching a webcam cancels superseded permission results',async()=>{
  const states=[], a=stream(), b=stream(), resolvers=[];
  const controller=webcamController({getUserMedia:()=>new Promise(r=>resolvers.push(r))},s=>states.push(s));
  const first=controller.connect('a'), second=controller.connect('b');
  resolvers[1](b);await second;resolvers[0](a);await first;
  assert.equal(a.track.readyState,'ended');assert.equal(b.track.readyState,'live');controller.stop();
});
test('local bridge requires exact loopback origin and authenticates mutations',async()=>{
  assert.equal(localFeedOrigin({protocol:'http:',hostname:'127.0.0.1'}),true);
  for(const hostname of ['localhost','example.com','127.0.0.1.evil'])assert.equal(localFeedOrigin({protocol:'http:',hostname}),false);
  let called;await feedRequest('/connect',{token:'token',body:{source:'dock'}},async(...args)=>{called=args;return {ok:true};});
  assert.equal(called[0],'/api/feeds/connect');assert.equal(called[1].headers['X-DVR-Token'],'token');
  assert.deepEqual(JSON.parse(called[1].body),{source:'dock'});
  await assert.rejects(feedRequest('/session',{},async()=>{throw Error('native secret');}),/service is unavailable/);
  await assert.rejects(feedRequest('/connect',{},async()=>({ok:false,json:async()=>({error:{message:'Select a configured source.'}})})),/configured source/);
});
test('webcam failures never echo native error details',()=>{
  assert.doesNotMatch(webcamError({message:'private device id'}),/private device id/);
  assert.match(webcamError({name:'NotFoundError'}),/Attach a USB/);
  assert.match(webcamError({name:'NotSupportedError'}),/browser build does not support webcam/);
});

test('one, two and four visible feed limits always include the selected source',()=>{
  const tiles = ['a','b','c','d'].map(id=>({id}));
  for (const limit of [1,2,4]) {
    const visible=visibleFeedTiles(tiles,'d',limit);
    assert.equal(visible.length,limit);assert.ok(visible.some(t=>t.id==='d'));
  }
  assert.deepEqual(visibleFeedTiles([],'absent',2),[]);
  assert.deepEqual(visibleFeedTiles(tiles,'absent',2),tiles.slice(0,2));
});
