import clipping from 'polygon-clipping';
import {LIMITS, polygonArea, validPolygon} from './facility.mjs';
import {stairOnLevel,stairFootprint} from './facility-stairs.mjs';

export const MAX_ROW = 12;
const MAX_PREVIEW = 96;
const round = n => +n.toFixed(10);
export const boxBetween = ([x,y],[u,v]) => ({x:Math.min(x,u),y:Math.min(y,v),w:Math.abs(x-u),h:Math.abs(y-v)});
const rectangle = ({x,y,w,h}) => [[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];

// Work in a plane aligned with the longest exterior wall. The same transform is
// used for the drawing, snapping and saving, including on rotated buildings.
function longestWallDirection(ring) {
  let longest=0, ux=1, uy=0;
  for (let i=1;i<ring.length;i++) {
    const dx=ring[i][0]-ring[i-1][0], dy=ring[i][1]-ring[i-1][1], length=Math.hypot(dx,dy);
    if (length>longest+1e-8) {
      longest=length;
      const sign=dx < -1e-10 || (Math.abs(dx)<1e-10 && dy<0) ? -1 : 1;
      ux=sign*dx/length; uy=sign*dy/length;
    }
  }
  return [ux,uy];
}

export function floorFrame(ring, direction = longestWallDirection(ring)) {
  const [ux,uy] = direction;
  const project=([x,y])=>[ux*x+uy*y,uy*x-ux*y];
  const points=ring.map(project), left=Math.min(...points.map(p=>p[0])), top=Math.min(...points.map(p=>p[1]));
  const local=p=>{const [x,y]=project(p);return [round(x-left),round(y-top)];};
  const world=([x,y])=>[ux*(x+left)+uy*(y+top),uy*(x+left)-ux*(y+top)];
  return {local,world,direction:[ux,uy],box:{x:0,y:0,w:round(Math.max(...points.map(p=>p[0]))-left),h:round(Math.max(...points.map(p=>p[1]))-top)}};
}

export function sketchFloor(plan,building,level) {
  const frame=floorFrame(building.footprint), outer=building.footprint.map(frame.local);
  const here=item=>item.buildingId===building.id && item.level===level;
  const blocked=[
    ...(building.holes || []).map(ring=>({kind:'void',name:'Courtyard',ring})),
    ...(plan.openings || []).filter(here).map(o=>({kind:'void',name:o.name,ring:o.footprint})),
    ...(plan.stairs || []).filter(s=>s.buildingId===building.id && stairOnLevel(s,level))
      .map(s=>({kind:'stair',name:s.name,ring:stairFootprint(s,building)})),
    ...plan.rooms.filter(here).map(r=>({kind:'room',name:r.name,ring:r.footprint}))
  ].map(item=>({...item,ring:item.ring.map(frame.local)}));
  const floor={frame,outer,blocked,free:[],error:''};
  if (building.openFloors?.includes(level)) return {...floor,error:'This level has no solid floor.'};
  if (outer.length+blocked.reduce((n,b)=>n+b.ring.length,0)>16000)
    return {...floor,error:'This floor is too detailed for automatic fitting. Use Draw room on the floor map.'};
  try {
    floor.free=blocked.length ? clipping.difference([outer],...blocked.map(b=>[b.ring])) : [[outer]];
  } catch {floor.error='These outlines could not be fitted together. Review the floor geometry.';}
  return floor;
}

export function freeAfterDrafts(floor,staged) {
  if (!staged.length || !floor.free.length) return floor.free;
  return clipping.difference(floor.free,...staged.map(room=>[room.ring]));
}

export function snapSketchPoint(point, vertices, bounds, tolerance, grid) {
  const guides=[];
  const snapped=point.map((n,axis)=>{
    const max=axis ? bounds.h : bounds.w;
    let best=tolerance, aligned=null;
    for (const vertex of vertices) {
      const d=Math.abs(n-vertex[axis]);
      if (d<best) {best=d;aligned=vertex[axis];}
    }
    guides[axis]=aligned!==null;
    return Math.max(0,Math.min(max,aligned ?? (grid ? round(Math.round(n/grid)*grid) : n)));
  });
  return {point:snapped,guides};
}

function layoutCells(box,mode,count,across,hall) {
  if (mode==='single') return [box];
  if (!Number.isInteger(count) || count<1 || count>MAX_ROW) throw Error('Choose 1 to 12 rooms per row.');
  const span=across ? box.h : box.w, depth=across ? box.w : box.h;
  if (mode==='hall' && (!Number.isFinite(hall) || hall<=0 || hall>=depth)) throw Error('Use a hall narrower than the selected area.');
  const bands=mode==='hall' ? 2 : 1, roomDepth=bands===2 ? (depth-hall)/2 : depth;
  const cells=[];
  for (let row=0;row<bands;row++) for (let i=0;i<count;i++) {
    const along=span*i/count, width=span*(i+1)/count-along, offset=row ? roomDepth+hall : 0;
    cells.push(across ? {x:box.x+offset,y:box.y+along,w:roomDepth,h:width}
      : {x:box.x+along,y:box.y+offset,w:width,h:roomDepth});
  }
  return cells;
}

// Room records carry one exterior ring. Never fill an enclosed void or bridge
// disconnected pieces. Names are allocated only to the outlines shown for saving.
export function sketchRooms({floor,free,box,mode,count,across,hall,prefix,usedNames,capacity}) {
  const rooms=[], names=new Set(usedNames);
  let skipped=0, enclosed=0, number=1;
  if (floor.error) throw Error(floor.error);
  if (!box) return {rooms,skipped,enclosed};
  if (![box.x,box.y,box.w,box.h].every(Number.isFinite) || box.w<=0 || box.h<=0) throw Error('Choose two different corners.');
  const base=prefix.trim() || 'Room';
  for (const cell of layoutCells(box,mode,count,across,hall)) {
    const polygons=clipping.intersection(free,[rectangle(cell)]);
    for (const [ring,...holes] of polygons) {
      if (holes.length) {enclosed++;continue;}
      const footprint=ring.map(floor.frame.world).map(p=>p.map(v=>Math.abs(Math.abs(v)-2000)<1e-8 ? Math.sign(v)*2000 : v));
      if (!validPolygon(footprint)) {skipped++;continue;}
      let name;
      do {name=base+' '+number++;} while(names.has(name));
      names.add(name);
      rooms.push({name,ring,footprint,area:polygonArea(footprint)});
      if (rooms.length>Math.min(capacity,MAX_PREVIEW))
        throw Error(capacity<MAX_PREVIEW ? 'This layout exceeds the 500-room facility limit. Choose a smaller area.' : 'Choose a smaller area to preview up to 96 rooms at once.');
    }
  }
  return {rooms,skipped,enclosed};
}

export function roomAdditions(plan,building,level,rooms,makeId) {
  if (building.openFloors?.includes(level) || !Number.isInteger(level) || level<0 || level>=building.floors)
    throw Error('Choose a solid floor before adding rooms.');
  if (!rooms.length || plan.rooms.length+rooms.length>LIMITS.rooms) throw Error('Choose a layout within the facility room limit.');
  const wallHeight=Math.max(.2,Math.min(2.8,(building.height-(building.base || 0))/building.floors));
  return rooms.map(({name,footprint})=>({id:makeId(),buildingId:building.id,level,name,footprint,wallHeight}));
}
