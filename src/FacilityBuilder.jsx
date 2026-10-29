import { buildingArea } from "./facility.mjs";
import React, { useEffect, useMemo, useRef, useState, useContext } from "react";
import {
  MapPin,
  Buildings,
  Stack,
  VideoCamera,
  Path,
  CaretRight,
  CaretLeft,
  Check,
  Plus,
  ArrowCounterClockwise,
  DownloadSimple,
  UploadSimple,
  Crosshair,
  Polygon,
  Trash,
  Play,
  Pause,
  MagnifyingGlass,
  WarningCircle,
  X
} from "@phosphor-icons/react";
import "maplibre-gl/dist/maplibre-gl.css";
import "./facility.css";
import {
  STEPS,
  LIMITS,
  exampleFacility,
  blankFacility,
  validateFacility,
  parseFacility,
  uid,
  centroid,
  rehearse,
  routePoint,
  seesPoint,
  wallObstacles,
  polygonArea
} from "./facility.mjs";
import { createFacilityMap } from "./facility-map.mjs";
import { OpenMapStarter, ShapeBuilder, MeasurementSummary, ConstructionGuide } from './FacilityStarter.jsx';
import { draftFacility } from './facility-starter.mjs';
import { AddressSearch } from "./AddressSearch.jsx";
import LineDimensions from './LineDimensions.jsx';
import ShapeDimensions from './ShapeDimensions.jsx';
import FloorGeometry from './FloorGeometry.jsx';
import FacilityStairs from './FacilityStairs.jsx';
import {unitFactor, displayLength, unitLabel} from './facility-shape-edit.mjs';
import {formatDistance,formatArea} from './facility-measurements.mjs';
import {createFloorOpening,createFloorPath} from './facility.mjs';
import FacilityLevels from './FacilityLevels.jsx';
import FacilityZones from './FacilityZones.jsx';
import { createFacilityZone } from './facility-zones.mjs';
import FacilityCameraPreview from './FacilityCameraPreview.jsx';
const MeasurementUnits = React.createContext("metric");
const STORAGE = "dvr.facility.v1";
const keyOf = { building: "buildings", camera: "cameras", room: "rooms", label: "labels", zone: "zones", opening: "openings", stair: "stairs", path: "paths" };
const round = (n) => Math.round(n * 100) / 100;
function download(data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "dvr-facility.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1e3);
}
function Field({ name, label, value, onChange, min, max, step = "any", type = "number", suffix }) {
  const units=useContext(MeasurementUnits), length=suffix==='m',factor=length?unitFactor(units):1;
  return <label className="facility-field"><span>{label}{suffix && <small>{length?unitLabel(units):suffix}</small>}</span><input name={name} aria-label={label} type={type} value={(length?displayLength(value,units):value) ?? ''} required min={min===undefined?undefined:min/factor} max={max===undefined?undefined:max/factor} step={type === 'number' ? step : undefined} maxLength={type === 'text' ? 100 : undefined} onChange={e=>onChange(type === 'number' ? e.target.value === '' ? '' : Number(e.target.value)*factor : e.target.value)}/></label>;
}
function FacilityBuilder({onPreviewCount}) {
  const initial = useRef();
  if (!initial.current) {
    try {
      const raw = localStorage.getItem(STORAGE);
      initial.current = { plan: raw ? parseFacility(raw) : exampleFacility(), status: raw ? "Saved in this browser" : "U\
nsaved sample", error: "" };
    } catch {
      initial.current = { plan: exampleFacility(), status: "Saved data needs review", error: "The saved facility could n\
ot be read. The sample is open; export it or make a deliberate edit to replace saved data." };
    }
  }
  const [zoneDirty, setZoneDirty] = useState(false), [stairDirty,setStairDirty]=useState(false);
  const [measurements, setMeasurements] = useState(true), [units, setUnits] = useState(()=>{try{return localStorage.getItem("dvr.facility.units")==="imperial"?"imperial":"metric";}catch{return "metric";}}), [mapBearing, setMapBearing] = useState(-27);
  const [pickedOrigin,setPickedOrigin]=useState(null), [drawnArea,setDrawnArea]=useState(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [mapDrafts, setMapDrafts] = useState([]), [searchArea, setSearchArea] = useState(null);
  const [replaceDrafts, setReplaceDrafts] = useState(false);
  const [draftPreviewError, setDraftPreviewError] = useState('');
  const [plan, setPlan] = useState(initial.current.plan), [step, setStep] = useState(0), [selected, setSelected] = useState(
    { kind: "camera", id: "C-07" }
  ), [draft, setDraft] = useState(null), [view, setView] = useState("3d"), [floor, setFloor] = useState(
    0
  ), [floorBuilding, setFloorBuilding] = useState("b2"), [tool, setTool] = useState("select"), [error, setError] = useState(
    initial.current.error
  ), [status, setStatus] = useState(initial.current.status), [ready, setReady] = useState(false), [
    mapError,
    setMapError
  ] = useState(""), [streets, setStreets] = useState(false), [search, setSearch] = useState(""), [
    page,
    setPage
  ] = useState(0), [history, setHistory] = useState([]), [playing, setPlaying] = useState(false), [seconds, setSeconds] = useState(
    0
  ), [decisions, setDecisions] = useState({});
  useEffect(()=>{try{localStorage.setItem("dvr.facility.units",units);}catch{}},[units]);
  const mapEl = useRef(), api = useRef(), input = useRef(), latest = useRef();
  const selectedItem = plan[keyOf[selected.kind]]?.find((x) => x.id === selected.id);
  const propertyDirty = !['zone','stair'].includes(selected.kind) && !!(draft && selectedItem && draft.id === selectedItem.id && JSON.stringify(draft) !== JSON.stringify(selectedItem));
  const dirty = propertyDirty || zoneDirty || stairDirty;
  useEffect(() => setDraft(selectedItem ? structuredClone(selectedItem) : null), [selectedItem]);
  useEffect(()=>{if(selectedItem && ['opening','path','stair'].includes(selected.kind)){setFloorBuilding(selectedItem.buildingId);setFloor(selectedItem.level ?? selectedItem.fromLevel);setView('floors');}},[selected.kind,selected.id,selectedItem?.id]);
  const b = plan.buildings.find((x) => x.id === floorBuilding) || plan.buildings[0];
  useEffect(() => { if (b) setFloor(f => Math.min(f, b.floors - 1)); else setFloor(0); }, [b?.id, b?.floors]);
  const rehearsal = useMemo(() => plan.route.length > 1 ? rehearse(plan) : [], [plan]);
  const position = plan.route.length > 1 ? routePoint(plan.route, seconds / 30) : null;
  const visibleAtPosition = useMemo(() => position ? plan.cameras.filter((c) => seesPoint(c, position, wallObstacles(plan))).
  map((c) => c.id) : [], [plan, seconds]);
  const proposals = useMemo(() => {
    const out = [];
    let last = null;
    for (const s of rehearsal) {
      const id = s.cameras.includes(last) ? last : s.cameras[0];
      if (id && last && id !== last) out.push({ from: last, to: id, seconds: s.seconds, key: last + ">" + id + "@" + s.seconds });
      if (id) last = id;
    }
    return out.slice(0, 20);
  }, [rehearsal]);
  useEffect(() => {
    setDecisions({});
    setPlaying(false);
    setSeconds(0);
  }, [plan]);
  useEffect(() => {
    if (!playing) return;
    let prior = performance.now();
    const timer = setInterval(() => {
      const now = performance.now(), elapsed = (now - prior) / 1e3;
      prior = now;
      setSeconds((s) => {
        if (s + elapsed >= 30) {
          setPlaying(false);
          return 30;
        }
        return s + elapsed;
      });
    }, 100);
    return () => clearInterval(timer);
  }, [playing]);
  function commit(next, message) {
    try {
      const clean = validateFacility(next);
      setHistory((h) => [...h.slice(-19), plan]);
      setPlan(clean);
      setError("");
      try {
        localStorage.setItem(STORAGE, JSON.stringify(clean));
        setStatus(message || "Saved in this browser");
      } catch {
        setStatus("Not saved \u2014 export a copy");
        setError("Browser storage is unavailable or full. Your current edits are in memory; export a copy before closing\
.");
      }
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  }
  function select(id, kind) {
    if (dirty) {
      setError("Save or discard your preview before selecting another item.");
      return false;
    }
    setSelected({ id, kind });
    if(["opening","path","stair"].includes(kind)){const item=plan[keyOf[kind]]?.find(x=>x.id===id);if(item){setFloorBuilding(item.buildingId);setFloor(item.level ?? item.fromLevel);setView("floors");}}
    if(kind === 'building' && id !== floorBuilding) {setFloorBuilding(id);setFloor(0);}
    setError("");
    return true;
  }
  function selectZone(id) {
    if(!select(id,'zone')) return;
    const zone=(plan.zones || []).find(z=>z.id===id);
    if(zone?.buildingId) {setFloorBuilding(zone.buildingId);setFloor(zone.level);setView('floors');}
    else setView('2d');
    api.current?.centerSelection(id);
  }
  function selectOnMap(id,kind) {
    if (kind === 'zone') {if(!dirty){setStep(6);selectZone(id);}else setError('Save or discard your preview before selecting another item.');return;}
    if(!select(id,kind)) return;
    if(kind==='building') setStep(1);
    if(kind==='camera') setStep(3);
    if(['opening','path','stair'].includes(kind)) {const item=plan[keyOf[kind]]?.find(x=>x.id===id);if(item){setFloorBuilding(item.buildingId);setFloor(item.level ?? item.fromLevel);setView('floors');}setStep(2);}
    if(kind==='room') { const room=plan.rooms.find(r=>r.id===id); if(room){setFloorBuilding(room.buildingId);setFloor(room.level);setView('floors');}setStep(2);}
  }
  function onDraw(kind, ring) {
    if(kind==='search-area') {setDrawnArea(ring.map(p=>p.map(round)));return;}

    if (dirty) { setError("Save or discard your preview before drawing."); return; }
    if (kind === 'opening' || kind === 'floor-path') {
      if(!b) {setError('Choose a building and floor first.');return;}
      try {
        const item=kind==='opening' ? createFloorOpening(plan,b.id,floor,ring.map(p=>p.map(round))) : createFloorPath(plan,b.id,floor,ring.map(p=>p.map(round)));
        const key=kind==='opening'?'openings':'paths',selection=kind==='opening'?'opening':'path';
        if(commit({...plan,[key]:[...(plan[key] || []),item]},kind==='opening'?'Floor opening saved; ceiling below updated':'Floor path saved')) {select(item.id,selection);setView('floors');}
      } catch(e) {setError(e.message);}
      return;
    }
    if (kind === "zone") {
      try {
        const item = createFacilityZone(ring.map(p => p.map(round)));
        if (commit({...plan, zones:[...(plan.zones || []), item]}, "Zone saved — configure its rule")) select(item.id, "zone");
      } catch (e) { setError(e.message); }
      return;
    }
    if (kind === "route") {
      commit({ ...plan, route: ring }, "Route saved");
      return;
    }
    if (kind === "building") {
      const item = { id: uid("b"), name: "New building", footprint: ring.map((p) => p.map(round)), height: 8, floors: 2 };
      if (commit({ ...plan, buildings: [...plan.buildings, item] }, "Building saved")) select(item.id, "building");
    }
    if (kind === "room" && b) {
      const item = {
        id: uid("r"),
        name: "New room",
        footprint: ring.map((p) => p.map(round)),
        buildingId: b.id,
        level: floor,
        wallHeight: 2.8
      };
      if (commit({ ...plan, rooms: [...plan.rooms, item] }, "Room saved")) select(item.id, "room");
    }
  }
  function place(kind, p) {
    if (dirty) {
      setError("Save or discard your preview before adding another item.");
      return;
    }
    const item = kind === "camera" ? {
      id: uid("C"),
      name: "New camera",
      x: round(p[0]),
      y: round(p[1]),
      z: 4,
      bearing: 180,
      tilt: 25,
      hfov: 86,
      vfov: 52,
      range: 40,
      enabled: true
    } : { id: uid("l"), name: "New label", x: round(p[0]), y: round(
      p[1]
    ), z: 0 };
    if (commit({ ...plan, [keyOf[kind]]: [...plan[keyOf[kind]], item] }, kind === "camera" ? "Camera placed \u2014 adjust its\
 view" : "Label placed")) select(item.id, kind);
  }
  function aimCamera(p) {
    if (selected.kind !== 'camera' || !draft) return;
    const dx = p[0] - draft.x, dy = p[1] - draft.y;
    if (Math.hypot(dx,dy) < .05) { setError('Choose a point away from the camera to aim its view.'); return; }
    setDraft(d => ({...d, bearing: Math.min(359.99, round((Math.atan2(dx,dy)*180/Math.PI+360)%360))}));
    setError('');
  }
  function moveCamera(p) {
    if (selected.kind === 'camera' && draft) setDraft(d => ({...d,x:round(p[0]),y:round(p[1])}));
  }
  latest.current = { onBearing:setMapBearing, onAim:aimCamera, onMoveCamera:moveCamera, onPin: p=>setPickedOrigin(p), onDraw, onPlace: place, onSelect: selectOnMap, onToolDone: () => {
    setTool("select");
  }, onReady: () => setReady(true), onError: setMapError };
  useEffect(() => {
    try {
      api.current = createFacilityMap(mapEl.current, Object.fromEntries(["onBearing", "onAim", "onMoveCamera", "onPin", "onDraw", "onPlace", "onSelect", "onToolDone", "onReady", "onError"].map((k) => [k, (...args) => latest.current[k](...args)])), plan);
    } catch (e) {
      setMapError("3D graphics are unavailable here. You can still edit numeric properties and export the plan. " + e.message);
    }
    const observer = new ResizeObserver(() => api.current?.resize());
    observer.observe(mapEl.current);
    return () => {
      observer.disconnect();
      api.current?.destroy();
      api.current = null;
    };
  }, []);
  const preview = useMemo(() => {
    if (!draft || !keyOf[selected.kind] || ['zone','stair'].includes(selected.kind)) return plan;
    try {
      return validateFacility({ ...plan, [keyOf[selected.kind]]: plan[keyOf[selected.kind]].map((c) => c.id === selected.id ? draft : c) });
    } catch {
      return plan;
    }
  }, [plan, draft, selected]);
  useEffect(() => {
    let displayed = preview;
    let failure = '';
    if (mapDrafts.length) {
      try { displayed = draftFacility(preview, mapDrafts, replaceDrafts); } catch(e) { failure = e.message; }
    }
    setDraftPreviewError(failure);
    api.current?.update(displayed, selected.id, view, floor, {measurements, units, floorBuildingId:b?.id});
  }, [preview, mapDrafts, replaceDrafts, selected.id, view, floor, ready, measurements, units, b?.id]);
  useEffect(() => api.current?.setArea(searchArea), [searchArea, ready]);
  useEffect(() => api.current?.setTrack(step === 5 ? position : null), [step, seconds, plan, ready]);
  useEffect(() => {
    const stop = (e) => {
      if (e.key === "Escape") {
        api.current?.setTool("select");
        setTool("select");
      }
    };
    document.addEventListener("keydown", stop);
    return () => document.removeEventListener("keydown", stop);
  }, []);
  function go(n) {
    if (dirty) {
      setError("Save or discard your preview before changing steps.");
      return;
    }
    setStep(n);
    setError("");
    setTool("select");
    api.current?.setTool("select");
    setPlaying(false);
    if (n === 1 && plan.buildings[0]) select(plan.buildings[0].id, "building");
    if (n === 2) {
      setView("floors");
      if (b) select(b.id, "building");
    }
    if (n === 3 || n === 4) {
      setView("3d");
      if (plan.cameras[0]) select(plan.cameras[0].id, "camera");
    }
    if (n === 5) setView("3d");
    if (n === 6) { setView("2d"); setSelected({kind:'zone',id:plan.zones?.[0]?.id || ''}); }
  }
  function startTool(kind) {
    if (dirty && !["aim-camera", "move-camera"].includes(kind)) {
      setError("Save or discard your preview before drawing.");
      return;
    }
    setError("");
    if (["room","opening","floor-path"].includes(kind) && !b) {
      setError("Add a building before drawing floor geometry.");
      return;
    }
    if (kind === "building" && plan.buildings.length >= LIMITS.buildings || kind === "camera" && plan.cameras.length >= LIMITS.
    cameras) {
      setError("This plan has reached its item limit.");
      return;
    }
    setTool(kind);
    if (["building", "route", "zone", "search-area", "site-pin", "camera", "aim-camera", "move-camera"].includes(kind)) setView("2d");
    if (["room","opening","floor-path"].includes(kind)) setView("floors");
    api.current?.setTool(kind);
  }
  function saveSelected(e) {
    e.preventDefault();
    if (!draft) return;
    if (commit(
      { ...plan, [keyOf[selected.kind]]: plan[keyOf[selected.kind]].map((x) => x.id === selected.id ? draft : x) },
      "Changes saved"
    )) setDraft(structuredClone(draft));
  }
  function removeSelected() {
    if (!selectedItem) return;
    const next = { ...plan, [keyOf[selected.kind]]: plan[keyOf[selected.kind]].filter((x) => x.id !== selected.id) };
    if (selected.kind === "camera") next.zones = (plan.zones || []).map(z => { if(z.imageRegion?.cameraId !== selected.id) return z; const copy={...z}; delete copy.imageRegion; return copy; });
    if (selected.kind === "building") {
      next.rooms = plan.rooms.filter((r) => r.buildingId !== selected.id);
      next.zones = (plan.zones || []).filter(z => z.buildingId !== selected.id);
      next.openings=(plan.openings || []).filter(o=>o.buildingId!==selected.id);
      next.stairs=(plan.stairs || []).filter(o=>o.buildingId!==selected.id);
      next.paths=(plan.paths || []).filter(o=>o.buildingId!==selected.id);
    }
    if (commit(next, "Removed \u2014 Undo is available")) {
      setSelected({ kind: "camera", id: "" });
      setDraft(null);
    }
  }
  function undo() {
    if (dirty) {setError("Save or discard your preview before undoing.");return;}
    const prev = history.at(-1);
    if (!prev) return;
    setPlan(prev);
    setHistory((h) => h.slice(0, -1));
    setError("");
    try {
      localStorage.setItem(STORAGE, JSON.stringify(prev));
      setStatus("Previous edit restored");
    } catch {
      setError("Restored in memory. Export a copy; browser storage is unavailable.");
    }
  }
  function addRectangle() {
    if (dirty) {
      setError("Save or discard your preview before adding a building.");
      return;
    }
    const item = { id: uid("b"), name: "New building", height: 8, floors: 2, footprint: [
      [-20, -20],
      [20, -20],
      [20, 0],
      [-20, 0],
      [-20, -20]
    ] };
    if (commit({ ...plan, buildings: [...plan.buildings, item] }, "Rectangle added")) select(item.id, "building");
  }
  async function importFile(e) {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      if (f.size > LIMITS.bytes) throw Error("Facility files must be smaller than 2 MB.");
      commit(parseFacility(await f.text()), "Imported and saved in this browser");
      setSelected({ kind: "camera", id: "" });
    } catch (x) {
      setError(x.message);
    }
  }
  const cameras = plan.cameras.filter((c) => (c.name + " " + c.id).toLowerCase().includes(search.toLowerCase()));
  useEffect(() => setPage((p) => Math.min(p, Math.max(0, Math.ceil(cameras.length / 6) - 1))), [cameras.length]);
  const toolText = { opening:"Trace the open area on this floor. The same opening becomes the ceiling void below.", "floor-path":"Click a route through solid floor. Double-click to finish; openings cannot be crossed.", "aim-camera":"Click the point you want this camera to face, then Save camera.", "move-camera":"Click the new mounting position, then Save camera.", zone:"Trace the zone boundary. Click its first corner to finish.", "site-pin":"Click the map to suggest a site location, then review and Save site.", "search-area":"Click the area corners, then its first corner to finish. Review or edit the vertices before loading.", building: "Click each corner, then click the first corner to finish.", room: "Trace a room inside t\
he selected building. Click its first corner to finish.", route: "Click route points. Double-click the last point to fin\
ish.", camera: "Click the map to place a camera. Adjust its height and view next.", label: "Click the map to position a \
label." };
  const change = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  const note = <p className="facility-estimate"><WarningCircle size={17} /><span>Estimated ground visibility · verify on site. Opaque walls only; excludes floor slabs, openings, furniture and lens effects.</span></p>;
  return <MeasurementUnits.Provider value={units}><section className="facility-workspace" aria-label="Guided facility builder">
    <aside className="facility-guide">
      <p className="eyebrow">FACILITY WORKSPACE</p><h1>Design your coverage</h1><p className="facility-intro">Measure the space. Build each level.<br />Place, aim and review your cameras.</p>
      <ol className="facility-steps">{STEPS.map(([title, desc], i) => <li key={title}><button aria-current={step === i ?
  "step" : void 0} onClick={() => go(i)}><span className="facility-step-number">{i + 1}</span><span><strong>{title}</strong><small>{desc}</small></span></button></li>)}</ol>
      <div className="facility-inventory"><h2>{step === 1 ? "Buildings" : "Camera inventory"} <small>{step === 1 ? plan.
  buildings.length : plan.cameras.length}</small></h2>
        {step === 1 ? <div className="facility-item-list">{plan.buildings.map((o) => <button className={selected.id === o.
  id ? "selected" : ""} key={o.id} onClick={() => {select(o.id, "building"); api.current?.centerSelection(o.id);}}><Buildings size={17} /><span>{o.name}<small>{formatDistance(o.height,units)} · {o.floors} floors</small></span></button>)}</div> : <>
          <label className="facility-search"><MagnifyingGlass size={16} /><input aria-label="Find a camera" placeholder="Find a camera…" value={search} onChange={(e) => {
    setSearch(e.target.value);
    setPage(0);
  }} /></label>
          <div className="facility-item-list">{cameras.slice(page * 6, page * 6 + 6).map((c) => <button key={c.id} className={selected.
  id === c.id ? "selected" : ""} onClick={() => {
    if(select(c.id, "camera")) setStep(3);
  }}><VideoCamera size={17} /><span>{c.name}<small>{c.id}{!c.enabled ? " \xB7 excluded" : ""}</small></span></button>)}{!cameras.
  length && <p>No cameras match.</p>}</div>
          {cameras.length > 6 && <div className="facility-pagination"><button aria-label="Previous cameras" disabled={!page} onClick={() => setPage(
    (p) => p - 1
  )}><CaretLeft /></button><span>{page + 1} / {Math.ceil(cameras.length / 6)}</span><button aria-label="Next cameras" disabled={(page +
  1) * 6 >= cameras.length} onClick={() => setPage((p) => p + 1)}><CaretRight /></button></div>}
        </>}
      </div>
      <div className="facility-file-actions"><button disabled={dirty} onClick={() => download(plan)}><DownloadSimple />Export plan</button><button disabled={dirty} onClick={() => input.
  current.click()}><UploadSimple />Import plan</button><button disabled={dirty} onClick={() => setPasteOpen(true)}><UploadSimple />Paste JSON</button><button onClick={undo} disabled={!history.length || dirty}><ArrowCounterClockwise />Undo edit</button></div>
      <p className="facility-save-state" role="status">{status}</p>
    </aside>
    <div className="facility-stage">
      <div className="facility-map" ref={mapEl} aria-label="Facility map. Use arrow keys to pan; use numeric fields to place items without drawing." />
      <div className="facility-view-controls" aria-label="Map view">{[["2d", "2D"], ["3d", "3D"], ["floors", "Floors"]].
  map(([id, title]) => <button key={id} aria-pressed={view === id} onClick={() => setView(id)}>{title}</button>)}<button className="facility-fit" title="Center facility" aria-label="Center facility" onClick={() => api.
  current?.center()}><Crosshair size={18} /></button><button title="Reset map view" aria-label="Reset map view" onClick={() => api.current?.reset()}><ArrowCounterClockwise size={18}/></button></div>
      <div className="facility-map-tools">
        <button className="facility-compass" aria-label="Point map north" title="Point map north" onClick={() => api.current?.north()}><span style={{transform:`rotate(${-mapBearing}deg)`}}>↑</span><b>N</b><small>{Math.round((mapBearing+360)%360)}°</small></button>
        <label><input type="checkbox" checked={measurements} onChange={e=>setMeasurements(e.target.checked)}/>Dimensions</label>
        <select aria-label="Measurement units" value={units} onChange={e=>setUnits(e.target.value)}><option value="metric">Meters · m / m²</option><option value="imperial">Feet · ft / ft²</option></select>
      </div>
      <div className="facility-map-context"><span className="facility-local-dot" />{plan.name}<small>{streets ? "Online \
street map \xB7 OpenStreetMap" : `Local grid · ${formatDistance(20,units)} spacing · no external tiles`}</small></div>
      {!!mapDrafts.length && <div className="facility-draft-banner" role="status">{draftPreviewError ? `Draft preview unavailable: ${draftPreviewError}` : `Preview: ${mapDrafts.length} building drafts · review before saving`}</div>}
      {mapError && <div className="facility-map-error" role="alert"><WarningCircle /><span>{mapError}</span><button aria-label="Dismiss graphics message" onClick={() => setMapError(
    ""
  )}><X /></button></div>}
      {tool !== "select" && <div className="facility-draw-hint" role="status"><Polygon /><span>{toolText[tool]}<small>Escape cancels drawing.</small></span><button onClick={() => {
    api.current?.setTool("select");
    setTool("select");
  }}>Cancel</button></div>}
      {(step === 2 || view === "floors") && <div className="facility-floor-picker"><Stack size={18} /><select aria-label="Building for floor editing" value={b?.
  id || ""} onChange={(e) => {
    if(dirty) {setError("Save or discard your preview before changing floors.");return;}
    setFloorBuilding(e.target.value);
    setFloor(0);
    select(e.target.value, "building");
  }}>{plan.buildings.map((b2) => <option value={b2.id} key={b2.id}>{b2.name}</option>)}</select><select aria-label="Active floor" value={floor} onChange={(e) => {
    if(dirty) {setError("Save or discard your preview before changing floors.");return;}
    setFloor(+e.target.value);
    setView("floors");
  }}>{Array.from({ length: b?.floors || 1 }, (_, i) => <option key={i} value={i}>{i === 0 ? b?.base ? `Lowest modeled floor (${formatDistance(b.base,units)})` : "Ground floor" : "Level " + (i +
  1)}</option>)}</select><button className="facility-secondary" aria-label="Center active building" onClick={()=>b&&api.current?.centerSelection(b.id)}><Crosshair size={17}/></button></div>}
      <div className="facility-map-legend"><span><i className="coverage-key" />Estimated visibility</span><span><i className="route-key" />Route / object watch</span><span><i className="restricted-key" />Restricted</span><span>Only the selected camera’s 3D volume is shown.</span></div>
      {step === 5 && <div className="facility-rehearsal"><div className="facility-rehearsal-top"><button aria-label={playing ?
  "Pause rehearsal" : "Play rehearsal"} disabled={plan.route.length < 2} onClick={() => {
    if (seconds >= 30) setSeconds(0);
    setPlaying((v) => !v);
  }}>{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</button><span>{seconds.toFixed(1)} / 30 s</span><input aria-label="Rehearsal time" type="range" min="0" max="30" step=".1" value={seconds} onChange={(e) => {
    setPlaying(false);
    setSeconds(+e.target.value);
  }} /></div><p><strong>Simulated Track P-014</strong><span>{visibleAtPosition.length ? "In estimated view: " + visibleAtPosition.
  join(", ") : "Blind spot \xB7 no camera observation"}</span></p><small>A planned route, not measured movement or a person identity.</small></div>}
    </div>
    <aside className="facility-properties">
      <header><p className="eyebrow">STEP {step + 1} OF {STEPS.length}</p><h2>{["Locate your facility", "Shape a building", "Define f\
loors & labels", "Aim this camera", "Check estimated coverage", "Test camera handoffs", "Zones & object rules"][step]}</h2><p>{["Set a geographi\
c origin; the sample layout uses local meters.", "Trace a footprint or choose a common shape, then set its dimensions.", "Add \
rooms, stairs, openings and pathways on each level.", "Adjust the camera\u2019s position and viewing volume.", "Select a camera to ins\
pect its modeled view.", "Draw a route and review proposed camera transitions.", "Mark restricted areas and define expected objects for review."][step]}</p></header>
      <div className="facility-property-body">
      {step === 0 && <label className="facility-checkbox basemap-choice"><input type="checkbox" checked={streets} disabled={!ready} onChange={(e) => {
    setStreets(e.target.checked);
    api.current?.setBasemap(e.target.checked);
  }} />Online street map<small>Sends the visible map area to OpenStreetMap. No offline tile download.</small></label>}
      {step === 0 && <SiteForm pickedOrigin={pickedOrigin} onPin={()=>startTool("site-pin")} ready={ready} plan={plan} commit={commit} center={() => api.current?.center()} />}
      {step === 0 && <OpenMapStarter drawnArea={drawnArea} onDrawArea={()=>startTool("search-area")} onCancelArea={()=>{api.current?.setTool("select");setTool("select");}} ready={ready} plan={plan} commit={commit} onPreview={(buildings,replace) => {setMapDrafts(buildings);setReplaceDrafts(!!replace);}} onArea={setSearchArea} disabled={dirty} />}
      {step === 0 && <><div className="facility-section-note"><MapPin /><p>This map starts with a fictional layout and no external map services. Coordinates anchor your plan; they do not verify a real building.</p></div><button className="facility-secondary" onClick={() => {
    commit(blankFacility(), "New plan \u2014 Undo is available");
    setSelected({ kind: "camera", id: "" });
  }}>Start an empty plan</button><button className="facility-link" onClick={() => {
    commit(exampleFacility(), "Sample restored \u2014 Undo is available");
    select("C-07", "camera");
  }}>Restore sample facility</button></>}
      {step === 1 && <><div className="facility-action-row"><button className="facility-primary" disabled={!ready} onClick={() => startTool(
    "building"
  )}><Polygon />Draw building</button><button className="facility-secondary" onClick={addRectangle}><Plus />Add rectangle</button></div>
        <ShapeBuilder units={units} onUnits={setUnits} disabled={dirty} add={item => {
          const building = {...item,id:uid('b')};
          if(commit({...plan,buildings:[...plan.buildings,building]},'Building shape added')) {select(building.id,'building');return true;}
          return false;
        }}/>
        <ConstructionGuide />
        {selected.kind === "building" && draft?.id === selected.id && <form onSubmit={saveSelected}>
          <MeasurementSummary ring={draft.footprint} holes={draft.holes} units={units}/><ShapeDimensions shape={draft} onChange={setDraft} units={units}/>
          {draft.source&&<p className="facility-caption">OpenStreetMap source {draft.source.id}. Original height basis: {draft.source.heightBasis}; original floors: {draft.source.floorsBasis}. Source updated: {draft.source.updated}. Edits below are user supplied and do not update the source map.</p>}
          <p className="facility-caption">{draft.holes?.length || 0} courtyards. {draft.part ? 'Independent building part.' : ''} Roof height is above ground.</p>
          <Field label="Building base" suffix="m" value={draft.base || 0} min={0} max={149} onChange={v=>change('base',v)} />
          <Field label="Building name" type="text" value={draft.name} onChange={(v) => change("name", v)} />
          <div className="facility-field-pair"><Field label="Building height" suffix="m" value={draft.height} min={1} max={150} onChange={(v) => change(
    "height",
    v
  )} /><Field label="Number of floors" value={draft.floors} min={1} max={40} step="1" onChange={(v) => change(
    "floors",
    v
  )} /></div>
          <p className="facility-caption">Footprint area: {formatArea(buildingArea(draft),units)}. Courtyards stay open when moving or resizing. Rooms must stay within solid floor space.</p><button className="facility-primary" type="submit">Save building<Check /></button>
        </form>}
      </>}
      {step === 2 && <><FacilityLevels units={units} plan={plan} building={b} floor={floor} onFloor={level=>{setFloor(level);setView('floors');}} commit={commit} disabled={dirty} onSelect={select}/><div className="facility-action-row"><button className="facility-primary" disabled={!ready || !b} onClick={() => startTool(
    "room"
  )}><Polygon />Draw room</button><button className="facility-secondary" disabled={!ready} onClick={() => startTool(
    "label"
  )}><Plus />Place label</button></div><p className="facility-caption">Choose a building and floor on the map. Modeled floors divide the occupied height above the building base evenly. Room outlines reserve walls independently of the floor surface. Labels can name doors, corridors and outdoor areas.</p><div className="facility-item-list compact">{plan.
  rooms.filter((r) => r.buildingId === b?.id && r.level === floor).map((r) => <button key={r.id} className={selected.id ===
  r.id ? "selected" : ""} onClick={() => select(r.id, "room")}><Stack /><span>{r.name}</span></button>)}{plan.labels.map(
    (l) => <button key={l.id} className={selected.id === l.id ? "selected" : ""} onClick={() => select(l.id, "label")}><MapPin /><span>{l.
    name}</span></button>
  )}</div>
        {["room", "label"].includes(selected.kind) && draft?.id === selected.id && <form onSubmit={saveSelected}><Field label={selected.kind ===
  "room" ? "Room name" : "Label text"} type="text" value={draft.name} onChange={(v) => change("name", v)} />{selected.kind ===
  "room" ? <><ShapeDimensions shape={draft} onChange={setDraft} units={units}/><Field label="Room wall height" suffix="m" value={draft.wallHeight} min={0.2} max={10} onChange={(v) => change(
    "wallHeight",
    v
  )} /></> : <div className="facility-field-pair"><Field label="Label east" suffix="m" value={draft.x} min={-2e3} max={2e3} onChange={(v) => change(
    "x",
    v
  )} /><Field label="Label north" suffix="m" value={draft.y} min={-2e3} max={2e3} onChange={(v) => change("y", v)} /></div>}<button className="facility-primary" type="submit">Save {selected.
  kind}<Check /></button></form>}
        <button className="facility-secondary" onClick={() => {
    place("label", [0, 0]);
  }}>Add label at origin</button>
      </>}
      {(step === 3 || step === 4) && <><div className="facility-action-row"><button className="facility-secondary" disabled={!ready} onClick={() => startTool(
    "camera"
  )}><Plus />Place camera</button><button className="facility-link" onClick={() => place("camera", [0, -20])}>Add with coordinates</button></div>
        <label className="facility-field"><span>Selected camera</span><select aria-label="Selected camera" value={selected.
  kind === "camera" ? selected.id : ""} onChange={(e) => select(e.target.value, "camera")}><option value="">Choose a camera…</option>{plan.
  cameras.map((c) => <option key={c.id} value={c.id}>{c.id} · {c.name}</option>)}</select></label>
        {selected.kind === 'camera' && draft?.id === selected.id && <>
          <div className="facility-camera-actions"><button className="facility-secondary" disabled={!ready} onClick={()=>api.current?.centerCamera(selected.id)}><Crosshair/>Center camera</button><button className="facility-secondary" disabled={!ready} onClick={()=>startTool('aim-camera')}>Aim on map</button><button className="facility-secondary" disabled={!ready} onClick={()=>startTool('move-camera')}>Move on map</button></div>
          <FacilityCameraPreview onCount={onPreviewCount} key={selected.id} camera={preview.cameras.find(c=>c.id===selected.id)} onCenter={()=>api.current?.centerCamera(selected.id)} onAim={()=>startTool('aim-camera')}/>
        </>}
        {selected.kind === "camera" && draft?.id === selected.id ? <form className="facility-camera-form" onSubmit={saveSelected}>
          <Field label="Camera name" type="text" value={draft.name} onChange={(v) => change("name", v)} />

          <Field label="Mount elevation above ground" suffix="m" value={draft.z} min={0.5} max={150} onChange={(v) => change(
    "z",
    v
  )} />
          <div className="facility-field-pair"><Field label="Direction from north" suffix="°" value={draft.bearing} min={0} max={359.99} onChange={(v) => change(
    "bearing",
    v
  )} /><Field label="Tilt downward" suffix="°" value={draft.tilt} min={0} max={89} onChange={(v) => change(
    "tilt",
    v
  )} /></div>
          <label className="facility-direction-slider"><span>Rotate view</span><input aria-label="Rotate camera view" type="range" min="0" max="359" step="1" value={draft.
  bearing || 0} onChange={(e) => change("bearing", +e.target.value)} /></label>
          <Field label="Horizontal field of view" suffix="°" value={draft.hfov} min={5} max={170} onChange={(v) => change(
    "hfov",
    v
  )} />
          <Field label="Maximum viewing range" suffix="m" value={draft.range} min={1} max={300} onChange={(v) => change(
    "range",
    v
  )} />
          <details className="facility-advanced"><summary>Position and vertical field of view</summary><div className="facility-field-pair"><Field label="Camera east" suffix="m" value={draft.
  x} min={-2e3} max={2e3} onChange={(v) => change("x", v)} /><Field label="Camera north" suffix="m" value={draft.y} min={-2e3} max={2e3} onChange={(v) => change(
    "y",
    v
  )} /></div><Field label="Vertical field of view" suffix="°" value={draft.vfov} min={5} max={150} onChange={(v) => change(
    "vfov",
    v
  )} /></details>
          <label className="facility-checkbox"><input type="checkbox" checked={draft.enabled} onChange={(e) => change("e\
nabled", e.target.checked)} />Include in coverage estimates</label>
          {note}<button className="facility-primary" type="submit">Save camera<Check /></button>
        </form> : <p className="facility-caption">Select a camera in the inventory, or place the first camera.</p>}
        {step === 3 && <p className="hint">Use the source preview to compare your camera placement. View guides are estimates; centering moves the map, not a physical camera.</p>}
      </>}
      {step === 2 && <><FloorGeometry plan={plan} building={b} floor={floor} selected={selected} draft={draft} onDraft={setDraft} onSelect={select} commit={commit} onDraw={startTool} disabled={dirty} ready={ready} units={units}/><FacilityStairs plan={plan} building={b} floor={floor} selectedId={selected.kind==='stair'?selected.id:''} onSelect={id=>select(id,'stair')} commit={commit} disabled={propertyDirty || zoneDirty} units={units} onDirtyChange={setStairDirty}/></>}
      {step === 5 && <><div className="facility-action-row"><button className="facility-primary" disabled={!ready} onClick={() => startTool(
    "route"
  )}><Path />Draw route</button><button className="facility-secondary" disabled={plan.route.length < 2} onClick={() => {
    setSeconds(0);
    setPlaying(true);
  }}><Play />Run rehearsal</button></div><p className="facility-caption">Follow the route in the map and scrub the timeline. Coverage changes produce proposals for review; no identity matching is running.</p>{plan.route.length>1 && <><LineDimensions points={plan.route} onChange={route=>commit({...plan,route},'Route dimensions saved — Undo available')} units={units}/><p className="facility-caption">Route dimension edits save immediately. Undo restores the previous geometry.</p></>}<h3 className="facility-subheading">Proposed transitions</h3>{proposals.
  length ? proposals.map((p) => <div className="facility-proposal" key={p.key}><strong>{p.from}<CaretRight />{p.to}</strong><small>At {p.
  seconds.toFixed(1)} s · simulated, unverified</small><div><button aria-pressed={decisions[p.key] === "link"} onClick={() => setDecisions(
    (d) => ({ ...d, [p.key]: "link" })
  )}>Link in rehearsal</button><button aria-pressed={decisions[p.key] === "separate"} onClick={() => setDecisions(
    (d) => ({ ...d, [p.key]: "separate" })
  )}>Keep separate</button></div>{decisions[p.key] && <p>{decisions[p.key] === "link" ? "Linked for this rehearsal." : "\
Kept as separate tracks."} This does not verify identity.</p>}</div>) : <p className="facility-caption">No camera transitions on this route yet. Draw a route through two estimated camera views.</p>}{note}<p className="facility-caption">Rehearsal decisions last for this session. Real cross-camera tracking needs calibrated cameras, synchronized recordings, qualified detection and association models, and source review.</p></>}
      {step === 6 && <FacilityZones units={units} plan={plan} selectedId={selected.kind === 'zone' ? selected.id : ''} onSelect={selectZone} onDraw={()=>startTool('zone')} commit={commit} disabled={propertyDirty || stairDirty} ready={ready} building={b} floor={floor} onDirtyChange={setZoneDirty}/>}
      {selectedItem && step !== 0 && step !== 5 && step !== 6 && !['opening','path','stair'].includes(selected.kind) && <button className="facility-delete" onClick={removeSelected}><Trash />Remove {selected.
  kind}<small>Undo available</small></button>}
      </div>
      <div className="facility-step-footer">{propertyDirty && <div className="facility-unsaved"><span>Previewing unsaved edits</span><button onClick={() => {
    setDraft(structuredClone(selectedItem));
    setError("");
  }}>Discard preview</button></div>}{error && <p className="error" role="alert">{error}</p>}<div><button className="facility-secondary" disabled={step ===
  0} onClick={() => go(step - 1)}><CaretLeft />Back</button>{step < STEPS.length - 1 ? <button className="facility-primary" onClick={() => go(
    step + 1
  )}>Continue<CaretRight /></button> : <button disabled={dirty} className="facility-primary" onClick={() => download(
    plan
  )}>Export plan<DownloadSimple /></button>}</div></div>
    </aside><>{pasteOpen && <PlanPasteDialog close={() => setPasteOpen(false)} onImport={(text) => {
    const next = parseFacility(text);
    if (commit(next, "Imported and saved in this browser")) {
      setSelected({ kind: "camera", id: "" });
      return true;
    }
    return false;
  }} />}</><input ref={input} hidden type="file" accept=".json,application/json" aria-label="Import facility plan" onChange={importFile} />
  </section></MeasurementUnits.Provider>;
}
function SiteForm({ plan, commit, center, pickedOrigin, onPin, ready }) {
  const [name, setName] = useState(plan.name), [lng, setLng] = useState(plan.origin[0]), [lat, setLat] = useState(plan.origin[1]);
  const [locating, setLocating] = useState(false), [locationNote, setLocationNote] = useState("");
  const locationRequest = useRef(0);
  useEffect(() => () => { locationRequest.current++; }, []);
  useEffect(()=>{
    if(!pickedOrigin)return;
    locationRequest.current++;setLocating(false);setLng(+pickedOrigin[0].toFixed(7));setLat(+pickedOrigin[1].toFixed(7));
    setLocationNote('Map pin suggestion. Review coordinates, then Save site.');
  },[pickedOrigin]);
  function locate() {
    if (locating) return;
    if (!window.isSecureContext || !navigator.geolocation) {
      setLocationNote("Location is unavailable here. Enter longitude and latitude below.");
      return;
    }
    const request = ++locationRequest.current;
    setLocating(true);
    setLocationNote("Waiting for your location permission. You can use coordinates instead.");
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (request !== locationRequest.current) return;
      setLocating(false);
      if (!Number.isFinite(coords.longitude) || !Number.isFinite(coords.latitude) || Math.abs(coords.latitude) > 80) {
        setLocationNote("This position is outside the supported map range. Enter site coordinates below.");
        return;
      }
      setLng(Number(coords.longitude.toFixed(7)));
      setLat(Number(coords.latitude.toFixed(7)));
      const accuracy = Number.isFinite(coords.accuracy) ? ` Reported accuracy: ±${Math.ceil(coords.accuracy)} m.` : "";
      setLocationNote("Suggested device position only." + accuracy + " Confirm this is your facility before saving. Existing shapes keep their local positions.");
    }, (error) => {
      if (request !== locationRequest.current) return;
      setLocating(false);
      setLocationNote(error.code === 1 ? "Location permission was declined. Enter site coordinates below." :
        error.code === 3 ? "Location timed out. Try again or enter site coordinates below." :
        "Your location could not be determined. Enter site coordinates below.");
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 });
  }
  useEffect(() => {
    setName(plan.name);
    setLng(plan.origin[0]);
    setLat(plan.origin[1]);
  }, [plan]);
  return <><button type="button" className="facility-secondary" disabled={!ready} onClick={onPin}>Pick site on map</button><AddressSearch onChoose={p=>{locationRequest.current++;setLocating(false);setLng(+p.origin[0].toFixed(7));setLat(+p.origin[1].toFixed(7));setLocationNote('Suggested: '+p.label+'. Review before saving. Existing plan positions remain unchanged until Save site.');}} /><form onSubmit={(e) => {
    e.preventDefault();
    if (commit({ ...plan, name, origin: [lng, lat] }, "Site origin saved — choose an area and review building outlines below")) center();
  }}><button type="button" className="facility-secondary" disabled={locating} onClick={locate}>{locating ? "Finding location…" : "Use my location"}</button>
  {locating && <button type="button" className="facility-secondary" onClick={() => { locationRequest.current++; setLocating(false); setLocationNote("Location suggestion cancelled. Enter site coordinates below."); }}>Cancel location</button>}
  <p className="facility-caption">Uses your browser’s location service once, only when requested. Review the suggestion before Save site. This does not find building outlines.</p>
  {locationNote && <p className="facility-caption" role="status">{locationNote}</p>}
  <Field label="Facility name" type="text" value={name} onChange={setName} /><Field label="Longitude" value={lng} min={-180} max={180} onChange={setLng} /><Field label="Latitude" value={lat} min={-80} max={80} onChange={setLat} /><p className="facility-caption">Building and camera positions are meters east and north of this origin. Changing the origin moves the whole plan geographically. This is a local planning coordinate system, not a surveyed model.</p><button className="facility-primary" type="submit" disabled={locating}>Save site<Check /></button></form></>;
}
function PlanPasteDialog({ close, onImport }) {
  const ref = useRef();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const before = document.activeElement;
    ref.current.showModal();
    return () => before?.focus();
  }, []);
  return <dialog aria-labelledby="facility-import-title" className="modal facility-paste-modal" ref={ref} onCancel={close} onClick={(e) => {
    if (e.target === e.currentTarget) close();
  }}><div className="modal-heading"><h2 id="facility-import-title">Import facility JSON</h2><button className="icon-button" onClick={close} aria-label="Close JSON import"><X /></button></div><p>Paste an exported facility plan. Only validated geometry and labels are retained. Maximum 2 MB. Import replaces this plan; Undo remains available.</p><form onSubmit={(e) => {
    e.preventDefault();
    try {
      if (onImport(text)) close();
    } catch (e2) {
      setError(e2.message);
    }
  }}><label className="facility-field"><span>Facility plan JSON</span><textarea autoFocus aria-label="Facility plan JSON" value={text} onChange={(e) => setText(
  e.target.value)} maxLength={2e6} required rows={9} spellCheck={false} /></label>{error && <p className="error" role="alert">{error}</p>}<div className="facility-paste-actions"><button className="facility-secondary" type="button" onClick={close}>Cancel</button><button className="facility-primary" type="submit">Import pasted plan<UploadSimple /></button></div></form></dialog>;
}
export {
  FacilityBuilder
};
