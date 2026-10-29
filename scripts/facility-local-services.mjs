// Explicit local delivery only. This starts no upstream service and has no public fallback.
import { boundedJson, parsePlaces } from '../src/facility-services.mjs';
import { osmQuery } from '../src/facility-starter.mjs';

function port(value, fallback) {
  const n=Number(value ?? fallback);
  if(!Number.isInteger(n) || n<1024 || n>65535) throw Error('Local geo ports must be 1024–65535.');
  return n;
}
export function createGeoMiddleware({enabled=false, photonPort=2322, overpassPort=12345, fetcher=fetch, clock=Date.now}={}) {
  const photon=`http://127.0.0.1:${port(photonPort,2322)}/api/`;
  const overpass=`http://127.0.0.1:${port(overpassPort,12345)}/api/interpreter`;
  const last={search:-Infinity,overpass:-Infinity}, active=new Set();
  return async (req,res,next)=>{
    const path=(req.url || '').split('?')[0];
    if(!path.startsWith('/geo/')) return next();
    const reply=(status,message)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(message));};
    const kind=path==='/geo/search'?'search':path==='/geo/overpass'?'overpass':null;
    if(!kind)return reply(404,{error:'Unknown local geo route.'});
    if(!enabled)return reply(503,{error:'Local geo delivery is disabled. Use an offline extract or configure local services.'});
    const host=req.headers.host || '';
    if(!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host) ||
       (req.headers.origin && req.headers.origin!==`http://${host}`) || req.headers['sec-fetch-site']==='cross-site')
      return reply(403,{error:'Local same-origin requests only.'});
    if(req.method!==(kind==='search'?'GET':'POST'))return reply(405,{error:'Unsupported method.'});
    if(active.has(kind) || clock()-last[kind]<(kind==='search'?1500:15000))return reply(429,{error:'Wait before retrying.'});
    active.add(kind);last[kind]=clock();
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),kind==='search'?12000:30000);
    const abortBody=()=>{if(!req.complete)req.destroy();};controller.signal.addEventListener('abort',abortBody,{once:true});
    const closed=()=>{if(!res.writableEnded)controller.abort();};res.on('close',closed);
    try {
      let url, options={signal:controller.signal,redirect:'error',credentials:'omit',headers:{Accept:'application/json'}};
      if(kind==='search') {
        if((req.url || '').length>2000)throw Error('Oversized search.');
        const params=new URL(req.url,`http://${host}`).searchParams, q=params.get('q')?.trim();
        if(!q || q.length<3 || q.length>180 || [...params.keys()].some(k=>!['q','limit','lang'].includes(k)) ||
           [...params.keys()].some(k=>params.getAll(k).length!==1) || params.get('limit')!=='5' || params.get('lang')!=='en')throw Error('Invalid search parameters.');
        url=photon+'?'+new URLSearchParams({q,limit:'5',lang:'en'});
      } else {
        if(!/^application\/x-www-form-urlencoded(?:;|$)/i.test(req.headers['content-type'] || ''))throw Error('Use a form-encoded Overpass query.');
        const chunks=[];let size=0;
        for await(const chunk of req) {size+=chunk.length;if(size>16384)throw Error('Query exceeds 16 KB.');chunks.push(chunk);}
        const params=new URLSearchParams(Buffer.concat(chunks).toString('utf8')), query=params.get('data');
        if([...params.keys()].length!==1 || !query)throw Error('One data field is required.');
        const match=query.match(/\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)/);
        if(!match || osmQuery(match.slice(1).map(Number))!==query)throw Error('Only the bounded facility footprint query is accepted.');
        url=overpass;options={...options,method:'POST',body:new URLSearchParams({data:query})};
      }
      controller.signal.throwIfAborted();
      const data=await boundedJson(await fetcher(url,options),kind==='search'?100000:2e6);
      controller.signal.throwIfAborted();
      if(kind==='search')parsePlaces(data);
      else if(!Array.isArray(data?.elements) || data.elements.length>300 || data.remark)throw Error('Incomplete local footprint response.');
      reply(200,data);
    } catch(error) {
      if(!res.destroyed)reply(controller.signal.aborted?504:502,{error:controller.signal.aborted?'Local service timed out or client disconnected.':'Local service request failed. Check installed services or use an offline extract.'});
    } finally {clearTimeout(timer);controller.signal.removeEventListener('abort',abortBody);res.off('close',closed);active.delete(kind);}
  };
}
export function facilityLocalServices(env=process.env) {
  const options={enabled:env.DVR_GEO_LOCAL==='1',photonPort:env.DVR_PHOTON_PORT,overpassPort:env.DVR_OVERPASS_PORT};
  return {name:'facility-local-services',configureServer(server){server.middlewares.use(createGeoMiddleware(options));},
    configurePreviewServer(server){server.middlewares.use(createGeoMiddleware(options));}};
}
