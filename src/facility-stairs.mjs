// Planning geometry for one straight flight between two modeled levels.
// Code references are guidance, not proof of local adoption or compliance.
export const STAIR_REFERENCE = Object.freeze({
  title: '2024 IBC §1011 · general stair guidance',
  url: 'https://codes.iccsafe.org/content/IBC2024V2.0/chapter-10-means-of-egress',
  minWidth: 44 * .0254,
  minTread: 11 * .0254,
  minRiser: 4 * .0254,
  maxRiser: 7 * .0254,
  minHeadroom: 80 * .0254,
  maxLandingDepthRequired: 48 * .0254,
  maxFlightRise: 12 * .3048,
});
const number = (v,min,max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const validName = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 100;
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const round = value => Number(value.toFixed(8));

export function validateStair(stair, building) {
  if (!stair || !building || stair.buildingId !== building.id || !validId(stair.id) || !validName(stair.name) ||
      !Number.isInteger(stair.fromLevel) || !Number.isInteger(stair.toLevel) || stair.fromLevel < 0 ||
      stair.fromLevel >= building.floors || stair.toLevel < 0 || stair.toLevel === stair.fromLevel || stair.toLevel >= building.floors ||
      !number(stair.x,-2000,2000) || !number(stair.y,-2000,2000) || !number(stair.bearing,0,359.99) ||
      !number(stair.width,.3,30) || !number(stair.tread,.05,2) || !number(stair.landing,.3,10) ||
      !Number.isInteger(stair.risers) || stair.risers < 2 || stair.risers > 100)
    throw Error('Stairs need two different existing levels, a valid position, width 0.3–30 m, tread 0.05–2 m, landing 0.3–10 m and 2–100 risers.');
  return Object.fromEntries(['id','name','buildingId','fromLevel','toLevel','x','y','bearing','width','tread','risers','landing'].map(key=>[key,stair[key]]));
}

export function stairDimensions(stair, building) {
  const spacing=(building.height-(building.base || 0))/building.floors;
  const rise=Math.abs(stair.toLevel-stair.fromLevel)*spacing;
  const base=(building.base || 0)+Math.min(stair.fromLevel,stair.toLevel)*spacing, riser=rise/stair.risers;
  const run=(stair.risers-1)*stair.tread, length=run+2*stair.landing;
  const warnings=[], tolerance=1e-8;
  if(riser>STAIR_REFERENCE.maxRiser+tolerance) warnings.push('Risers exceed the general 7 in maximum. Increase the riser count.');
  if(riser<STAIR_REFERENCE.minRiser-tolerance) warnings.push('Risers are below the general 4 in minimum. Review the riser count.');
  if(stair.tread<STAIR_REFERENCE.minTread-tolerance) warnings.push('Treads are below the general 11 in minimum.');
  if(stair.width<STAIR_REFERENCE.minWidth-tolerance) warnings.push('Clear width is below the general 44 in minimum. Occupancy-specific exceptions are not assumed.');
  if(stair.landing<Math.min(stair.width,STAIR_REFERENCE.maxLandingDepthRequired)-tolerance) warnings.push('Landing depth is below the general straight-run minimum for this width.');
  if(rise>STAIR_REFERENCE.maxFlightRise+tolerance) warnings.push('Rise exceeds 12 ft for one flight. Plan an intermediate landing and separate flights; this straight-flight sketch does not include them.');
  return {rise,riser,run,length,width:stair.width,base,top:base+rise,headroom:STAIR_REFERENCE.minHeadroom,warnings};
}

function rectangle(stair, start, end) {
  const angle=stair.bearing*Math.PI/180, forward=[Math.sin(angle),Math.cos(angle)], right=[Math.cos(angle),-Math.sin(angle)];
  const point=(side,along)=>[round(stair.x+right[0]*side+forward[0]*along),round(stair.y+right[1]*side+forward[1]*along)];
  return [point(-stair.width/2,start),point(stair.width/2,start),point(stair.width/2,end),point(-stair.width/2,end),point(-stair.width/2,start)];
}

export function stairLandingRings(stair,building) {
  const half=stairDimensions(stair,building).length/2;
  const landings=[rectangle(stair,-half,-half+stair.landing),rectangle(stair,half-stair.landing,half)];
  return stair.toLevel>stair.fromLevel?landings:landings.reverse();
}
export const stairOnLevel=(s,level)=>level>=Math.min(s.fromLevel,s.toLevel) && level<=Math.max(s.fromLevel,s.toLevel);

export function stairFootprint(stair, building) {
  const {length}=stairDimensions(stair,building);
  return rectangle(stair,-length/2,length/2);
}

// A candidate opening over the flight run only; landing/headroom review remains explicit.
export function stairRunFootprint(stair, building) {
  const {run}=stairDimensions(stair,building);
  return rectangle(stair,-run/2,run/2);
}

export function stairTreadPolygons(stair, building) {
  const {length,base,top,riser}=stairDimensions(stair,building);
  // Malformed draft inputs must not allocate unbounded render geometry.
  if(!Number.isInteger(stair.risers) || stair.risers<2 || stair.risers>100 || !Number.isFinite(length)) return [];
  const start=-length/2, runStart=start+stair.landing;
  const result=[{footprint:rectangle(stair,start,runStart),base,top:base+Math.min(.04,riser/2)}];
  for(let i=0;i<stair.risers-1;i++) result.push({footprint:rectangle(stair,runStart+i*stair.tread,runStart+(i+1)*stair.tread),base,top:base+(i+1)*riser});
  result.push({footprint:rectangle(stair,length/2-stair.landing,length/2),base,top});
  return result;
}

export function defaultStair(building, floor=0, footprintFits, destination) {
  if(!building || building.floors<2) throw Error('Add an upper level before placing stairs.');
  const level=destination===undefined?Math.max(0,Math.min(building.floors-2,Math.floor(floor))):floor;
  const toLevel=destination ?? level+1;
  const points=building.footprint.slice(0,-1), center=[0,1].map(axis=>points.reduce((sum,p)=>sum+p[axis],0)/points.length);
  const rise=Math.abs(toLevel-level)*(building.height-(building.base || 0))/building.floors;
  const stair={id:'st-'+crypto.randomUUID().slice(0,8),name:'Straight stair',buildingId:building.id,fromLevel:level,toLevel,
    x:round(center[0]),y:round(center[1]),bearing:0,width:STAIR_REFERENCE.minWidth,tread:STAIR_REFERENCE.minTread,
    risers:Math.max(2,Math.min(100,Math.ceil(rise/STAIR_REFERENCE.maxRiser))),landing:STAIR_REFERENCE.minWidth};
  if(!footprintFits) return stair;
  // The caller supplies the shared geometry checks, avoiding a facility-module cycle.
  const tryPosition=(x,y,bearing)=>{
    const candidate={...stair,x:round(x),y:round(y),bearing:round((bearing+360)%180)};
    return footprintFits(stairFootprint(candidate,building),candidate) ? candidate : null;
  };
  for(const bearing of [0,90]) {
    const candidate=tryPosition(...center,bearing);if(candidate)return candidate;
  }
  const {length}=stairDimensions(stair,building);
  // Edge-aligned candidates find narrow wings and rotated buildings before a grid scan.
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length],dx=b[0]-a[0],dy=b[1]-a[1],edge=Math.hypot(dx,dy);
    if(!edge)continue;
    const ux=dx/edge,uy=dy/edge,bearing=Math.atan2(dx,dy)*180/Math.PI;
    for(const crosswise of [false,true]) {
      const along=(crosswise ? stair.width : length)/2,across=(crosswise ? length : stair.width)/2;
      for(const distance of [edge/2,along+.01,edge-along-.01]) {
        if(distance<along || distance>edge-along)continue;
        for(const side of [1,-1]) {
          const candidate=tryPosition(a[0]+ux*distance-uy*side*(across+.01),a[1]+uy*distance+ux*side*(across+.01),bearing+(crosswise ? 90 : 0));
          if(candidate)return candidate;
        }
      }
    }
  }
  const bounds=[0,1].map(axis=>[Math.min(...points.map(p=>p[axis])),Math.max(...points.map(p=>p[axis]))]);
  for(let x=1;x<10;x++)for(let y=1;y<10;y++)for(const bearing of [0,90]) {
    const candidate=tryPosition(bounds[0][0]+(bounds[0][1]-bounds[0][0])*x/10,bounds[1][0]+(bounds[1][1]-bounds[1][0])*y/10,bearing);
    if(candidate)return candidate;
  }
  throw Error('No fitting location was found for the default straight stair and both landings. Review the building footprint or level rise.');
}
