import {deleteImage, getImage, putImage} from './local-images.mjs';

// Image reads and decode callbacks belong to one plan and one effect lifetime.
// The caller also checks planId at render time, before effect cleanup can run.
export function loadZoneImage(planId, onChange, {read=getImage, ImageClass=globalThis.Image, urls=URL}={}) {
  let active=true, url='', image=null;
  const publish=(phase, value=null)=>{if(active)onChange({planId,phase,image:value});};
  const release=()=>{if(url)urls.revokeObjectURL(url);url='';};
  publish('loading');
  Promise.resolve().then(()=>active ? read('zone-stills',`plan-${planId}`) : null).then(blob=>{
    if(!active)return;
    if(!blob){publish('empty');return;}
    url=urls.createObjectURL(blob);image=new ImageClass();
    image.onload=()=>{
      if(!active)return;
      if(!(image.naturalWidth>0&&image.naturalHeight>0)){release();publish('failed');return;}
      publish('ready',{url,width:image.naturalWidth,height:image.naturalHeight});
    };
    image.onerror=()=>{if(active){release();publish('failed');}};
    image.src=url;
  }).catch(()=>{if(active){release();publish('failed');}});
  return ()=>{active=false;if(image){image.onload=null;image.onerror=null;}release();};
}

export function zoneImageForPlan(state, planId) {
  return state?.planId===planId && state.phase==='ready' ? state.image : null;
}

// IndexedDB writes cannot be rolled back by cancelling a UI offer. Serialize
// explicit save/remove requests and return the exact offer and plan submitted.
export function createZoneImageWriter(onChange, {put=putImage, remove=deleteImage}={}) {
  let current=null, closed=false;
  async function run(kind,planId,offer) {
    if(closed||current)return null;
    const operation={kind,planId,offer};current=operation;onChange(operation);
    let ok=false;
    try {
      ok=await(kind==='save' ? put('zone-stills',`plan-${planId}`,offer.blob) : remove('zone-stills',`plan-${planId}`));
    } catch { /* The storage helpers fail soft; injected/unexpected failures do too. */ }
    finally {
      if(current===operation){current=null;if(!closed)onChange(null);}
    }
    return closed ? null : {...operation,ok:ok===true};
  }
  return {
    save:(planId,offer)=>offer?.blob ? run('save',planId,offer) : Promise.resolve(null),
    remove:planId=>run('remove',planId),
    close(){closed=true;},
  };
}

export const clearSavedZoneOffer=(current,saved)=>current===saved ? null : current;
