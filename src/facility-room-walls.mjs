import clipping from 'polygon-clipping';
import {carryRoomDoorways} from './facility-doorways.mjs';
import {LIMITS, polygonArea, validPolygon, uid} from './facility.mjs';
import {floorFrame} from './facility-room-sketch.mjs';
import {stairOnLevel,stairFootprint} from './facility-stairs.mjs';

const EPSILON = 1e-8;

function bounds(ring) {
  const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
  return {left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys)};
}

function separated(a, b) {
  return a.left > b.right + EPSILON || a.right < b.left - EPSILON ||
    a.top > b.bottom + EPSILON || a.bottom < b.top - EPSILON;
}

// Find a positive-length common edge, including a partial edge and subdivided edges.
// Bounds and the projected interval exclude corner contacts and collinear extensions.
function sharedEdge(first, second) {
  for (let i = 1; i < first.length; i++) {
    const [x, y] = first[i - 1], dx = first[i][0] - x, dy = first[i][1] - y;
    const length = Math.hypot(dx, dy), ux = dx / length, uy = dy / length;
    const along = p => (p[0] - x) * ux + (p[1] - y) * uy;
    const across = p => (p[1] - y) * ux - (p[0] - x) * uy;
    for (let j = 1; j < second.length; j++) {
      const a = second[j - 1], b = second[j];
      if (Math.abs(across(a)) > EPSILON || Math.abs(across(b)) > EPSILON) continue;
      const u = along(a), v = along(b);
      if (Math.min(length, Math.max(u, v)) - Math.max(0, Math.min(u, v)) > EPSILON)
        return {point: [x, y], normal: [-uy, ux]};
    }
  }
  return null;
}

export function wallNeighbors(rooms, room) {
  const box = bounds(room.footprint);
  return rooms.filter(other => other.id !== room.id && other.buildingId === room.buildingId && other.level === room.level &&
    !separated(box, bounds(other.footprint)) && sharedEdge(room.footprint, other.footprint));
}

function singleOutline(multi, message) {
  if (multi.length !== 1 || multi[0].length !== 1) throw Error(message);
  return multi[0][0];
}

function occupiedCheck(plan, room, neighbor, building) {
  const here = item => item.buildingId === room.buildingId && item.level === room.level;
  const selected = neighbor ? [room, neighbor] : [room];
  const obstacles = [
    ...plan.rooms.filter(r => here(r) && !selected.includes(r)),
    ...(plan.openings || []).filter(here),
    ...(plan.stairs || []).filter(s => s.buildingId === room.buildingId && stairOnLevel(s,room.level))
      .map(s => ({name:s.name, footprint:stairFootprint(s,building)}))
  ];
  for (const item of selected) {
    const box = bounds(item.footprint);
    for (const obstacle of obstacles) {
      if (separated(box, bounds(obstacle.footprint))) continue;
      if (clipping.intersection([item.footprint], [obstacle.footprint]).some(p => polygonArea(p[0]) > EPSILON))
        throw Error('“' + item.name + '” overlaps “' + obstacle.name + '”. Adjust their outlines first.');
    }
  }
}

function movableNormal(room, neighbor, edge) {
  const [x, y] = edge.point;
  const distance = ([u, v]) => (u - x) * edge.normal[0] + (v - y) * edge.normal[1];
  const left = room.footprint.map(distance), right = neighbor.footprint.map(distance);
  if (Math.max(...left) <= EPSILON && Math.min(...right) >= -EPSILON) return edge.normal;
  if (Math.min(...left) >= -EPSILON && Math.max(...right) <= EPSILON) return edge.normal.map(n => -n);
  throw Error('These rooms wrap around each other. Choose a pair separated by a straight wall.');
}

// Prepare once per room pair. The pointer preview only clips this small, local outline.
export function prepareWallEdit(plan, room, mode, neighbor) {
  const building = plan.buildings.find(b => b.id === room.buildingId);
  if (!building || building.openFloors?.includes(room.level)) throw Error('Choose a room on a solid floor.');
  if (mode === 'split' && plan.rooms.length >= LIMITS.rooms) throw Error('The facility has reached its 500-room limit.');
  let direction = floorFrame(room.footprint).direction, edge = null;
  if (mode !== 'split') {
    if (!neighbor || neighbor.id === room.id || neighbor.level !== room.level || neighbor.buildingId !== room.buildingId)
      throw Error('Choose a neighboring room on this floor.');
    edge = sharedEdge(room.footprint, neighbor.footprint);
    if (!edge) throw Error('Choose two rooms that share a wall.');
    if (mode === 'merge' && room.wallHeight !== neighbor.wallHeight)
      throw Error('Set both rooms to the same wall height before merging.');
    if (mode === 'move') direction = movableNormal(room, neighbor, edge);
  } else neighbor = null;

  occupiedCheck(plan, room, neighbor, building);
  const points = neighbor ? room.footprint.concat(neighbor.footprint) : room.footprint;
  const frame = floorFrame(points, direction);
  const original = room.footprint.map(frame.local);
  let outline = original, secondRing = null;
  if (neighbor) {
    secondRing = neighbor.footprint.map(frame.local);
    if (clipping.intersection([original], [secondRing]).some(p => polygonArea(p[0]) > EPSILON))
      throw Error('These room outlines overlap. Correct the overlap before editing their shared wall.');
    outline = singleOutline(clipping.union([original], [secondRing]), 'These rooms must form one continuous outline without an enclosed opening.');
  }
  return {frame, outline, original, secondRing, room, neighbor, mode, originalPosition: mode === 'move' ? frame.local(edge.point)[0] : null};
}

function worldFootprint(frame, ring) {
  const footprint = ring.map(frame.world).map(point => point.map(n =>
    Math.abs(Math.abs(n) - 2000) < EPSILON ? Math.sign(n) * 2000 : n));
  if (!validPolygon(footprint)) throw Error('Each room needs a simple outline of at least 1 m² with at most 200 corners.');
  return footprint;
}

export function previewWallEdit(edit, axis, position) {
  const {outline, frame} = edit;
  let rings = [outline];
  if (edit.mode !== 'merge') {
    const {w, h} = frame.box, vertical = axis === 'x';
    if (!Number.isFinite(position) || position <= 0 || position >= (vertical ? w : h))
      throw Error('Place the wall inside the outline.');
    const rect = (left, top, right, bottom) => [[[left,top],[right,top],[right,bottom],[left,bottom],[left,top]]];
    const halves = vertical ? [rect(-1,-1,position,h+1),rect(position,-1,w+1,h+1)] :
      [rect(-1,-1,w+1,position),rect(-1,position,w+1,h+1)];
    rings = halves.map(half => singleOutline(clipping.intersection([outline], half), 'Move the wall so each side forms one connected room.'));
  }
  return rings.map(ring => ({ring, footprint:worldFootprint(frame,ring), area:polygonArea(ring)}));
}

export function applyWallEdit(plan, edit, parts, newName, makeId = () => uid('r')) {
  const {room, neighbor, mode} = edit;
  if (!plan.rooms.includes(room) || (neighbor && !plan.rooms.includes(neighbor)))
    throw Error('The rooms have changed. Reopen the wall editor.');
  const replacements = new Map([[room.id, {...room, footprint:parts[0].footprint}]]);
  if (mode === 'move') replacements.set(neighbor.id, {...neighbor, footprint:parts[1].footprint});
  const rooms = plan.rooms.filter(item => mode !== 'merge' || item.id !== neighbor.id)
    .map(item => replacements.get(item.id) || item);
  if (mode === 'split') {
    if (!newName.trim() || newName.trim().length > 100) throw Error('Give the new room a name of up to 100 characters.');
    rooms.push({...room, id:makeId(), name:newName.trim(), footprint:parts[1].footprint});
  }
  return carryRoomDoorways(plan,{...plan,rooms},edit,parts);
}
