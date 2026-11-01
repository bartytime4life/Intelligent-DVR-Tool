import {projectOnWall,doorwaySegment} from './facility-doorways.mjs';

export const WINDOW_LIMIT=1000;
export const WINDOW_WIDTH={min:.3,max:10,initial:1.5};
const EPS=1e-5;
const dist=(a,b)=>Math.hypot(b[0]-a[0],b[1]-a[1]);
const at=(wall,d)=>{const [a,b]=wall.points,len=dist(a,b);return a.map((n,i)=>n+(b[i]-n)*d/len);};
export const windowFloorHeight=building=>(building.height-(building.base || 0))/building.floors;

// Collapse harmless collinear vertices, including the ring's closing seam.
export function exteriorWindowWalls(building,level) {
  if(!building)return [];
  return [building.footprint,...(building.holes || [])].flatMap((ring,ringIndex)=>{
    const vertices=ring.slice(0,-1).filter((p,i,all)=>{
      const a=all[(i+all.length-1)%all.length],b=all[(i+1)%all.length];
      return Math.abs((p[0]-a[0])*(b[1]-p[1])-(p[1]-a[1])*(b[0]-p[0]))>EPS;
    });
    return vertices.map((a,i)=>{
      const b=vertices[(i+1)%vertices.length],points=[[...a],[...b]];
      if(a[0]>b[0]+EPS || Math.abs(a[0]-b[0])<=EPS && a[1]>b[1])points.reverse();
      return {points,buildingId:building.id,level,ringIndex,name:`${ringIndex?'Courtyard '+ringIndex:'Outside'} wall ${i+1}`};
    }).filter(w=>dist(...w.points)>=WINDOW_WIDTH.min);
  });
}
export function windowWall(plan,window) {
  const building=plan.buildings.find(b=>b.id===window?.buildingId);
  return exteriorWindowWalls(building,window?.level).find(w=>projectOnWall([window.x,window.y],w).distance<=EPS) || null;
}
export const windowSegment=doorwaySegment;
function neighbors(plan,wall,window) {
  return (plan.windows || []).filter(w=>w.id!==window.id && w.buildingId===wall.buildingId && w.level===wall.level)
    .map(w=>({...w,projection:projectOnWall([w.x,w.y],wall)})).filter(w=>w.projection.distance<=EPS);
}
export function placeWindow(plan,wall,point,window) {
  const {length,along}=projectOnWall(point,wall),half=window.width/2;
  if(!Number.isFinite(half) || window.width<WINDOW_WIDTH.min || window.width>WINDOW_WIDTH.max || window.width>length+EPS)
    throw Error('Use a window width from 0.3 to 10 m that fits this wall.');
  let ranges=[[half,length-half]];
  for(const other of neighbors(plan,wall,window)) {
    const low=other.projection.along-other.width/2-half,high=other.projection.along+other.width/2+half;
    ranges=ranges.flatMap(([a,b])=>high<=a || low>=b?[[a,b]]:[[a,Math.min(b,low)],[Math.max(a,high),b]].filter(([x,y])=>y>=x));
  }
  if(!ranges.length)throw Error('There is no clear space for this window on the wall.');
  const offsets=ranges.map(([a,b])=>Math.max(a,Math.min(b,along)));
  const offset=offsets.reduce((best,n)=>Math.abs(n-along)<Math.abs(best-along)?n:best),[x,y]=at(wall,offset);
  return {...window,buildingId:wall.buildingId,level:wall.level,x,y};
}
// Drag either end while the opposite end stays anchored. Neighbors and corners
// are hard stops, so resizing never teleports to the other side of a window.
export function resizeWindow(plan,wall,window,end,point) {
  const {length,along}=projectOnWall([window.x,window.y],wall),target=projectOnWall(point,wall).along;
  const start=along-window.width/2,finish=along+window.width/2;
  let low=0,high=length;
  for(const w of neighbors(plan,wall,window)) {
    const a=w.projection.along-w.width/2,b=w.projection.along+w.width/2;
    if(b<=start+EPS)low=Math.max(low,b);
    if(a>=finish-EPS)high=Math.min(high,a);
  }
  const a=end==='start'?Math.max(low,finish-WINDOW_WIDTH.max,Math.min(finish-WINDOW_WIDTH.min,target)):start;
  const b=end==='end'?Math.min(high,start+WINDOW_WIDTH.max,Math.max(start+WINDOW_WIDTH.min,target)):finish;
  const [x,y]=at(wall,(a+b)/2);
  return {...window,x,y,width:Math.max(WINDOW_WIDTH.min,Math.min(WINDOW_WIDTH.max,b-a))};
}
export function moveWindow(plan,wall,window,point) {
  const {along,length}=projectOnWall([window.x,window.y],wall),half=window.width/2;
  let low=half,high=length-half;
  for(const other of neighbors(plan,wall,window)) {
    if(other.projection.along<along)low=Math.max(low,other.projection.along+other.width/2+half);
    else high=Math.min(high,other.projection.along-other.width/2-half);
  }
  const [x,y]=at(wall,Math.max(low,Math.min(high,projectOnWall(point,wall).along)));
  return {...window,x,y};
}
export function validateWindows(plan,windows) {
  for(const window of windows) {
    const building=plan.buildings.find(b=>b.id===window.buildingId);
    if(!building || !Number.isInteger(window.level) || window.level<0 || window.level>=building.floors ||
      ![window.x,window.y,window.width,window.height,window.sill].every(Number.isFinite) ||
      window.width<WINDOW_WIDTH.min-EPS || window.width>WINDOW_WIDTH.max+EPS || window.height<.2-EPS || window.sill<0 || window.sill+window.height>windowFloorHeight(building)+EPS)
      throw Error('Window “'+window.name+'” needs an existing floor, width 0.3–10 m, height at least 0.2 m, and a sill that keeps it within this level.');
    const wall=windowWall(plan,window),p=wall && projectOnWall([window.x,window.y],wall);
    if(!wall || p.along<window.width/2-EPS || p.along+window.width/2>p.length+EPS)
      throw Error('Window “'+window.name+'” must fit on an outside wall. Move or remove it before changing the outline.');
    if(neighbors({...plan,windows},wall,window).some(w=>Math.abs(w.projection.along-p.along)<(w.width+window.width)/2-EPS))
      throw Error('Window “'+window.name+'” overlaps another window on this wall.');
  }
  return windows.map(w=>Object.fromEntries(['id','name','buildingId','level','x','y','width','height','sill'].map(k=>[k,w[k]])));
}

// Produce solid rectangles around aperture rectangles. Rendering uses these;
// glazing is deliberately not assumed transparent by the coverage estimator.
export function cutWallPieces(ring,wallHeight,apertures) {
  const result=[];
  for(let i=1;i<ring.length;i++) {
    const wall={points:[ring[i-1],ring[i]]},[a,b]=wall.points,length=dist(a,b),cuts=[];
    for(const w of apertures) {
      if(w.segment){const [s,e]=w.segment;
        if(Math.abs((b[0]-a[0])*(e[1]-s[1])-(b[1]-a[1])*(e[0]-s[0]))>EPS*length*dist(s,e))continue;}
      const along=((w.x-a[0])*(b[0]-a[0])+(w.y-a[1])*(b[1]-a[1]))/length;
      const off=Math.abs((w.x-a[0])*(b[1]-a[1])-(w.y-a[1])*(b[0]-a[0]))/length;
      if(off>EPS || along+w.width/2<=0 || along-w.width/2>=length)continue;
      cuts.push({from:Math.max(0,along-w.width/2),to:Math.min(length,along+w.width/2),bottom:w.sill || 0,top:(w.sill || 0)+w.height});
    }
    const breaks=[...new Set([0,length,...cuts.flatMap(c=>[c.from,c.to])])].sort((a,b)=>a-b);
    for(let j=1;j<breaks.length;j++) {
      const from=breaks[j-1],to=breaks[j],mid=(from+to)/2;
      const gaps=cuts.filter(c=>mid>c.from && mid<c.to).sort((a,b)=>a.bottom-b.bottom);
      let base=0;
      const add=top=>{if(top-base>EPS && to-from>EPS)result.push({points:[at(wall,from),at(wall,to)],base,top});};
      for(const gap of gaps){add(Math.min(wallHeight,gap.bottom));base=Math.max(base,Math.min(wallHeight,gap.top));}
      add(wallHeight);
    }
  }
  return result;
}
