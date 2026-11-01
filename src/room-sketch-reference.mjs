// The source image is only a temporary, local tracing reference. Coordinates here
// are sketch coordinates, never GPS or evidence of measured wall positions.
export function fitReference(image,box) {
  const scale=Math.min(box.w/image.width,box.h/image.height),w=image.width*scale,h=image.height*scale;
  return {x:(box.w-w)/2,y:(box.h-h)/2,w,h};
}

// Similarity transform: rotate, translate and uniformly scale. Unlike a stretch,
// this preserves all angles and does not invent perspective correction.
export function matchReference([p,q,r,s],minSource,minTarget) {
  const dx=q[0]-p[0],dy=q[1]-p[1],u=s[0]-r[0],v=s[1]-r[1],den=dx*dx+dy*dy;
  if (Math.sqrt(den)<minSource || Math.hypot(u,v)<minTarget) throw Error('Choose two landmarks farther apart.');
  const a=(dx*u+dy*v)/den,b=(dx*v-dy*u)/den;
  return [a,b,-b,a,r[0]-a*p[0]+b*p[1],r[1]-b*p[0]-a*p[1]];
}

const formats='Choose a PNG or JPEG floor plan up to 12 MiB.';
export function rasterHeader(bytes) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if (bytes.length>=24 && view.getUint32(0)===0x89504e47 && view.getUint32(4)===0x0d0a1a0a && view.getUint32(12)===0x49484452)
    return {type:'image/png',width:view.getUint32(16),height:view.getUint32(20)};
  if (bytes.length>10 && view.getUint16(0)===0xffd8) {
    let i=2;
    while (i+8<bytes.length && bytes[i]===0xff) {
      while (bytes[i]===0xff && i<bytes.length) i++;
      const tag=bytes[i++];
      if (tag===0xda || tag===0xd9 || i+7>bytes.length) break;
      const len=view.getUint16(i);
      if (len<2 || i+len>bytes.length) break;
      if ([0xc0,0xc1,0xc2].includes(tag) && len>=8)
        return {type:'image/jpeg',height:view.getUint16(i+3),width:view.getUint16(i+5)};
      i+=len;
    }
  }
  throw Error(formats);
}

export async function openReference(file) {
  if (!file || !file.size || file.size>12*1024**2) throw Error(formats);
  const {type,width,height}=rasterHeader(new Uint8Array(await file.arrayBuffer()));
  if (!width || !height || Math.max(width,height)>8192 || width*height>16000000)
    throw Error('Use an image at most 8,192 pixels per side and 16 megapixels overall.');
  const url=URL.createObjectURL(file.slice(0,file.size,type)),image=new Image();
  try {
    image.src=url;await image.decode();
    return {url,width:image.naturalWidth,height:image.naturalHeight,name:file.name};
  } catch {
    URL.revokeObjectURL(url);throw Error('This image could not be read. Try another PNG or JPEG.');
  }
}
