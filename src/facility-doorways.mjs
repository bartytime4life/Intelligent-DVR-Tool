import {ringsInteriorOverlap,ringsIntersect,pointInPolygon} from './facility.mjs';

export const DOORWAY_LIMIT = 1000;
export const DOOR_WIDTH = {min:.4, max:6, initial:.9};
const EPSILON = 1e-6;
const distance = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);
const interpolate = (a,b,t) => a.map((n,i)=>n+(b[i]-n)*t);

export function projectOnWall(point, wall) {
  const [a,b] = wall.points, length = distance(a,b);
  const along = ((point[0]-a[0])*(b[0]-a[0])+(point[1]-a[1])*(b[1]-a[1])) / length;
  const at = Math.max(0,Math.min(length,along));
  const closest = interpolate(a,b,at/length);
  return {along:at, point:closest, distance:distance(point,closest), length};
}

// Merge consecutive collinear overlaps so an extra corner on a straight wall
// cannot prevent a doorway from spanning that corner.
export function sharedRoomWalls(first, second) {
  if (first.id===second.id || first.buildingId!==second.buildingId || first.level!==second.level) return [];
  const a=first.footprint, b=second.footprint;
  const box = ring => [Math.min(...ring.map(p=>p[0])),Math.min(...ring.map(p=>p[1])),Math.max(...ring.map(p=>p[0])),Math.max(...ring.map(p=>p[1]))];
  const x=box(a), y=box(b);
  if (x[0]>y[2]+EPSILON || x[2]<y[0]-EPSILON || x[1]>y[3]+EPSILON || x[3]<y[1]-EPSILON) return [];
  const segments=[];
  for (let i=1;i<a.length;i++) {
    const start=a[i-1], end=a[i], length=distance(start,end);
    const u=[(end[0]-start[0])/length,(end[1]-start[1])/length];
    const along = p => (p[0]-start[0])*u[0]+(p[1]-start[1])*u[1];
    const across = p => (p[0]-start[0])*u[1]-(p[1]-start[1])*u[0];
    for (let j=1;j<b.length;j++) {
      if (Math.abs(across(b[j-1]))>EPSILON || Math.abs(across(b[j]))>EPSILON) continue;
      const low=Math.max(0,Math.min(along(b[j-1]),along(b[j])));
      const high=Math.min(length,Math.max(along(b[j-1]),along(b[j])));
      if (high-low>EPSILON) segments.push([interpolate(start,end,low/length),interpolate(start,end,high/length)]);
    }
  }
  if (!segments.length || ringsInteriorOverlap(a,b)) return [];
  const merged=[];
  for (const points of segments) {
    let candidate=points;
    for (let i=0;i<merged.length;) {
      const wall={points:candidate}, p=projectOnWall(merged[i][0],wall), q=projectOnWall(merged[i][1],wall);
      // Projection distance to an infinite line, allowing an adjacent extension.
      const [s,e]=candidate, len=distance(s,e);
      const off = n => Math.abs((n[0]-s[0])*(e[1]-s[1])-(n[1]-s[1])*(e[0]-s[0]))/len;
      const touching=p.distance<=EPSILON || q.distance<=EPSILON ||
        candidate.some(n=>projectOnWall(n,{points:merged[i]}).distance<=EPSILON);
      if (off(merged[i][0])>EPSILON || off(merged[i][1])>EPSILON || !touching) {i++;continue;}
      const all=[...candidate,...merged[i]].sort((p,q)=>(p[0]-q[0])*(e[0]-s[0])+(p[1]-q[1])*(e[1]-s[1]));
      candidate=[all[0],all.at(-1)];merged.splice(i,1);i=0;
    }
    merged.push(candidate);
  }
  return merged.map(points=>{
    // Stable ends give distance inputs the same direction across saves and copies.
    if(points[0][0]>points[1][0]+EPSILON || Math.abs(points[0][0]-points[1][0])<=EPSILON && points[0][1]>points[1][1]) points.reverse();
    return {points, roomIds:[first.id,second.id], buildingId:first.buildingId, level:first.level};
  });
}

export function floorDoorwayWalls(plan, buildingId, level) {
  const rooms=plan.rooms.filter(r=>r.buildingId===buildingId && r.level===level);
  const walls=[];
  for(let i=0;i<rooms.length;i++) for(let j=i+1;j<rooms.length;j++) walls.push(...sharedRoomWalls(rooms[i],rooms[j]));
  return walls.filter(w=>distance(...w.points)>=DOOR_WIDTH.min);
}

export function doorwayWall(plan, door) {
  const [first,second]=door.roomIds.map(id=>plan.rooms.find(r=>r.id===id));
  if(!first || !second) return null;
  return sharedRoomWalls(first,second).find(w=>projectOnWall([door.x,door.y],w).distance<=EPSILON) || null;
}

export function doorwaySegment(door, wall) {
  const {length,along}=projectOnWall([door.x,door.y],wall);
  return [interpolate(...wall.points,(along-door.width/2)/length),interpolate(...wall.points,(along+door.width/2)/length)];
}

export function placeDoorway(plan, wall, point, door) {
  const {length,along}=projectOnWall(point,wall), half=door.width/2;
  if(!Number.isFinite(half) || door.width<DOOR_WIDTH.min || door.width>DOOR_WIDTH.max || length<door.width)
    throw Error('Choose a doorway width from 0.4 to 6 m that fits this wall.');
  let ranges=[[half,length-half]];
  for(const other of plan.doorways || []) {
    if(other.id===door.id || other.buildingId!==wall.buildingId || other.level!==wall.level) continue;
    const at=projectOnWall([other.x,other.y],wall);
    if(at.distance>EPSILON) continue;
    const low=at.along-other.width/2-half, high=at.along+other.width/2+half;
    ranges=ranges.flatMap(([a,b])=>high<=a || low>=b ? [[a,b]] : [[a,Math.min(b,low)],[Math.max(a,high),b]].filter(([x,y])=>y>=x));
  }
  if(!ranges.length) throw Error('There is no clear space for this doorway on the selected wall.');
  const options=ranges.map(([a,b])=>Math.max(a,Math.min(b,along)));
  const offset=options.reduce((best,n)=>Math.abs(n-along)<Math.abs(best-along)?n:best);
  const [x,y]=interpolate(...wall.points,offset/length);
  return {...door, buildingId:wall.buildingId, level:wall.level, roomIds:[...wall.roomIds],x,y};
}

export function validateDoorways(plan, doors) {
  const pairs=new Map();
  for(const door of doors) {
    if(!Array.isArray(door.roomIds) || door.roomIds.length!==2 || door.roomIds[0]===door.roomIds[1] ||
      ![door.x,door.y,door.width,door.height].every(Number.isFinite) || Math.abs(door.x)>2000 || Math.abs(door.y)>2000 ||
      door.width<DOOR_WIDTH.min || door.width>DOOR_WIDTH.max || door.height<.5)
      throw Error('Doorways need two distinct rooms, a valid position, width 0.4–6 m and a positive height.');
    const rooms=door.roomIds.map(id=>plan.rooms.find(r=>r.id===id));
    const building=plan.buildings.find(b=>b.id===door.buildingId);
    if(!building || building.openFloors?.includes(door.level) || !rooms.every(r=>r && r.buildingId===door.buildingId && r.level===door.level && door.height<=r.wallHeight))
      throw Error('Doorway “'+door.name+'” needs two rooms on the same solid floor and a height within both walls.');
    const key=[...door.roomIds].sort().join(':');
    if(!pairs.has(key)) pairs.set(key,sharedRoomWalls(...rooms));
    const wall=pairs.get(key).find(w=>{
      const p=projectOnWall([door.x,door.y],w);
      return p.distance<=EPSILON && p.along>=door.width/2-EPSILON && p.along+door.width/2<=p.length+EPSILON;
    });
    if(!wall) throw Error('Doorway “'+door.name+'” must fit on a shared wall. Move or remove it before changing that wall.');
    const span=doorwaySegment(door,wall);
    const voids=[...(building.holes || []),...(plan.openings || []).filter(o=>o.buildingId===door.buildingId && o.level===door.level).map(o=>o.footprint)];
    if(voids.some(ring=>ringsIntersect(span,ring) || pointInPolygon(span[0],ring)))
      throw Error('Doorway “'+door.name+'” crosses a floor opening. Place it along solid floor.');
    for(const other of doors) {
      if(other===door) break;
      if(other.buildingId!==door.buildingId || other.level!==door.level) continue;
      const at=projectOnWall([other.x,other.y],wall), current=projectOnWall([door.x,door.y],wall);
      if(at.distance<=EPSILON && Math.abs(at.along-current.along)<(door.width+other.width)/2-EPSILON)
        throw Error('Doorways “'+door.name+'” and “'+other.name+'” overlap.');
    }
  }
  return doors.map(d=>({id:d.id,name:d.name,buildingId:d.buildingId,level:d.level,roomIds:[...d.roomIds],x:d.x,y:d.y,width:d.width,height:d.height}));
}

// Open wall spans plus lintels, shared by drawing and estimated visibility.
export function roomWallPieces(room, doors) {
  const pieces=[];
  for(let i=1;i<room.footprint.length;i++) {
    const wall={points:[room.footprint[i-1],room.footprint[i]]}, length=distance(...wall.points), cuts=[];
    for(const door of doors) {
      if(!door.roomIds.includes(room.id)) continue;
      const [a,b]=wall.points;
      const along=((door.x-a[0])*(b[0]-a[0])+(door.y-a[1])*(b[1]-a[1]))/length;
      const off=Math.abs((door.x-a[0])*(b[1]-a[1])-(door.y-a[1])*(b[0]-a[0]))/length;
      if(off>EPSILON || along+door.width/2<=0 || along-door.width/2>=length) continue;
      cuts.push({from:Math.max(0,along-door.width/2),to:Math.min(length,along+door.width/2),height:door.height});
    }
    cuts.sort((a,b)=>a.from-b.from);
    let at=0;
    const add=(from,to,base)=>{
      if(to-from>EPSILON && room.wallHeight-base>EPSILON) pieces.push({points:[interpolate(...wall.points,from/length),interpolate(...wall.points,to/length)],base,top:room.wallHeight});
    };
    for(const cut of cuts){add(at,cut.from,0);add(cut.from,cut.to,cut.height);at=cut.to;}
    add(at,length,0);
  }
  return pieces;
}

export function carryRoomDoorways(before, next, edit, parts) {
  const editedIds=[edit.room.id,edit.neighbor?.id].filter(Boolean);
  const replacementIds=edit.mode==='split' ? [edit.room.id,next.rooms.at(-1).id] :
    edit.mode==='merge' ? [edit.room.id] : editedIds;
  const result=(before.doorways || []).filter(d=>!d.roomIds.some(id=>editedIds.includes(id)));
  for(const door of before.doorways || []) {
    if(!door.roomIds.some(id=>editedIds.includes(id))) continue;
    if(edit.mode==='merge' && door.roomIds.every(id=>editedIds.includes(id))) continue;
    let point=[door.x,door.y];
    if(edit.mode==='move' && door.roomIds.every(id=>editedIds.includes(id))) {
      const local=edit.frame.local(point);
      point=edit.frame.world([Math.max(...parts[0].ring.map(p=>p[0])),local[1]]);
    }
    const choices=door.roomIds.map(id=>editedIds.includes(id)?replacementIds:[id]);
    let placed=null;
    for(const first of choices[0]) for(const second of choices[1]) {
      if(first===second || placed) continue;
      const rooms=[first,second].map(id=>next.rooms.find(r=>r.id===id));
      for(const wall of sharedRoomWalls(...rooms)) {
        if(projectOnWall(point,wall).distance>EPSILON) continue;
        try {placed=placeDoorway({...next,doorways:result},wall,point,{...door,roomIds:[first,second]});break;} catch {}
      }
    }
    if(!placed) throw Error('Move or remove doorway “'+door.name+'” before this room edit; its opening would no longer fit.');
    result.push(placed);
  }
  return {...next,doorways:result};
}
