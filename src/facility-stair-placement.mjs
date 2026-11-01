import {STAIR_REFERENCE,defaultStair,stairDimensions,stairFootprint,stairLandingRings,validateStair} from './facility-stairs.mjs';
import {polygonContains,ringsInteriorOverlap,pointInPolygon} from './facility.mjs';

const rad=d=>d*Math.PI/180;
const round=n=>+n.toFixed(8);
export const bearing=d=>(Math.round(((d%360+360)%360)*100)%36000)/100;
export const travelBearing=s=>bearing(s.bearing+(s.toLevel<s.fromLevel?180:0));
const outward=s=>[Math.sin(rad(travelBearing(s))),Math.cos(rad(travelBearing(s)))];
export function stairAnchors(s,b) {
  const distance=(stairDimensions(s,b).length-s.landing)/2,axis=outward(s);
  return [-1,1].map(k=>[s.x,s.y].map((n,i)=>round(n+k*distance*axis[i])));
}
export function anchorStair(s,b,start) {
  const distance=(stairDimensions(s,b).length-s.landing)/2,axis=outward(s);
  return {...s,x:round(start[0]+distance*axis[0]),y:round(start[1]+distance*axis[1])};
}
export function turnStair(s,b,heading) {
  return anchorStair({...s,bearing:bearing(heading+(s.toLevel<s.fromLevel?180:0))},b,stairAnchors(s,b)[0]);
}
export function stairDestination(s,b,toLevel) {
  if(!Number.isInteger(toLevel) || toLevel===s.fromLevel || toLevel<0 || toLevel>=b.floors)throw Error('Choose a different floor in this building.');
  const start=stairAnchors(s,b)[0],head=travelBearing(s),next={...s,toLevel};
  const risers=Math.max(2,Math.min(100,Math.ceil(stairDimensions(next,b).rise/STAIR_REFERENCE.maxRiser)));
  return anchorStair({...next,risers,bearing:bearing(head+(toLevel<s.fromLevel?180:0))},b,start);
}
export function stairPlacementIssue(plan,b,s) {
  try{validateStair(s,b);}catch(e){return e.message;}
  const ring=stairFootprint(s,b);
  if(!polygonContains(b.footprint,ring) || b.holes?.some(h=>ringsInteriorOverlap(h,ring)))return 'Move or rotate the flight so both landings and all treads fit inside the building, clear of courtyards.';
  const landings=stairLandingRings(s,b);
  for(const [index,level] of [s.fromLevel,s.toLevel].entries()) {
    if(b.openFloors?.includes(level) || plan.openings?.some(o=>o.buildingId===b.id && o.level===level && ringsInteriorOverlap(o.footprint,landings[index])))
      return (index?'Arrival':'Start')+' landing needs solid floor on Level '+(level+1)+'. Move the stair or choose another floor.';
  }
  return '';
}
export function destinationLevels(b,floor) {
  return Array.from({length:b?.floors || 0},(_,i)=>i).filter(i=>i!==floor && !b.openFloors?.includes(i));
}
function nearestDestination(b,floor) {
  const levels=destinationLevels(b,floor).sort((a,c)=>Math.abs(a-floor)-Math.abs(c-floor) || c-a);
  if(!levels.length)throw Error('Add a second level with a solid landing before placing stairs.');
  return levels[0];
}
export function suggestedStair(plan,b,floor) {
  if(!b || b.openFloors?.includes(floor))throw Error('Choose a start level with a solid floor.');
  return defaultStair(b,floor,(_ring,s)=>!stairPlacementIssue(plan,b,s),nearestDestination(b,floor));
}
export function stairAtStart(plan,b,floor,start) {
  if(!b || !Number.isInteger(floor) || floor<0 || floor>=b.floors || !Array.isArray(start) || start.length!==2 || !start.every(Number.isFinite) || !pointInPolygon(start,b.footprint) || b.holes?.some(h=>pointInPolygon(start,h)) ||
    b.openFloors?.includes(floor) || plan.openings?.some(o=>o.buildingId===b.id && o.level===floor && pointInPolygon(start,o.footprint)))
    throw Error('Click inside the building on solid floor for the start landing.');
  const s=defaultStair(b,floor,null,nearestDestination(b,floor));
  const first=anchorStair({...s,bearing:s.toLevel>floor?0:180},b,start);
  // Try simple headings first and include actual facade directions for rotated buildings.
  const directions=new Set([0,90,180,270,45,135,225,315]);
  for(let i=1;i<b.footprint.length;i++) {
    const [a,c]=b.footprint.slice(i-1,i+1),h=bearing(Math.atan2(c[0]-a[0],c[1]-a[1])*180/Math.PI);
    directions.add(h);directions.add(bearing(h+180));
  }
  for(const h of directions){const candidate=turnStair(first,b,h);if(!stairPlacementIssue(plan,b,candidate))return candidate;}
  return first; // Invalid reservations can still be dragged back into a fitting position.
}
