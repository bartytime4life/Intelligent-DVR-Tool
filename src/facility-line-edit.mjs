// Ordered lines use local metres. Resizing a segment translates every later vertex, so
// the rest of the path keeps its shape; a closed loop keeps its end on its start instead.
const MAX_COORDINATE = 2000;
export const MAX_LINE_POINTS = 200;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const same = (a,b) => a[0] === b[0] && a[1] === b[1];

export function lineInputValue(metres, units = 'metric') {
  if (!finite(metres) || !['metric','imperial'].includes(units)) throw Error('Use a finite measurement in metres or feet.');
  return units === 'imperial' ? metres / 0.3048 : metres;
}

export function lineMetres(value, units = 'metric') {
  if (!finite(value) || !['metric','imperial'].includes(units)) throw Error('Enter a finite measurement in metres or feet.');
  return Math.round((units === 'imperial' ? value * 0.3048 : value) * 1e4) / 1e4;
}
export const isClosedLine = points => points.length > 2 && same(points[0], points.at(-1));

export function validateEditableLine(points) {
  if (!Array.isArray(points) || points.length < 2 || points.length > MAX_LINE_POINTS ||
      !points.every(point => Array.isArray(point) && point.length === 2 && point.every(value => finite(value) && Math.abs(value) <= MAX_COORDINATE)))
    throw Error('Use a line with 2–200 points within 2 km of the site origin.');
  if (same(points[0],points.at(-1)) && points.length < 4) throw Error('A closed loop needs at least three distinct points.');
  return points.map(point => [...point]);
}

// Keyboard entry: one "east, north" pair per line in the display unit.
export function parsePointList(text, units = 'metric') {
  if (typeof text !== 'string' || text.length > 10000) throw Error('The point list is too large. Use at most 200 points.');
  const points = text.split('\n').map(line => line.trim()).filter(Boolean).map(line => line.split(/[\s,;]+/).filter(Boolean).map(Number));
  if (points.some(point => point.length !== 2 || !point.every(Number.isFinite))) throw Error('Enter one east, north pair per line, for example 12.5, -4.');
  return validateEditableLine(points.map(([east,north]) => [lineMetres(east,units),lineMetres(north,units)]));
}

export function editableLineLength(points) {
  const clean=validateEditableLine(points);
  return clean.slice(1).reduce((sum,point,index)=>sum+Math.hypot(point[0]-clean[index][0],point[1]-clean[index][1]),0);
}

export function setLineSegmentLength(points, index, value, units = 'metric') {
  const clean=validateEditableLine(points), metres=lineMetres(value,units);
  if (!Number.isInteger(index) || index < 0 || index >= clean.length-1) throw Error('Choose an existing line segment.');
  if (metres <= 0) throw Error('Segment length must be greater than zero.');
  const start=clean[index], end=clean[index+1];
  const dx=end[0]-start[0], dy=end[1]-start[1], length=Math.hypot(dx,dy);
  if (length === 0) throw Error('This segment has no direction. Move one of its vertices first.');
  const offset=[start[0]+dx*metres/length-end[0],start[1]+dy*metres/length-end[1]], closed=isClosedLine(clean), last=clean.length-1;
  if (closed && index === last-1) return validateEditableLine(clean.map((point,i)=>i===index ? [end[0]-dx*metres/length,end[1]-dy*metres/length] : point));
  const next=clean.map((point,i)=>i<=index || closed && i===last ? point : [point[0]+offset[0],point[1]+offset[1]]);
  return validateEditableLine(next);
}

export function setLineVertex(points, index, east, north, units = 'metric') {
  const clean=validateEditableLine(points);
  if (!Number.isInteger(index) || index < 0 || index >= clean.length) throw Error('Choose an existing line vertex.');
  const point=[lineMetres(east,units),lineMetres(north,units)], closed=isClosedLine(clean), last=clean.length-1;
  const i=closed && index===last ? 0 : index, before=i>0 ? clean[i-1] : closed ? clean[last-1] : null, after=i<last ? clean[i+1] : null;
  if ((before && same(point,before)) || (after && same(point,after)))
    throw Error('A vertex must be different from its neighboring vertices.');
  clean[i]=point;
  if (closed && i===0) clean[last]=[...point];
  return validateEditableLine(clean);
}
