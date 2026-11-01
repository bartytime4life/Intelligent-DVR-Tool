import { stairOnLevel, stairDimensions, stairFootprint } from "./facility-stairs.mjs";
// Measurements use the plan's local metre coordinates, not survey accuracy.
const FEET_PER_METRE = 1 / 0.3048;
const finitePoint = p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const number = value => value.toLocaleString('en-US', {maximumFractionDigits: 1, minimumFractionDigits: 1});

export function formatDistance(metres, units = 'metric') {
  return `${number(metres * (units === 'imperial' ? FEET_PER_METRE : 1))} ${units === 'imperial' ? 'ft' : 'm'}`;
}

export function formatArea(squareMetres, units = 'metric') {
  return `${number(squareMetres * (units === 'imperial' ? FEET_PER_METRE ** 2 : 1))} ${units === 'imperial' ? 'ft²' : 'm²'}`;
}

export function lineMeasurements(points) {
  if (!Array.isArray(points) || !points.every(finitePoint)) return {segments: [], length: 0};
  const segments = points.slice(1).map((end, i) => {
    const start = points[i];
    return {index: i, point: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2], length: Math.hypot(end[0] - start[0], end[1] - start[1])};
  }).filter(segment => segment.length > 0);
  return {segments, length: segments.reduce((total, segment) => total + segment.length, 0)};
}

export function lineRibbonSegments(points, width = .28) {
  if (!Array.isArray(points) || !points.every(finitePoint) || !Number.isFinite(width) || width <= 0 || width > 10) return [];
  return points.slice(1).flatMap((b,index) => {
    const a=points[index], dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
    if (!length) return [];
    const offset=[-dy / length * width / 2, dx / length * width / 2];
    const at=(p,sign)=>[p[0]+offset[0]*sign,p[1]+offset[1]*sign];
    return [[at(a,1),at(b,1),at(b,-1),at(a,-1),at(a,1)]];
  });
}

// The overhead editor uses a flat coordinate plane. Display mode preserves the
// actual elevation; a hole in one slab does not remove any neighbouring slab.
export function floorElevation(building, level, flattened = false) {
  return flattened ? 0 : (building.base || 0) + level * (building.height - (building.base || 0)) / building.floors;
}

export function floorRenderPlan(building, requestedLevel, view, editing = false) {
  if (!building) return {level:0,flattened:false,slabLevels:[]};
  const level = Math.max(0, Math.min(Number.isInteger(requestedLevel) ? requestedLevel : 0, building.floors - 1));
  const flattened = view === 'floors' && editing;
  const candidates = view === '3d' ? Array.from({length:building.floors},(_,index)=>index) : view === 'floors' ? flattened ? [level] : [level-1,level].filter(index=>index>=0) : [];
  return {level,flattened,slabLevels:candidates.filter(index=>!(building.openFloors || []).includes(index))};
}

const ringArea = ring => Math.abs(ring.slice(1).reduce((total, p, i) => total + ring[i][0] * p[1] - p[0] * ring[i][1], 0)) / 2;

export function polygonMeasurements(footprint, holes = []) {
  const rings = [footprint, ...holes];
  if (!rings.every(ring => Array.isArray(ring) && ring.length >= 4 && ring.every(finitePoint))) return {area: 0, perimeter: 0, segments: []};
  const boundaries = rings.map(lineMeasurements);
  return {
    area: Math.max(0, ringArea(footprint) - holes.reduce((total, hole) => total + ringArea(hole), 0)),
    perimeter: boundaries.reduce((total, ring) => total + ring.length, 0),
    segments: boundaries.flatMap((ring, ringIndex) => ring.segments.map(segment => ({...segment, ringIndex}))),
  };
}

// Keep the selected polygon's dimensions first. Large plans never create an
// unbounded DOM label per vertex; the summary remains exact when labels truncate.
export function measurementLabels(plan, selectedId, {units = 'metric', maxLabels = 64, floorBuildingId, floor = 0, view = '3d'} = {}) {
  const limit = Math.max(0, Math.min(64, Number.isFinite(maxLabels) ? Math.floor(maxLabels) : 64));
  if (!limit) return [];
  const onFloor = item => view === '3d' || (view === 'floors' && item.buildingId === floorBuildingId && item.level === floor);
  const stair = (plan.stairs || []).find(item => item.id === selectedId && (view === '3d' || (view === 'floors' && item.buildingId === floorBuildingId && stairOnLevel(item,floor))));
  const stairBuilding = stair && plan.buildings.find(building => building.id === stair.buildingId);
  let selected = [...plan.buildings, ...plan.rooms.filter(room => view !== 'floors' || (room.level === floor && (!floorBuildingId || room.buildingId === floorBuildingId))), ...(plan.zones || []).filter(zone => !zone.buildingId || (view === 'floors' && zone.buildingId === floorBuildingId && zone.level === floor)), ...(plan.openings || []).filter(item=>onFloor(item) && !(plan.buildings.find(b=>b.id===item.buildingId)?.openFloors || []).includes(item.level)), ...(stairBuilding ? [{...stair,footprint:stairFootprint(stair,stairBuilding)}] : [])].find(item => item.id === selectedId);
  if (selected && view === 'floors' && selected.id === floorBuildingId && plan.buildings.includes(selected)) {
    selected = {...selected,courtyardCount:(selected.holes || []).length,floorSlab:true,openFloor:(selected.openFloors || []).includes(floor),
      holes:[...(selected.holes || []),...(plan.openings || []).filter(opening => opening.buildingId === selected.id && opening.level === floor).map(opening => opening.footprint)]};
  }
  const labels = [];
  if (selected?.footprint) {
    const result = polygonMeasurements(selected.footprint, selected.holes || []);
    const vertices = selected.footprint.slice(0, -1);
    const center = [0, 1].map(axis => vertices.reduce((sum, point) => sum + point[axis], 0) / vertices.length);
    labels.push({point: center, text: selected.openFloor ? `Floor ${floor+1} · open · no slab` : `${selected.floorSlab ? `Floor ${floor+1} · ` : ''}${formatArea(result.area, units)} · boundary ${formatDistance(result.perimeter, units)}`, summary: true, primary: true});
    if (!selected.openFloor) labels.push(...result.segments.slice(0, Math.max(0, limit - 1)).map(segment => ({point: segment.point, text: `${segment.ringIndex ? selected.floorSlab && segment.ringIndex > selected.courtyardCount ? 'Opening · ' : 'Courtyard · ' : ''}${formatDistance(segment.length, units)}`})));
  }
  if (stairBuilding && labels.length) {
    const metrics = stairDimensions(stair,stairBuilding);
    labels[0].text=`Stair ${formatDistance(metrics.length,units)} × ${formatDistance(metrics.width,units)} · rise ${formatDistance(metrics.rise,units)}`;
  }
  const path = (plan.paths || []).find(item => item.id === selectedId && onFloor(item));
  if (path) {
    const result=lineMeasurements(path.points);
    if (result.segments.length && labels.length < limit) {
      labels.push({point:path.points.at(-1),text:`${path.name} · ${formatDistance(result.length,units)}`,summary:true,primary:true});
      labels.push(...result.segments.slice(0,Math.max(0,limit-labels.length)).map(segment=>({point:segment.point,text:formatDistance(segment.length,units),route:true})));
    }
  }
  const route = lineMeasurements(plan.route);
  if (route.segments.length && labels.length < limit) {
    labels.push({point: plan.route.at(-1), text: `Route ${formatDistance(route.length, units)}`, summary: true});
    labels.push(...route.segments.slice(0, Math.max(0, limit - labels.length)).map(segment => ({point: segment.point, text: formatDistance(segment.length, units), route: true})));
  }
  return labels.slice(0, limit);
}

// Greedy screen-space placement. Required selected summaries are never hidden;
// other labels may reappear when zooming creates enough pixel separation.
export function visibleLabelIndices(labels, gap = 6) {
  const visible = new Set(), occupied = [];
  const ordered = labels.map((label,index)=>({...label,index})).sort((a,b)=>(a.priority || 0)-(b.priority || 0) || a.index-b.index);
  for (const label of ordered) {
    const r=label.rect;
    if (!r || ![r.left,r.top,r.right,r.bottom].every(Number.isFinite)) continue;
    const overlaps=occupied.some(o=>r.left < o.right+gap && r.right+gap > o.left && r.top < o.bottom+gap && r.bottom+gap > o.top);
    if (label.keep || !overlaps) {visible.add(label.index);occupied.push(r);}
  }
  return visible;
}
