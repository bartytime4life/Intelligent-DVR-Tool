import { validateFacility, buildingRings, wallObstacles, groundRange } from './facility.mjs';
import { fanCache } from './facility-coverage.mjs';
import { DORI_BANDS, DORI_NOTE, doriDistances } from './facility-dori.mjs';
import { formatDistance } from './facility-measurements.mjs';
import { facilityFilename } from './facility-library.mjs';

const escapeHTML = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n2 = v => +v.toFixed(2), deg = v => `${n2(v)}°`;
export const installerSheetFilename = plan => facilityFilename(plan).replace(/\.json$/, '-installer-sheet.html');
export const INSTALLER_LIMITS = Object.freeze([
  `${DORI_NOTE}. Pixel density uses the entered horizontal resolution and horizontal field of view at the image centre; lens distortion, sensor cropping, focus, lighting, motion blur and video encoding reduce real detail.`,
  'DORI bands use the IEC 62676-4 pixel-density figures (25, 62.5, 125 and 250 px/m) as planning thresholds. They are not a compliance, calibration or recognition-quality claim.',
  'DORI distances are horizontal ground distances from the mount point, √(d²−z²) for slant distance d and mount height z, clipped to each camera’s modeled near and far ground limits.',
  'Coverage shapes are ground-plane estimates that treat modeled building and room walls as opaque. They exclude floor slabs, openings, furniture, terrain, vegetation and lens effects.',
  'Positions are meters east and north of the plan origin on a local planning grid, not a survey. Lens presets are typical values; use the lens datasheet.',
  'Channel labels are planner notes. This sheet contains no camera credentials, stream addresses or footage.',
]);
// One row per camera, from a validated plan so only whitelisted fields reach the sheet.
export function installerRows(plan, units = 'metric') {
  const d = v => formatDistance(v, units);
  return validateFacility(plan).cameras.map(c => {
    const {near, far} = groundRange(c), dori = doriDistances(c);
    return {id:c.id, name:c.name, channel:c.channel || '', enabled:c.enabled, east:d(c.x), north:d(c.y), height:d(c.z), bearing:deg(c.bearing), tilt:deg(c.tilt),
      fov:`${n2(c.hfov)}° × ${n2(c.vfov)}°`, range:`${d(c.range)} · ground ${d(near)}–${d(Math.max(near, far))}`,
      resolution:c.pixelsWide ? `${c.pixelsWide} px wide` : 'Not set',
      dori:DORI_BANDS.map((band, i) => !dori ? '—' : !dori[i].reached ? 'Not reached' : `≤ ${d(dori[i].to)}${dori[i].limited ? ' (view limit)' : ''}`)};
  });
}
const NICE = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
// Inline SVG (the sheet's CSP blocks image URLs); plan y is north, so SVG y is negated.
export function installerPlanSVG(plan, units = 'metric', fanOf = fanCache()(wallObstacles(plan))) {
  const ground = (plan.zones || []).filter(z => z.buildingId === undefined), fans = plan.cameras.map(c => [c, fanOf(c)]).filter(([, f]) => f.length > 3);
  const points = [...plan.buildings.flatMap(b => b.footprint), ...ground.flatMap(z => z.footprint), ...plan.route, ...plan.cameras.map(c => [c.x, c.y]), ...fans.flatMap(([, f]) => f)];
  if (!points.length) points.push([-20, -20], [20, 20]);
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]), lo = [Math.min(...xs), Math.min(...ys)], hi = [Math.max(...xs), Math.max(...ys)];
  const extent = Math.max(hi[0] - lo[0], hi[1] - lo[1], 20), m = extent * .06, fs = Math.min(16, Math.max(1.5, extent / 40));
  const box = [lo[0] - m, -hi[1] - m * 1.6, hi[0] - lo[0] + 2 * m, hi[1] - lo[1] + m * 2.8].map(n2);
  const xy = p => `${n2(p[0])},${n2(-p[1])}`, ring = r => 'M' + r.map(xy).join('L') + 'Z', h = escapeHTML;
  const line = (cls, r) => `<path class="${cls}" d="${ring(r)}" vector-effect="non-scaling-stroke"/>`;
  const bar = NICE.find(v => v >= extent / 5) || 1000, bx = box[0] + m * .5, by = box[1] + box[3] - m * .6;
  const north = [box[0] + box[2] - m * .9, box[1] + m * 1.3];
  return `<svg class="plan" viewBox="${box.join(' ')}" role="img" aria-label="Plan view of ${h(plan.name)} with estimated camera coverage"><title>Plan view · estimated ground coverage · not to survey accuracy</title>
${fans.map(([, f]) => line('fan', f)).join('')}
${plan.buildings.map(b => `<path class="building" fill-rule="evenodd" d="${buildingRings(b).map(ring).join('')}" vector-effect="non-scaling-stroke"/>`).join('')}
${ground.map(z => line(`zone ${z.type === 'object_watch' ? 'watch' : 'restricted'}${z.enabled ? '' : ' off'}`, z.footprint)).join('')}
${plan.route.length > 1 ? `<polyline class="route" points="${plan.route.map(xy).join(' ')}" vector-effect="non-scaling-stroke"/>` : ''}
${plan.cameras.map(c => { const a = c.bearing * Math.PI / 180, l = fs * 2.6, tip = [c.x + Math.sin(a) * l, c.y + Math.cos(a) * l];
    return `<g class="camera${c.enabled ? '' : ' off'}"><line x1="${n2(c.x)}" y1="${n2(-c.y)}" x2="${n2(tip[0])}" y2="${n2(-tip[1])}" vector-effect="non-scaling-stroke"/><circle cx="${n2(c.x)}" cy="${n2(-c.y)}" r="${n2(fs * .45)}"/><text x="${n2(c.x + fs * .7)}" y="${n2(-c.y - fs * .6)}" font-size="${n2(fs)}">${h(c.id)}</text></g>`; }).join('')}
<g class="legend"><path d="M${n2(bx)},${n2(by)}h${bar}" vector-effect="non-scaling-stroke"/><text x="${n2(bx)}" y="${n2(by - fs * .5)}" font-size="${n2(fs)}">${h(formatDistance(bar, units))}</text>
<path d="M${n2(north[0])},${n2(north[1])}l${n2(-fs * .5)},${n2(fs * 1.3)}h${n2(fs)}z"/><text x="${n2(north[0])}" y="${n2(north[1] - fs * .45)}" text-anchor="middle" font-size="${n2(fs)}">N</text></g></svg>`;
}
export function installerSheetHTML(plan, {units = 'metric', generatedAt = new Date().toISOString(), fanOf} = {}) {
  const clean = validateFacility(plan), rows = installerRows(clean, units), h = escapeHTML;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Intelligent DVR installer sheet · ${h(clean.name)}</title><style>body{font:14px/1.55 system-ui,sans-serif;max-width:1240px;margin:40px auto;padding:0 24px;color:#152c35}h1{margin-bottom:4px}h2{margin-top:30px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{padding:7px;border-bottom:1px solid #cdd8db;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#edf4f3}.notice{padding:16px;background:#f4f0e5;border-left:4px solid #9c7427}.scroll{overflow:auto}.plan{display:block;width:100%;max-height:640px;border:1px solid #cdd8db;background:#fbfdfd}.fan{fill:#1f9fb0;fill-opacity:.16;stroke:#1f9fb0;stroke-opacity:.6;stroke-width:.6}.building{fill:#d5e0e3;stroke:#44606b;stroke-width:1.2}.zone{fill:none;stroke-width:1.4;stroke-dasharray:5 3}.restricted{stroke:#c43e50}.watch{stroke:#b07812}.zone.off{stroke:#8a9aa3}.route{fill:none;stroke:#d98a00;stroke-width:2;stroke-dasharray:6 4}.camera line{stroke:#0d6f7a;stroke-width:1.6}.camera circle{fill:#0d6f7a}.camera.off circle,.camera.off line{fill:#8a9aa3;stroke:#8a9aa3}.camera text,.legend text{fill:#152c35}.legend path{stroke:#152c35;stroke-width:2;fill:#152c35}.muted{color:#5b6f77}@media print{body{margin:0;max-width:none}thead{display:table-header-group}tr,.plan{break-inside:avoid}.scroll{overflow:visible}}</style>
<h1>Camera installer sheet</h1><p>${h(clean.name)} · Intelligent DVR · ${h(generatedAt)}</p>
<p class="notice"><strong>${h(DORI_NOTE)}</strong><br>Positions, angles and distances are planning values on a local grid. Verify each mount, bearing and lens on site before installation.</p>
<h2>Plan</h2><p>Origin ${h(clean.origin[1])}, ${h(clean.origin[0])} (latitude, longitude) · ${rows.length} ${rows.length === 1 ? 'camera' : 'cameras'} · shaded areas are estimated ground visibility of included cameras.</p>
${installerPlanSVG(clean, units, fanOf)}
<h2>Cameras</h2><p>East/north are from the plan origin; bearing is clockwise from north; tilt is downward. DORI columns give the estimated ground distance from the mount within which each pixel-density band holds.</p>
<div class="scroll"><table><thead><tr><th>ID</th><th>Name</th><th>Channel</th><th>East</th><th>North</th><th>Mount height</th><th>Bearing</th><th>Tilt</th><th>H × V FOV</th><th>Range</th><th>Resolution</th>${DORI_BANDS.map(b => `<th>${h(b.name)}<br><span class="muted">≥ ${b.ppm} px/m</span></th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr><td>${h(r.id)}</td><td>${h(r.name)}${r.enabled ? '' : '<br><span class="muted">excluded from estimates</span>'}</td><td>${h(r.channel) || '—'}</td><td>${h(r.east)}</td><td>${h(r.north)}</td><td>${h(r.height)}</td><td>${h(r.bearing)}</td><td>${h(r.tilt)}</td><td>${h(r.fov)}</td><td>${h(r.range)}</td><td>${h(r.resolution)}</td>${r.dori.map(v => `<td>${h(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
<h2>Interpretation limits</h2><ul>${INSTALLER_LIMITS.map(v => `<li>${h(v)}</li>`).join('')}</ul></html>`;
}
