import test from 'node:test';
import assert from 'node:assert/strict';
import {clearSavedZoneOffer, createZoneImageWriter, loadZoneImage, zoneImageForPlan} from '../src/zone-images.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
const offer=name=>({blob:new Blob([`generated still ${name}`]),source:name});
function decoder() {
  const images=[],created=[],revoked=[],states=[];
  class ImageClass{constructor(){images.push(this);this.naturalWidth=640;this.naturalHeight=360;}}
  const options={ImageClass,urls:{createObjectURL(blob){const url=`blob:generated-${created.length}`;created.push({url,blob});return url;},revokeObjectURL:url=>revoked.push(url)}};
  return{images,created,revoked,states,options,publish:value=>states.push(value)};
}

test('switching plans hides foreign pixels at render time before the new image effect runs',async()=>{
  const d=decoder();
  const close=loadZoneImage(1,d.publish,{...d.options,read:async()=>offer('A').blob});
  await flush();d.images[0].onload();
  const state=d.states.at(-1);
  assert.equal(zoneImageForPlan(state,1).url,'blob:generated-0');
  assert.equal(zoneImageForPlan(state,2),null);
  close();assert.deepEqual(d.revoked,['blob:generated-0']);
});

test('a delayed new-plan read shows a loading grid and cannot reuse the previous plan image',async()=>{
  const d=decoder(),read=deferred();
  const close=loadZoneImage(2,d.publish,{...d.options,read:()=>read.promise});
  assert.deepEqual(d.states,[{planId:2,phase:'loading',image:null}]);
  assert.equal(zoneImageForPlan(d.states.at(-1),2),null);
  read.resolve(offer('B').blob);await flush();d.images[0].onload();
  assert.equal(d.states.at(-1).planId,2);assert.equal(zoneImageForPlan(d.states.at(-1),2).width,640);
  close();
});

test('late storage replies from an abandoned plan create no URL or stale image state',async()=>{
  const d=decoder(),read=deferred();
  const close=loadZoneImage(1,d.publish,{...d.options,read:()=>read.promise});
  await flush();close();const count=d.states.length;
  read.resolve(offer('abandoned').blob);await flush();
  assert.equal(d.states.length,count);assert.equal(d.created.length,0);
});

test('an old decode callback cannot replace the newly selected plan and its URL is released once',async()=>{
  const d=decoder();
  const old=loadZoneImage(1,d.publish,{...d.options,read:async()=>offer('A').blob});
  await flush();const stale=d.images[0].onload;old();
  const current=loadZoneImage(2,d.publish,{...d.options,read:async()=>offer('B').blob});
  await flush();stale();assert.equal(d.states.at(-1).phase,'loading');assert.equal(d.states.at(-1).planId,2);
  d.images[1].onload();assert.equal(zoneImageForPlan(d.states.at(-1),2).url,'blob:generated-1');
  current();assert.deepEqual(d.revoked,['blob:generated-0','blob:generated-1']);
});

test('empty, failed and zero-dimension images never become a usable plan still',async()=>{
  for(const mode of ['empty','read-error','decode-error','zero-size']) {
    const d=decoder();const close=loadZoneImage(1,d.publish,{...d.options,read:async()=>{
      if(mode==='read-error')throw Error('Generated storage error');return mode==='empty'?null:offer(mode).blob;
    }});await flush();
    if(mode==='decode-error')d.images[0].onerror();
    if(mode==='zero-size'){d.images[0].naturalWidth=0;d.images[0].onload();}
    assert.equal(d.states.at(-1).phase,mode==='empty'?'empty':'failed');
    assert.equal(zoneImageForPlan(d.states.at(-1),1),null);close();
    assert.equal(d.created.length,d.revoked.length);
  }
});

test('a save captures its plan and offer, blocks concurrent save/remove and preserves a newer offered frame',async()=>{
  const pending=deferred(),calls=[],states=[];const first=offer('A'),newer=offer('B');
  const writer=createZoneImageWriter(value=>states.push(value),{put:async(store,key,blob)=>{calls.push({store,key,blob});return pending.promise;},remove:async()=>assert.fail('Concurrent removal must be blocked')});
  const saving=writer.save(1,first);
  assert.equal(await writer.save(2,newer),null);assert.equal(await writer.remove(1),null);
  assert.equal(states[0].planId,1);assert.equal(states[0].offer,first);
  pending.resolve(true);const result=await saving;
  assert.equal(result.ok,true);assert.equal(result.planId,1);assert.equal(result.offer,first);
  assert.deepEqual(calls,[{store:'zone-stills',key:'plan-1',blob:first.blob}]);
  assert.equal(clearSavedZoneOffer(newer,result.offer),newer);
  assert.equal(clearSavedZoneOffer(first,result.offer),null);
  assert.equal(clearSavedZoneOffer(null,result.offer),null);assert.equal(states.at(-1),null);writer.close();
});

test('storage refusal and exceptions preserve the offer and release the explicit operation guard',async()=>{
  const first=offer('A');let writes=0;
  const writer=createZoneImageWriter(()=>{},{put:async()=>{if(writes++===0)throw Error('Generated quota failure');return false;},remove:async()=>false});
  for(let i=0;i<2;i++) {
    const result=await writer.save(1,first);assert.equal(result.ok,false);assert.equal(result.offer,first);
  }
  const removal=await writer.remove(2);assert.equal(removal.ok,false);assert.equal(removal.planId,2);writer.close();
});

test('closing with a save in flight suppresses its late receipt and state callbacks',async()=>{
  const pending=deferred(),states=[];
  const writer=createZoneImageWriter(value=>states.push(value),{put:()=>pending.promise});
  const saving=writer.save(1,offer('A'));writer.close();const count=states.length;
  pending.resolve(true);assert.equal(await saving,null);assert.equal(states.length,count);
  assert.equal(await writer.save(2,offer('B')),null);
});
