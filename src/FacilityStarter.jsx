import { polygonArea } from "./facility.mjs";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { SHAPES, OSM_SERVERS, shapeFootprint, dimensions, searchBounds, parseOsmBuildings, fetchOsmBuildings, draftFacility, clearFootprintCache, polygonAreaSelection, parseAreaVertices } from "./facility-starter.mjs";
import { FOOTPRINT_SERVICES } from "./facility-services.mjs";
function Numeric({ label, value, onChange, min, max, step = "any" }) {
  return <label className="facility-field"><span>{label}</span><input type="number" aria-label={label} required value={value} min={min} max={max} step={step} onChange={(e) => onChange(
  e.target.value === "" ? "" : Number(e.target.value))} /></label>;
}
function MeasurementSummary({ ring, holes = [] }) {
  const m = dimensions(ring); m.area -= holes.reduce((sum,h)=>sum+polygonArea(h),0); const v = (n) => n.toFixed(1);
  return <p className="facility-caption">Approx. enclosing dimensions {v(m.length)} × {v(m.width)} m ({v(m.length / 0.3048)} × {v(
  m.width / 0.3048)} ft). Footprint {v(m.area)} m² / {v(m.area / 0.09290304)} ft². Perimeter {v(m.perimeter)} m. Dimensions follow the footprint’s orientation; verify on site.</p>;
}
function ShapeBuilder({ add, disabled }) {
  const [open, setOpen] = useState(false);
  const [shape, setShape] = useState("Rectangle"), [unit, setUnit] = useState("m"), [w, setW] = useState(32), [d, setD] = useState(
  40), [wing, setWing] = useState(8), [angle, setAngle] = useState(0), [x, setX] = useState(0), [y, setY] = useState(0),
  [height, setHeight] = useState(8), [floors, setFloors] = useState(1), [note, setNote] = useState("");
  const factor = unit === "ft" ? 0.3048 : 1;
  let ring, error;
  try {
    ring = shapeFootprint(shape, w, d, wing, angle, x, y);
  } catch (e) {
    error = e.message;
  }
  const distance = (label, value, setter, min, max) => <Numeric label={`${label} (${unit})`} value={value === "" ? "" : +(value /
  factor).toFixed(3)} min={min / factor} max={max / factor} onChange={(v) => setter(v === "" ? "" : v * factor)} />;
  return <details className="facility-starter" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}><summary>Common building shapes</summary><form onSubmit={(e) => {
    e.preventDefault();
    if (!ring || disabled) return;
    if (add({ name: `New ${shape.toLowerCase()} building`, footprint: ring, height, floors })) {
      setNote("Shape added. Edit and save its properties below.");
      setOpen(false);
    }
  }}>
    <label className="facility-field"><span>Building shape</span><select aria-label="Building shape" value={shape} onChange={(e) => setShape(
  e.target.value)}>{SHAPES.map((s) => <option key={s}>{s}</option>)}</select></label>
    <label className="facility-field"><span>Input units</span><select aria-label="Shape input units" value={unit} onChange={(e) => setUnit(
  e.target.value)}><option value="m">Meters</option><option value="ft">Feet</option></select></label>
    <div className="facility-field-pair">{distance("Shape width", w, setW, 2, 1e3)}{distance("Shape depth", d, setD, 2, 1e3)}</div>
    {["L wing", "T wing", "U wing", "Cross"].includes(shape) && distance("Wing thickness", wing, setWing, 1, 499)}
    <div className="facility-field-pair">{distance("Shape east", x, setX, -1800, 1800)}{distance("Shape north", y, setY,
  -1800, 1800)}</div>
    <Numeric label="Shape rotation (degrees)" value={angle} onChange={setAngle} min={-360} max={360} />
    <div className="facility-field-pair">{distance("Shape height", height, setHeight, 1, 150)}<Numeric label="Shape floors" value={floors} onChange={setFloors} min={1} max={40} step="1" /></div>
    {ring ? <MeasurementSummary ring={ring} /> : <p role="alert" className="facility-caption">{error}</p>}
    <button className="facility-primary" disabled={disabled || !ring}>Add selected shape</button>
    <p role="status" className="facility-caption">{note}</p>
    <p className="facility-caption">Starting example: 32 m span × five 8 m bays; 8 m height is editable. Shapes do not infer an existing structure. Round uses 32 segments. U wings have an open recess, not a closed courtyard.</p>
  </form></details>;
}
function ConstructionGuide() {
  return <details className="facility-starter"><summary>Measurement references</summary><p className="facility-caption">Map geometry or a survey sets existing dimensions. These references help review manually drawn spaces; they do not establish code compliance or reveal interior walls.</p>
    <ul className="facility-caption"><li>OSM rendering fallback: 3 m per tagged floor; a drawing estimate, not a ceiling-height requirement.</li><li>2024 IBC §1208.2: a general 7 ft 6 in (2.286 m) ceiling minimum for specified spaces, with exceptions. Clear ceiling height differs from total floor-to-floor and roof height.</li><li>ADA §403.5.1: generally 36 in (0.9144 m) continuous clear route width; passing and turning rules can require more.</li><li>ADA §404.2.3: generally 32 in (0.8128 m) clear door opening, with depth and maneuvering requirements. This is not nominal door-leaf width.</li><li>Illustrative industrial geometry: SCI describes portal spans of 25–40 m and frame spacings of 6–10 m. These are examples, not U.S. code requirements or default dimensions for an unknown facility.</li></ul>
    <p className="facility-caption">Applicable code edition, local amendments, occupancy and actual clearances must be checked for the site. No compliance result is calculated.</p>
    <p className="facility-caption"><a href="https://codes.iccsafe.org/s/IBC2024P1/chapter-12-interior-environment/IBC2024P1-Ch12-Sec1208.2" target="_blank" rel="noreferrer">IBC reference</a> · <a href="https://www.access-board.gov/ada/guides/chapter-4-accessible-routes/" target="_blank" rel="noreferrer">ADA routes</a> · <a href="https://www.access-board.gov/ada/guides/chapter-4-entrances-doors-and-gates/" target="_blank" rel="noreferrer">ADA doors</a> · <a href="https://steelconstruction.info/topics/cost-of-structural-steelwork/cost-planning-industrial-buildings" target="_blank" rel="noreferrer">SCI examples</a></p>
  </details>;
}
function OpenMapStarter({ plan, commit, onPreview, onArea, disabled, drawnArea, onDrawArea, onCancelArea, ready }) {
  const [open, setOpen] = useState(false), [east, setEast] = useState(0), [north, setNorth] = useState(0), [width, setWidth] = useState(
  250), [depth, setDepth] = useState(250), [result, setResult] = useState(null), [checked, setChecked] = useState([]), [
  busy, setBusy] = useState(false), [message, setMessage] = useState(""), [mode, setMode] = useState("append"), [paste, setPaste] = useState(
  "");
  const [areaMode,setAreaMode]=useState('rectangle'),[vertices,setVertices]=useState('-125,-125\n125,-125\n125,125\n-125,125');
  useEffect(()=>{if(drawnArea){setAreaMode('polygon');setVertices(drawnArea.slice(0,-1).map(p=>p.join(',')).join('\n'));}},[drawnArea]);
  const controller = useRef(), generation = useRef(0), lastQuery = useRef(0), callbacks = useRef();
  callbacks.current = { onPreview, onArea };
  const [endpoint,setEndpoint] = useState(OSM_SERVERS[0]);
  const fileGeneration = useRef(0);
  const selection = useMemo(() => {
    try {
      return areaMode==='polygon' ? polygonAreaSelection(plan.origin,parseAreaVertices(vertices)) : {bounds:searchBounds(plan.origin,east,north,width,depth),ring:null};
    } catch {
      return null;
    }
  }, [plan.origin, east, north, width, depth, areaMode, vertices]);
  const bounds=selection?.bounds || null;
  const priorOrigin = useRef(plan.origin.join(","));
  useEffect(()=>{const next=plan.origin.join(",");if(next!==priorOrigin.current){priorOrigin.current=next;setOpen(true);}},[plan.origin]);
  const chosen = useMemo(() => result?.buildings.filter((b) => checked.includes(b.id)) || [], [result, checked]);
  useEffect(() => {
    callbacks.current.onPreview(open ? chosen : [], mode === 'new');
  }, [chosen, open, mode]);
  useEffect(()=>{if(!open)onCancelArea();},[open]);
  useEffect(() => {
    callbacks.current.onArea(open ? selection : null);
  }, [selection, open]);
  useEffect(() => {
    generation.current++;
    fileGeneration.current++;
    controller.current?.abort();
    setBusy(false);
    setResult(null);
    setChecked([]);
    setMessage("");
  }, [plan, east, north, width, depth, endpoint, open, areaMode, vertices]);
  useEffect(() => () => {
    generation.current++;
    fileGeneration.current++;
    controller.current?.abort();
    callbacks.current.onPreview([]);
    callbacks.current.onArea(null);
  }, []);
  function accept(data) {
    const next = parseOsmBuildings(data, plan.origin, bounds, new Date().toISOString(), selection?.ring);
    const existing = new Set(plan.buildings.map((b) => b.id));
    const existingWays = new Set(plan.buildings.filter(b=>b.source?.id.startsWith('way/')).map(b=>b.source.id));
    next.buildings = next.buildings.filter((b) => mode === 'new' || (!existing.has(b.id) && !existingWays.has(b.source.id)));
    setResult(next);
    setChecked(next.buildings.map((b) => b.id));
    setMessage(next.buildings.length ? `${next.buildings.length} draft shells. Review before adding. ${next.skipped} uns\
upported features skipped.` : `No new supported footprints found. ${next.skipped} complex or invalid features skipped. T\
ry a smaller nearby area or draw a shape.`);
  }
  function reviewText(text) {
    generation.current++;
    fileGeneration.current++;
    controller.current?.abort();
    setResult(null); setChecked([]); setMessage('');
    try {
      if(new TextEncoder().encode(text).length>2e6)throw Error('Extract exceeds 2 MB.');
      accept(JSON.parse(text));
    } catch(e) {setMessage(e.message);}
  }
  async function load() {
    if (!bounds || disabled) return;
    if (Date.now() - lastQuery.current < 15e3) {
      setMessage("Wait 15 seconds between map requests.");
      return;
    }
    lastQuery.current = Date.now();
    const token = ++generation.current;
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    setResult(null);
    setChecked([]);
    setMessage("Loading open building footprints\u2026");
    const timer = setTimeout(() => c.abort(), 45e3);
    try {
      const data = await fetchOsmBuildings(bounds, c.signal, fetch, endpoint);
      if (token === generation.current) accept(data);
    } catch (e) {
      if (token === generation.current) setMessage(e.name === "TimeoutError" ? "Map service timed out. Try a smaller area, choose a different provider, or open an offline file." : c.signal.aborted ? "Request timed out or was cancelled. You can retry\
 or import an extract." : e.name === "TypeError" ? "Could not reach the map service. Open an offline file, or try another provider later." : e.message);
    } finally {
      clearTimeout(timer);
      if (token === generation.current) setBusy(false);
    }
  }
  return <details className="facility-starter" open={open} onToggle={(e) => {
    if (e.target === e.currentTarget) setOpen(e.currentTarget.open);
  }}><summary>Draft buildings from OpenStreetMap</summary>
    <ol className="facility-starter-progress" aria-label="Building draft steps"><li>1. Save location</li><li>2. Confirm area</li><li>3. Review outlines</li><li>4. Apply selected</li></ol>
    <p className="facility-caption">First save your address, GPS suggestion or coordinates above. This area is relative to the saved origin: {plan.
  origin[1]}, {plan.origin[0]}. Adjust its dimensions and offsets to select the area outlined on the map.</p>
    <label className="facility-field"><span>Area shape</span><select aria-label="Area shape" value={areaMode} onChange={e=>{onCancelArea();setAreaMode(e.target.value);}}><option value="rectangle">Rectangle</option><option value="polygon">Custom polygon</option></select></label>
    <button className="facility-secondary" disabled={!ready || disabled} onClick={()=>{setOpen(true);onDrawArea();}}>Draw search area</button>
    {areaMode==='polygon' && <label className="facility-field"><span>Area vertices (east,north meters; one per line)</span><textarea aria-label="Area vertices" rows={6} maxLength={5000} value={vertices} onChange={e=>setVertices(e.target.value)}/><small>Edit, add or remove corners here with the keyboard. The closing point is added automatically. Whole intersecting buildings are retained.</small></label>}
    <div className="facility-field-pair"><Numeric label="Search width (m)" value={width} onChange={setWidth} min={20} max={500} /><Numeric label="Search depth (m)" value={depth} onChange={setDepth} min={20} max={500} /></div>
    <div className="facility-field-pair"><Numeric label="Search east (m)" value={east} onChange={setEast} min={-1700} max={1700} /><Numeric label="Search north (m)" value={north} onChange={setNorth} min={-1700} max={1700} /></div>
    <label className="facility-field"><span>Building source</span><select aria-label="Building source" value={endpoint} onChange={e=>setEndpoint(e.target.value)}>{FOOTPRINT_SERVICES.map(s=><option key={s.url} value={s.url}>{s.label}</option>)}</select></label>
    <p className="facility-caption">Load sends only this area's coordinates to {endpoint.startsWith('/') ? `this site’s ${endpoint} service (operator must configure it)` : new URL(endpoint).hostname}. It does not send cameras, rooms or recordings. Public service availability varies; import an extract if unavailable. Requests are limited to 500 × 500 m, 300 features and 2 MB. No subscription or API key.</p>
    <p className="facility-caption"><a href={endpoint.includes("overpass-api.de") ? "https://dev.overpass-api.de/overpass-doc/en/preface/commons.html" : "https://overpass.private.coffee/"} target="_blank" rel="noreferrer">Map service terms and privacy</a> · Used for draft planning only. Verify all geometry before operational use.</p>
    <button className="facility-primary" disabled={busy || disabled || !bounds} onClick={load}>Load open building drafts</button>
    {busy && <button className="facility-secondary" onClick={() => {
    generation.current++;
    fileGeneration.current++;
    controller.current?.abort();
    setBusy(false);
    setMessage("Request cancelled.");
  }}>Cancel map request</button>}
    {!bounds && <p className="facility-caption" role="alert">Use a simple closed area with bounds 20–500 m per side within 1,800 m of the saved origin; at most 50 corners. Courtyard or crossing outlines must be valid.</p>}
    <p role="status" className="facility-caption">{message}</p>
    {result && <><details><summary>Why some features were skipped</summary><ul className="facility-caption">{Object.entries(result.reasons).map(([reason,count])=><li key={reason}>{count}: {reason}</li>)}</ul></details><div className="facility-import-list">{result.buildings.map((b) => <label className="facility-draft-choice" key={b.
  id}><input type="checkbox" aria-label={`Include ${b.name}`} checked={checked.includes(b.id)} onChange={(e) => setChecked((ids) => e.target.checked ? [...ids,
  b.id] : ids.filter((id) => id !== b.id))} /><span><strong>{b.name}</strong><MeasurementSummary ring={b.footprint} holes={b.holes} /><small>Height: {b.
  height} m above ground; base {b.base || 0} m; {b.holes?.length || 0} courtyards. {b.part ? "Independent part. " : ""} — {b.source.heightBasis}. Floors: {b.floors} — {b.source.floorsBasis}. {b.crossing ? "Crosses area bound\
ary; the whole footprint will be kept." : ""} Source: {b.source.id}. Updated: {b.source.updated}. Imported: {b.source.retrieved}.</small></span></label>)}</div>
      <label className="facility-field"><span>Apply drafts</span><select aria-label="Apply building drafts" value={mode} onChange={(e) => setMode(
  e.target.value)}><option value="append">Add to existing plan</option><option value="new">Replace with a clean site</option></select></label>
      {mode === "new" && <p className="facility-caption">Replaces all existing buildings, cameras, rooms, labels and route. Undo restores the prior plan.</p>}
      {chosen.length + (mode === 'append' ? plan.buildings.length : 0) > 100 && <p className="facility-caption" role="alert">The selection exceeds the 100-building limit. Reduce it or choose a clean replacement site.</p>}
      <button className="facility-primary" disabled={disabled || !chosen.length || chosen.length + (mode === "append" ? plan.
  buildings.length : 0) > 100} onClick={() => {
    try {
    if (commit(draftFacility(plan, chosen, mode === 'new'), "Reviewed map buil\
dings added \u2014 Undo available")) {
      setResult(null);
      setChecked([]);
    }
    } catch(e) { setMessage(e.message); }
  }}>Use {chosen.length} selected buildings</button></>}
    <details><summary>Open an offline OSM file or paste JSON</summary><p className="facility-caption">Open or paste Overpass JSON with complete way/member geometry. Maximum 2 MB. Uses the same area origin and review checks. No network request. Save or export your source extract separately; the plan retains source IDs and dates.</p>
      <label className="facility-field"><span>Offline OSM file</span><input aria-label="Offline OSM file" type="file" accept=".json,application/json" disabled={!bounds || busy || disabled} onChange={async e=>{
        const f=e.target.files?.[0]; e.target.value=''; if(!f)return;
        const token=++fileGeneration.current;setResult(null);setChecked([]);
        try { if(f.size>2e6)throw Error('Extract exceeds 2 MB.'); const text=await f.text(); if(token!==fileGeneration.current)return; reviewText(text); }
        catch(e){if(token===fileGeneration.current)setMessage(e.message);}
      }} /></label><textarea aria-label="OSM extract JSON" rows={5} maxLength={2e6} value={paste} onChange={(e) => setPaste(
  e.target.value)} /><button className="facility-secondary" disabled={!bounds || busy || disabled} onClick={() => {
    reviewText(paste);
  }}>Review extract</button></details>
    <p className="facility-caption">Complete outer-only relations can be assembled or split into separate shells. Courtyards remain open and raised bases are retained. Independent, non-overlapping building parts are supported. Overlapping parts/envelopes and invalid or nested rings are excluded with reasons. Heights/floors may be placeholders. No interiors are inferred.</p>
    <button type="button" className="facility-link" onClick={()=>{clearFootprintCache();setMessage("Session footprint cache cleared.");}}>Clear session map cache</button>
    <p className="facility-caption">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors · ODbL</a>. Source and license are retained in plan exports. Review ODbL obligations before distributing a derived database.</p>
  </details>;
}
export {
  ConstructionGuide,
  MeasurementSummary,
  OpenMapStarter,
  ShapeBuilder
};
