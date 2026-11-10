import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisJSON, inspectTrainingStart, startTrainingAnalysis} from '../src/training-analysis.mjs';

const body={recording:'a'.repeat(32),model:'generated-model',rules:'generated-rules'};
const job={id:'b'.repeat(32),state:'running'};

test('a verified start reply binds cancellation ownership only to the returned native job id', async () => {
  const calls=[];
  assert.equal(await startTrainingAnalysis(body,{token:'generated',request:async (path,options) => {
    calls.push({path,...options}); return job;
  }}),job);
  assert.deepEqual(calls,[{path:'/jobs',token:'generated',method:'POST',body,timeout:120000}]);
});

for(const status of [undefined,403,408,500,502,503,504]) test(`start response ${status ?? 'lost'} remains uncertain without another write`, async () => {
  const calls=[];
  await assert.rejects(startTrainingAnalysis(body,{request:async (path,options) => {
    calls.push([path,options.method]); throw Object.assign(Error('Generated response failure'),{status});
  }}),error=>error.startUnknown===true);
  assert.deepEqual(calls,[['/jobs','POST']]);
});

test('known native refusals remain retryable while malformed success cannot create ownership', async () => {
  for(const status of [400,404,409,413,415,422]) await assert.rejects(startTrainingAnalysis(body,{request:async()=> {
    throw Object.assign(Error('Generated refusal'),{status});
  }}),error=>!error.startUnknown);
  for(const value of [{}, {...job,id:'invalid'}, {...job,state:'unknown'}])
    await assert.rejects(startTrainingAnalysis(body,{request:async()=>value}),error=>error.startUnknown===true);
});

test('uncertain-start recovery only reads status and cannot adopt or cancel the retained job', async () => {
  const calls=[];
  for(const retained of [job,{...job,state:'completed'},{...job,state:'failed'},{...job,state:'cancelled'},null]) {
    const result=await inspectTrainingStart({request:async (path,options)=> {
      calls.push([path,options.method]); return {job:retained};
    }});
    assert.equal(result.job,retained); assert.equal(result.canRetry,retained?.state!=='running');
  }
  assert.deepEqual(calls,Array(5).fill(['/session',undefined]));
  for(const session of [{}, {job:undefined}, {job:{...job,id:'bad'}}, {job:{...job,state:'unrecognized'}}])
    await assert.rejects(inspectTrainingStart({request:async()=>session}),/could not be verified/);
});

for(const phase of ['headers','body']) test(`the full ${phase} deadline bounds an uncertain analysis start even if fetch ignores abort`, {timeout:1000}, async () => {
  const keepAlive=setTimeout(()=>{},900); let requests=0;
  try {
    await assert.rejects(startTrainingAnalysis(body,{timeout:20,request:(path,options)=>analysisJSON(path,{...options,
      fetcher:async()=>{requests++; return phase==='headers' ? new Promise(()=>{}) : {ok:true,json:()=>new Promise(()=>{})};},
    })}),error=>error.name==='TimeoutError'&&error.startUnknown===true);
    assert.equal(requests,1);
  } finally {clearTimeout(keepAlive);}
});

test('an aborted read ignores a late parsed reply', async () => {
  const controller=new AbortController(); let parsed;
  const keepAlive=setTimeout(()=>{},900);
  try {
    const result=analysisJSON('/session',{signal:controller.signal,fetcher:async()=>({ok:true,json:()=>new Promise(resolve=>{parsed=resolve;})})});
    while(!parsed) await new Promise(resolve=>setTimeout(resolve,0));
    controller.abort(); await assert.rejects(result,error=>error.name==='AbortError');
    parsed({job});
  } finally {clearTimeout(keepAlive);}
});
