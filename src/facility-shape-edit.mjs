export const unitFactor = units => units === 'imperial' ? 0.3048 : 1;
export const unitLabel = units => units === 'imperial' ? 'ft' : 'm';
// Feet show 3 decimals (0.3 mm) so any entered value survives the 0.1 mm metre storage unchanged.
export const displayLength = (value, units) => typeof value === 'number' && Number.isFinite(value) ? +(value / unitFactor(units)).toFixed(units === 'imperial' ? 3 : 4) : value;
// Entered lengths are stored to 0.1 mm: whole feet and the 11 in stair tread stay exact, float noise does not.
export const toMetres = (value, units) => Math.round(value * unitFactor(units) * 1e4) / 1e4;
// Lengths entered as a displayed value convert only when the number actually differs from what was shown.
export function enteredLength(text, metres, units) {
  const n = typeof text === 'number' ? text : String(text).trim() === '' ? NaN : Number(text);
  return Number.isFinite(n) && n === displayLength(metres, units) ? metres : toMetres(n, units);
}
// Rewrites metre ranges in validation messages ("height 1–150 m") into the active unit.
export function localizeLengths(message, units) {
  if (units !== 'imperial' || typeof message !== 'string') return message;
  const ft = text => +(Number(text.replace(/,/g, '')) / 0.3048).toFixed(2);
  return message.replace(/(?<![\d.,])(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)(?:(\s?[–-]\s?)(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?))? m(?![²\w])/g,
    (_, a, dash, b) => `${ft(a)}${b === undefined ? '' : dash + ft(b)} ft`);
}
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
// Counter-clockwise about the bounds center, matching the shape builder's rotation.
export function rotateShape(shape, degrees) {
  if(!Number.isFinite(degrees)) throw Error('Enter a finite rotation in degrees.');
  const {x,y}=shapeBounds(shape),r=degrees*Math.PI/180,cos=Math.cos(r),sin=Math.sin(r);
  return transform(shape,([a,b])=>[x+(a-x)*cos-(b-y)*sin,y+(a-x)*sin+(b-y)*cos]);
}
export function resizeEdge(shape,index,length) {
  if(!Number.isInteger(index)||index<0||index>=shape.footprint.length-1||!Number.isFinite(length)||length<=0) throw Error('Choose an edge and a positive length.');
  const ring=shape.footprint.map(p=>[...p]),a=ring[index],b=ring[index+1],old=Math.hypot(b[0]-a[0],b[1]-a[1]);
  if(!old) throw Error('Cannot resize a zero-length edge.');
  const next=[a[0]+(b[0]-a[0])*length/old,a[1]+(b[1]-a[1])*length/old];
  ring[index+1]=next;if(index+1===ring.length-1)ring[0]=[...next];
  return {...shape,footprint:ring};
}
