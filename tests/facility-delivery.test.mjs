import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { createGeoMiddleware } from '../scripts/facility-local-services.mjs';
import { osmQuery,searchBounds } from '../src/facility-starter.mjs';
const query=osmQuery(searchBounds([-98,38.5],0,0,250,250));
const form=new URLSearchParams({data:query}).toString();
async function invoke(middleware,{url='/geo/search?q=Example&limit=5&lang=en',method='GET',body='',headers={}}={}){
  const req=Readable.from([Buffer.from(body)]);req.url=url;req.method=method;req.headers={host:'127.0.0.1:4182',...headers};req.complete=true;
  const res=new EventEmitter();res.headers={};res.setHeader=(k,v)=>res.headers[k]=v;res.end=value=>{res.body=JSON.parse(value);res.writableEnded=true;};
  let next=false;await middleware(req,res,()=>{next=true;});return {...res,next};
}
const options={url:'/geo/overpass',method:'POST',body:form,headers:{'content-type':'application/x-www-form-urlencoded'}};
test('disabled delivery and unknown routes cannot make upstream requests',async()=>{
  let calls=0;const middleware=createGeoMiddleware({fetcher:()=>{calls++;}});
  assert.equal((await invoke(middleware)).statusCode,503);assert.equal((await invoke(middleware,{url:'/geo/other'})).statusCode,404);
  assert.equal((await invoke(middleware,{url:'/not-geo'})).next,true);assert.equal(calls,0);
});
test('only fixed loopback services receive minimized input; cookies/auth/URLs are never forwarded',async()=>{
  let request;const middleware=createGeoMiddleware({enabled:true,fetcher:async(url,opts)=>{request={url,...opts};return new Response(JSON.stringify({type:'FeatureCollection',features:[]}));}});
  const res=await invoke(middleware,{headers:{cookie:'private',authorization:'secret',origin:'http://127.0.0.1:4182'}});
  assert.equal(res.statusCode,200);assert.match(request.url,/^http:\/\/127\.0\.0\.1:2322\/api\/\?q=Example/);
  assert.deepEqual(request.headers,{Accept:'application/json'});assert.equal(request.redirect,'error');assert.equal(res.headers['Cache-Control'],'no-store');
});
test('cross-origin, rebinding, method and arbitrary-query attempts never call upstream',async()=>{
  for(const request of [{headers:{host:'attacker.invalid'}},{headers:{origin:'https://attacker.invalid'}},{headers:{'sec-fetch-site':'cross-site'}},{method:'POST'},{url:'/geo/search?q=Example&limit=5&lang=en&url=http://attacker.invalid'},{url:'/geo/search?q=Example&q=Other&limit=5&lang=en'},{...options,body:'data=[out:json];node(1);out;'},{...options,body:'x'.repeat(17000)}]){
    let calls=0;const middleware=createGeoMiddleware({enabled:true,fetcher:()=>{calls++;}});assert.notEqual((await invoke(middleware,request)).statusCode,200);assert.equal(calls,0);
  }
  assert.throws(()=>createGeoMiddleware({photonPort:'https://attacker.invalid'}));
});
test('bounded canonical Overpass queries work; invalid, partial and oversized responses fail closed',async()=>{
  let request;const middleware=createGeoMiddleware({enabled:true,fetcher:async(url,opts)=>{request={url,...opts};return new Response(JSON.stringify({elements:[]}));}});
  assert.equal((await invoke(middleware,options)).statusCode,200);assert.equal(request.url,'http://127.0.0.1:12345/api/interpreter');assert.equal(request.body.get('data'),query);
  for(const body of ['{bad',JSON.stringify({elements:[],remark:'timeout'}),JSON.stringify({elements:Array(301).fill({})}),'x'.repeat(2000001)]){
    const m=createGeoMiddleware({enabled:true,fetcher:async()=>new Response(body)});assert.equal((await invoke(m,options)).statusCode,502);
  }
});
test('rate limits and active request bounds are enforced across clients without automatic retries',async()=>{
  let time=0,calls=0,release;const middleware=createGeoMiddleware({enabled:true,clock:()=>time,fetcher:()=>{calls++;return new Promise(r=>{release=()=>r(new Response('{"type":"FeatureCollection","features":[]}'));});}});
  const pending=invoke(middleware);assert.equal((await invoke(middleware)).statusCode,429);release();await pending;
  assert.equal((await invoke(middleware)).statusCode,429);assert.equal(calls,1);time=1500;
  const again=invoke(middleware);release();assert.equal((await again).statusCode,200);
});
test('real HTTP loopback middleware round trip (opt-in on CI)',{skip:process.env.DVR_TEST_SOCKETS!=='1'},async()=>{
  const listen=s=>new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',()=>resolve(s.address().port));});
  const upstream=createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(req.method==='GET'?{type:'FeatureCollection',features:[]}:{elements:[]}));});
  const upstreamPort=await listen(upstream),middleware=createGeoMiddleware({enabled:true,photonPort:upstreamPort,overpassPort:upstreamPort});
  const app=createServer((req,res)=>middleware(req,res,()=>{res.statusCode=404;res.end();}));
  try {const appPort=await listen(app),base=`http://127.0.0.1:${appPort}`;
    assert.equal((await fetch(base+'/geo/search?q=Example&limit=5&lang=en')).status,200);
    const response=await fetch(base+'/geo/overpass',{method:'POST',body:new URLSearchParams({data:query})});assert.equal(response.status,200);assert.deepEqual(await response.json(),{elements:[]});
  } finally {await Promise.all([new Promise(r=>app.close(r)),new Promise(r=>upstream.close(r))]);}
});
