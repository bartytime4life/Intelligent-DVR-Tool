import { groundRange } from './facility.mjs';
// IEC 62676-4 pixel-density figures used as planning thresholds only; not a compliance or recognition-quality claim.
export const DORI_BANDS = Object.freeze([
  {id:'detect',name:'Detect',ppm:25,color:'#8fb8ff'},{id:'observe',name:'Observe',ppm:62.5,color:'#7ef0d9'},
  {id:'recognize',name:'Recognize',ppm:125,color:'#ffd27a'},{id:'identify',name:'Identify',ppm:250,color:'#ff8f9a'}]);
export const PIXELS_WIDE = Object.freeze({min:320,max:7680});
export const DORI_NOTE = 'Planning estimate — assumes ideal focus and no compression';
// Typical horizontal views of common fixed lenses on 1/2.8-inch sensors; a datasheet value always wins.
export const LENS_PRESETS = Object.freeze([
  {id:'2.8',label:'2.8 mm',hfov:103},{id:'4',label:'4 mm',hfov:84},{id:'6',label:'6 mm',hfov:54},
  {id:'8',label:'8 mm',hfov:41},{id:'12',label:'12 mm',hfov:27}]);
export const lensPreset = hfov => LENS_PRESETS.find(p => p.hfov === hfov) || null;
const tanHalf = hfov => Math.tan(hfov * Math.PI / 360);
// Horizontal pixels per metre at slant distance d, at the image centre: W / (2·d·tan(hfov/2)).
export const pixelsPerMetre = (pixelsWide, hfov, distance) => pixelsWide / (2 * distance * tanHalf(hfov));
export const slantDistanceFor = (pixelsWide, hfov, ppm) => pixelsWide / (2 * ppm * tanHalf(hfov));
export const pixelsWideOK = v => Number.isInteger(v) && v >= PIXELS_WIDE.min && v <= PIXELS_WIDE.max;
// Each band holds from the near ground limit out to √(d²−z²), clipped to the far ground limit.
export function doriDistances(c) {
  if (!c || !pixelsWideOK(c.pixelsWide) || ![c.z, c.tilt, c.hfov, c.vfov, c.range].every(Number.isFinite) || c.z <= 0 || c.hfov <= 0 || c.hfov >= 180) return null;
  const {near, far} = groundRange(c);
  return DORI_BANDS.map(band => {
    const slant = slantDistanceFor(c.pixelsWide, c.hfov, band.ppm), ground = slant > c.z ? Math.sqrt(slant * slant - c.z * c.z) : 0;
    return {...band, slant, ground, from:near, to:Math.min(ground, far), reached:ground > near && far > near, limited:ground >= far};
  });
}
export function densityAtGround(c, distance) {
  return pixelsWideOK(c?.pixelsWide) && Number.isFinite(distance) ? pixelsPerMetre(c.pixelsWide, c.hfov, Math.hypot(distance, c.z)) : null;
}
// Band arcs follow the selected camera's drawn fan and break wherever a wall shortens the ray; labels sit off the heading line.
export function doriArcs(c, fan) {
  const bands = doriDistances(c), count = (fan.length - 1) / 2;
  if (!bands || !Number.isInteger(count) || count < 2) return [];
  const rays = fan.slice(0, count).map(p => Math.hypot(p[0] - c.x, p[1] - c.y));
  return bands.filter(b => b.reached && !b.limited).map(b => {
    const lines = [];
    let line = [], label = null;
    rays.forEach((d, i) => {
      if (d + 1e-6 < b.to) { if (line.length > 1) lines.push(line); line = []; return; }
      const a = (c.bearing - c.hfov / 2 + c.hfov * i / (count - 1)) * Math.PI / 180, p = [c.x + Math.sin(a) * b.to, c.y + Math.cos(a) * b.to];
      line.push(p);
      if (i === Math.round((count - 1) * .8)) label = p;
    });
    if (line.length > 1) lines.push(line);
    if (!label && lines.length) label = lines[0][Math.floor(lines[0].length / 2)];
    return {...b, lines, label};
  }).filter(a => a.lines.length);
}
