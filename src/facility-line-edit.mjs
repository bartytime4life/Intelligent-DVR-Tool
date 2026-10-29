// Ordered open lines use local metres. Resizing a segment translates every later
// vertex, so the rest of the path keeps its shape and segment lengths.
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
  return units === 'imperial' ? value * 0.3048 : value;
}

export function validateEditableLine(points) {
  if (!Array.isArray(points) || points.length < 2 || points.length > MAX_LINE_POINTS ||
      !points.every(point => Array.isArray(point) && point.length === 2 && point.every(value => finite(value) && Math.abs(value) <= MAX_COORDINATE)))
    throw Error('Use a line with 2–200 points within 2 km of the site origin.');
  if (same(points[0],points.at(-1))) throw Error('Use an open line here. Closed polygons need their shape editor.');
  return points.map(point => [...point]);
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
  const offset=[dx*(metres/length-1),dy*(metres/length-1)];
  const next=clean.map((point,i)=>i<=index ? point : [point[0]+offset[0],point[1]+offset[1]]);
  return validateEditableLine(next);
}

export function setLineVertex(points, index, east, north, units = 'metric') {
  const clean=validateEditableLine(points);
  if (!Number.isInteger(index) || index < 0 || index >= clean.length) throw Error('Choose an existing line vertex.');
  const point=[lineMetres(east,units),lineMetres(north,units)];
  if ((index > 0 && same(point,clean[index-1])) || (index < clean.length-1 && same(point,clean[index+1])))
    throw Error('A vertex must be different from its neighboring vertices.');
  clean[index]=point;
  return validateEditableLine(clean);
}
