import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClipRecorder, CLIP_BYTES } from '../src/clip-capture.mjs';
import { importRecording } from '../src/local-analysis.mjs';

function fixture(){
  let recorder,timer;const states=[],clips=[],track={readyState:'live',enabled:true,addEventListener(){},removeEventListener(){}};
  class Stream{constructor(tracks){this.tracks=tracks;}}
  class Recorder{static isTypeSupported(t){return t.startsWith('video/webm');}constructor(stream,opts){recorder=this;this.stream=stream;this.mimeType=opts.mimeType;this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';}finish(){this.ondataavailable({data:new Blob(['tail'])});this.onstop();}}
  const capture=createClipRecorder({Recorder,Stream,onState:s=>states.push(s),onClip:c=>clips.push(c),now:()=>100,later:fn=>{timer=fn;return 1;},cancel:()=>{}});
  const stream={getVideoTracks:()=>[track],getAudioTracks:()=>[{kind:'audio'}]};
  return {capture,stream,states,clips,recorder:()=>recorder,timer:()=>timer()};
}
test('capture excludes audio and waits for final data before publishing a clip',async()=>{
  const f=fixture();f.capture.start(f.stream);
  assert.equal(f.recorder().stream.tracks.length,1);
  f.recorder().ondataavailable({data:new Blob(['first'])});f.capture.stop();
  assert.equal(f.clips.length,0);f.recorder().finish();
  assert.equal(await f.clips[0].blob.text(),'firsttail');
  assert.equal(f.clips[0].blob.type,'video/webm');
});
test('size overflow discards the entire clip and explicit recording can retry',()=>{
  const f=fixture();f.capture.start(f.stream);
  f.recorder().ondataavailable({data:{size:CLIP_BYTES+1}});f.recorder().finish();
  assert.equal(f.clips.length,0);assert.equal(f.states.at(-1).state,'error');
  f.capture.start(f.stream);f.timer();f.recorder().finish();assert.equal(f.clips.length,1);
  assert.equal(f.clips[0].reason,'60-second stop requested');
});
test('missing camera and recorder errors never publish successful clips',()=>{
  const f=fixture();assert.throws(()=>f.capture.start(null),/Connect a webcam/);
  f.capture.start(f.stream);f.recorder().onerror();f.recorder().finish();assert.equal(f.clips.length,0);
});
test('recording import hashes exact bytes and uses same-origin binary endpoint',async()=>{
  const file=new File(['RIFF0000AVI synthetic'], 'chosen.avi', {type:'video/x-msvideo'});let request;
  const result=await importRecording(file,'token',null,async(url,options)=>{
    request={url,...options};return Response.json({sha256:options.headers['X-DVR-SHA256'],recording:{id:'a'.repeat(32)}});
  });
  assert.equal(request.url,'/api/analysis/recordings');assert.equal(request.headers['Content-Type'],'video/x-msvideo');
  assert.equal(request.credentials,'omit');assert.equal(request.redirect,'error');assert.equal(result.sha256.length,64);
  assert.equal(new TextDecoder().decode(request.body),await file.text());
  await assert.rejects(()=>importRecording({size:CLIP_BYTES+1},'token'),/64 MiB/);
});
