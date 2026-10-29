export const unitFactor = units => units === 'imperial' ? 0.3048 : 1;
export const unitLabel = units => units === 'imperial' ? 'ft' : 'm';
export const displayLength = (value, units) => typeof value === 'number' && Number.isFinite(value) ? +(value / unitFactor(units)).toFixed(4) : value;
export function shapeBounds(shape) {
  const p=shape.footprint.slice(0,-1), xs=p.map(p=>p[0]), ys=p.map(p=>p[1]);
  const min=[Math.min(...xs),Math.min(...ys)], max=[Math.max(...xs),Math.max(...ys)];
  return {width:max[0]-min[0],depth:max[1]-min[1],x:(min[0]+max[0])/2,y:(min[1]+max[1])/2};
}
const transform = (shape, fn) => ({...shape,footprint:shape.footprint.map(fn),...(shape.holes ? {holes:shape.holes.map(r=>r.map(fn))} : {})});
export function resizeShape(shape, axis, span) {
  if (!Number.isFinite(span) || span <= 0) throw Error('Enter a positive shape dimension.');
  const bounds=shapeBounds(shape), i=axis==='width'?0:1, old=i===0?bounds.width:bounds.depth, center=i===0?bounds.x:bounds.y;
  if(!old) throw Error('This shape has no measurable span.');
  return transform(shape,p=>p.map((n,j)=>j===i?center+(n-center)*span/old:n));
}
export function moveShape(shape, axis, position) {
  if(!Number.isFinite(position)) throw Error('Enter a finite position.');
  const bounds=shapeBounds(shape),i=axis==='x'?0:1, offset=position-bounds[axis];
  return transform(shape,p=>p.map((n,j)=>j===i?n+offset:n));
}
export function resizeEdge(shape,index,length) {
  if(!Number.isInteger(index)||index<0||index>=shape.footprint.length-1||!Number.isFinite(length)||length<=0) throw Error('Choose an edge and a positive length.');
  const ring=shape.footprint.map(p=>[...p]),a=ring[index],b=ring[index+1],old=Math.hypot(b[0]-a[0],b[1]-a[1]);
  if(!old) throw Error('Cannot resize a zero-length edge.');
  const next=[a[0]+(b[0]-a[0])*length/old,a[1]+(b[1]-a[1])*length/old];
  ring[index+1]=next;if(index+1===ring.length-1)ring[0]=[...next];
  return {...shape,footprint:ring};
}
