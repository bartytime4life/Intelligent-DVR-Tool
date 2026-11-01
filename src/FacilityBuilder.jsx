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
  ArrowClockwise,
  DownloadSimple,
  UploadSimple,
  Crosshair,
  Polygon,
  Trash,
  Play,
  Pause,
  MagnifyingGlass,
  WarningCircle,
  Printer,
  X
} from "@phosphor-icons/react";
import "maplibre-gl/dist/maplibre-gl.css";
import "./facility.css";
import {
  STEPS,
  LIMITS,
  validateFacility,
  uid,
  centroid,
  rehearse,
  rehearsalSeconds,
  routeLength,
  WALK_SPEED,
  routePoint,
  seesPoint,
  wallObstacles,
  polygonArea,
  pointInPolygon,
  groundRange
} from "./facility.mjs";
import { createFacilityMap } from "./facility-map.mjs";
import { OpenMapStarter, ShapeBuilder, MeasurementSummary, ConstructionGuide } from './FacilityStarter.jsx';
import { draftFacility } from './facility-starter.mjs';
import { AddressSearch } from "./AddressSearch.jsx";
import LineDimensions from './LineDimensions.jsx';
import ShapeDimensions from './ShapeDimensions.jsx';
import FloorGeometry,{PointListEntry} from './FloorGeometry.jsx';
import FacilityStairs from './FacilityStairs.jsx';
import {unitFactor, displayLength, unitLabel, enteredLength, localizeLengths} from './facility-shape-edit.mjs';
import {formatDistance,formatArea} from './facility-measurements.mjs';
import {createFloorOpening,createFloorPath,snapToBuilding,solidSpaceProblem,applyBuildingEdit,buildingMotion,fittingRectangle,reoriginPlan,SNAP_TOLERANCE} from './facility.mjs';
import {backdropDismiss} from './dialog-dismiss.mjs';
import FacilityLevels from './FacilityLevels.jsx';
import FacilityZones from './FacilityZones.jsx';
import { createFacilityZone } from './facility-zones.mjs';
import FacilityCameraPreview from './FacilityCameraPreview.jsx';
import { fanCache, coverageMetrics, zoneCoverage, enabledFans, MAX_COVERAGE_CELLS } from './facility-coverage.mjs';
import { DORI_NOTE, LENS_PRESETS, lensPreset, doriDistances, densityAtGround, PIXELS_WIDE, pixelsWideOK } from './facility-dori.mjs';
import { installerSheetHTML, installerSheetFilename } from './facility-installer.mjs';
import './facility-camera-planning.css';
const MeasurementUnits = React.createContext("metric");
import FacilityLibrary,{downloadFacilityData} from './FacilityLibrary.jsx';
import {facilityFilename} from './facility-library.mjs';
import {FacilityEmptyState} from './FacilitySwitcher.jsx';
const keyOf = { building: "buildings", camera: "cameras", room: "rooms", label: "labels", zone: "zones", opening: "openings", stair: "stairs", path: "paths" };
const round = (n) => Math.round(n * 100) / 100;
function download(data){downloadFacilityData(data,facilityFilename(data));}
// Length fields keep the typed text and convert only a changed number; limits round outward so 3.28 ft still means 1 m.
function Field({ name, label, value, onChange, min, max, step = "any", type = "number", suffix, maxLength = 100 }) {
  const units=useContext(MeasurementUnits), length=suffix==='m',factor=length?unitFactor(units):1;
  const shown=String((length?displayLength(value,units):value) ?? ''), [text,setText]=useState(shown);
  const sent=useRef(value), base=useRef({value,units});
  useEffect(()=>{if(value!==sent.current || units!==base.current.units){sent.current=value;base.current={value,units};setText(shown);}},[value,units]);
  const lo=min===undefined?undefined:length?Math.floor(min/factor*100)/100:min, hi=max===undefined?undefined:length?Math.ceil(max/factor*100)/100:max;
  function change(t) {
    setText(t);
    if (type !== 'number') return onChange(t);
    if (t === '') { sent.current=''; return onChange(''); }
    const n=Number(t);
    let next=length?enteredLength(n,base.current.value,units):n;
    if (length && min!==undefined && next<min && n>=lo) next=min;
    if (length && max!==undefined && next>max && n<=hi) next=max;
    sent.current=next;onChange(next);
  }
  return <label className="facility-field"><span>{label}{suffix && <small>{length?unitLabel(units):suffix}</small>}</span><input name={name} aria-label={label} type={type} value={type==='number'?text:value ?? ''} required min={lo} max={hi} step={type === 'number' ? step : undefined} maxLength={type === 'text' ? maxLength : undefined} onChange={e=>change(e.target.value)}/></label>;
}
// Steps that can select an item kind in place; other kinds open their own step.
const STEP_KINDS = [[], ["building"], ["building", "room", "label", "opening", "path", "stair"], ["camera"], ["camera"], ["camera"], ["zone"]];
const HOME_STEP = { building: 1, room: 2, label: 2, opening: 2, path: 2, stair: 2, camera: 3, zone: 6 };
const SOLID_KINDS = { room: "Room", opening: "Floor opening", "floor-path": "Floor pathway" };
// onDirtyChange(true) while leaving would discard unsaved edits, drafts or memory-only facilities.
function FacilityBuilder({onDirtyChange,...props}){return <FacilityLibrary onDirtyChange={onDirtyChange}>{libraryProps=><FacilityEditor key={libraryProps.facilityId} {...props} {...libraryProps}/>}</FacilityLibrary>;}
function FacilityEditor({onPreviewCount,initialPlan,facilityControls,onPersist,onDraftChange,onImportFacilities,onOpenImport}) {
  const initial=useRef({plan:initialPlan,status:'Ready to edit',error:''});
  const [siteDirty,setSiteDirty]=useState(false),[shapePending,setShapePending]=useState(false),[linePending,setLinePending]=useState(false);
  const [zoneDirty, setZoneDirty] = useState(false), [stairDirty,setStairDirty]=useState(false);
  const [mapFocus, setMapFocus] = useState(false), [helpOpen, setHelpOpen] = useState(false);
  const [measurements, setMeasurements] = useState(true), [units, setUnits] = useState(()=>{try{return localStorage.getItem("dvr.facility.units")==="imperial"?"imperial":"metric";}catch{return "metric";}}), [mapBearing, setMapBearing] = useState(-27);
  const [pickedOrigin,setPickedOrigin]=useState(null), [drawnArea,setDrawnArea]=useState(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [blindZone, setBlindZone] = useState(''), [dragging, setDragging] = useState('');
  const [mapDrafts, setMapDrafts] = useState([]), [searchArea, setSearchArea] = useState(null);
  const [replaceDrafts, setReplaceDrafts] = useState(false);
  const [draftPreviewError, setDraftPreviewError] = useState('');
  const [plan, setPlan] = useState(initial.current.plan), [step, setStep] = useState(0), [selected, setSelected] = useState(
    { kind: "camera", id: "" }
  ), [draft, setDraft] = useState(null), [view, setView] = useState("3d"), [floor, setFloor] = useState(
    0
  ), [floorBuilding, setFloorBuilding] = useState(initialPlan.buildings[0]?.id || ""), [tool, setTool] = useState("select"), [error, setError] = useState(
    initial.current.error
  ), [status, setStatus] = useState(initial.current.status), [ready, setReady] = useState(false), [
    mapError,
    setMapError
  ] = useState(""), [streets, setStreets] = useState(false), [search, setSearch] = useState(""), [
    page,
    setPage
  ] = useState(0), [history, setHistory] = useState([]), [future, setFuture] = useState([]), [playing, setPlaying] = useState(false), [seconds, setSeconds] = useState(
    0
  ), [decisions, setDecisions] = useState({});
  useEffect(()=>{try{localStorage.setItem("dvr.facility.units",units);}catch{}},[units]);
  const mapEl = useRef(), api = useRef(), input = useRef(), latest = useRef(), fans = useRef();
  fans.current ||= fanCache();
  const selectedItem = plan[keyOf[selected.kind]]?.find((x) => x.id === selected.id);
  const propertyDirty = !['zone','stair'].includes(selected.kind) && !!(draft && selectedItem && draft.id === selectedItem.id && JSON.stringify(draft) !== JSON.stringify(selectedItem));
  const dirty = propertyDirty || zoneDirty || stairDirty || siteDirty;
  const editingDirty=dirty || shapePending || linePending;
  const navigationDirty=editingDirty || mapDrafts.length>0 || tool!=='select';
  useEffect(()=>{onDraftChange(navigationDirty);return()=>onDraftChange(false);},[navigationDirty,onDraftChange]);
  useEffect(() => setDraft(selectedItem ? structuredClone(selectedItem) : null), [selectedItem]);
  useEffect(()=>{if(selectedItem && ['opening','path','stair'].includes(selected.kind)){setFloorBuilding(selectedItem.buildingId);setFloor(selectedItem.level ?? selectedItem.fromLevel);setView('floors');}},[selected.kind,selected.id,selectedItem?.id]);
  const b = plan.buildings.find((x) => x.id === floorBuilding) || plan.buildings[0];
  useEffect(() => { if (b) setFloor(f => Math.min(f, b.floors - 1)); else setFloor(0); }, [b?.id, b?.floors]);
  const rehearsal = useMemo(() => plan.route.length > 1 ? rehearse(plan) : [], [plan]);
  // Simulated walking time; long routes play back faster so a run takes about a minute.
  const duration = useMemo(() => rehearsalSeconds(plan.route), [plan.route]), playRate = Math.max(1, Math.ceil(duration / 60));
  const position = plan.route.length > 1 ? routePoint(plan.route, duration ? seconds / duration : 0) : null;
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
        if (s + elapsed * playRate >= duration) {
          setPlaying(false);
          return duration;
        }
        return s + elapsed * playRate;
      });
    }, 100);
    return () => clearInterval(timer);
  }, [playing, duration, playRate]);
  function commit(next, message) {
    try {
      const clean = validateFacility(next);
      if (JSON.stringify(clean) === JSON.stringify(plan)) { setError(""); setStatus("No changes to save"); return true; }
      const result=onPersist(clean);
      setHistory((h) => [...h.slice(-19), plan]);
      setFuture([]);
      setPlan(clean);
      setError("");
      setStatus(result.saved ? (message || 'Saved in this browser') : 'Changes applied in memory — export a backup');
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    }
  }
  function select(id, kind) {
    if (editingDirty) {
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
    const here=STEP_KINDS[step].includes(kind);
    // Building envelopes are backdrop context while placing cameras, routes or zones.
    if(!here && step>=3 && kind==='building') return;
    if (kind === 'zone') {if(!editingDirty){if(!here)setStep(6);selectZone(id);}else setError('Save or discard your preview before selecting another item.');return;}
    if(!select(id,kind)) return;
    if(kind==='room') { const room=plan.rooms.find(r=>r.id===id); if(room){setFloorBuilding(room.buildingId);setFloor(room.level);setView('floors');}}
    if(!here) setStep(HOME_STEP[kind]);
  }
  // Vertices just outside solid floor snap to the wall; a larger miss names the vertex and keeps the outline for redrawing.
  function solidPoints(kind, points) {
    const fit=snapToBuilding(points.map(p=>p.map(round)),b,{clearance:kind==='opening'?.05:0,holes:kind!=='floor-path'});
    const problem=solidSpaceProblem(fit.points,b,{holes:kind!=='floor-path'});
    if(!problem) return fit;
    const label=SOLID_KINDS[kind];
    setError(problem.edge ? `${label} not saved: edge ${problem.edge[0]}–${problem.edge[1]} crosses outside the solid floor of ${b.name}. Redraw it beside the kept outline, or press Escape.` :
      `${label} not saved: vertex ${problem.vertex} is ${formatDistance(problem.distance,units)} ${problem.where==='courtyard'?'inside a courtyard of':'outside'} ${b.name}. Vertices within ${formatDistance(SNAP_TOLERANCE,units)} snap to the wall; redraw beside the kept outline, or press Escape.`);
    return null;
  }
  const snapNote=(message,fit)=>fit.snapped ? `${message} · ${fit.snapped} ${fit.snapped===1?'vertex':'vertices'} snapped to the building outline` : message;
  function onDraw(kind, ring) {
    if(kind==='search-area') {setDrawnArea(ring.map(p=>p.map(round)));return true;}

    if (editingDirty) { setError("Save or discard your preview before drawing."); return false; }
    if (kind === 'opening' || kind === 'floor-path') {
      if(!b) {setError('Choose a building and floor first.');return false;}
      const fit=solidPoints(kind,ring);
      if(!fit) return false;
      try {
        const item=kind==='opening' ? createFloorOpening(plan,b.id,floor,fit.points) : createFloorPath(plan,b.id,floor,fit.points);
        const key=kind==='opening'?'openings':'paths',selection=kind==='opening'?'opening':'path';
        if(!commit({...plan,[key]:[...(plan[key] || []),item]},snapNote(kind==='opening'?'Floor opening saved; ceiling below updated':'Floor path saved',fit))) return false;
        select(item.id,selection);setView('floors');return true;
      } catch(e) {setError(e.message);return false;}
    }
    if (kind === "zone") {
      try {
        const item = createFacilityZone(ring.map(p => p.map(round)));
        if (!commit({...plan, zones:[...(plan.zones || []), item]}, "Zone saved — configure its rule")) return false;
        select(item.id, "zone");return true;
      } catch (e) { setError(e.message); return false; }
    }
    if (kind === "route") return commit({ ...plan, route: ring }, "Route saved");
    if (kind === "building") {
      const item = { id: uid("b"), name: "New building", footprint: ring.map((p) => p.map(round)), height: 8, floors: 2 };
      if (!commit({ ...plan, buildings: [...plan.buildings, item] }, "Building saved")) return false;
      select(item.id, "building");return true;
    }
    if (kind === "room" && b) {
      const fit=solidPoints(kind,ring);
      if(!fit) return false;
      const item = { id: uid("r"), name: "New room", footprint: fit.points, buildingId: b.id, level: floor, wallHeight: 2.8 };
      if (!commit({ ...plan, rooms: [...plan.rooms, item] }, snapNote("Room saved",fit))) return false;
      select(item.id, "room");return true;
    }
    return true;
  }
  function addRectangularRoom() {
    if (editingDirty) { setError("Save or discard your preview before adding a room."); return; }
    if (!b) { setError("Add a building before adding rooms."); return; }
    try {
      const footprint=fittingRectangle(b,4,plan.rooms.filter(r=>r.buildingId===b.id && r.level===floor).map(r=>r.footprint));
      const item = { id: uid("r"), name: "New room", footprint, buildingId: b.id, level: floor, wallHeight: 2.8 };
      if (commit({ ...plan, rooms: [...plan.rooms, item] }, "Rectangular room added — set its size and position below")) select(item.id, "room");
    } catch (e) { setError(e.message); }
  }
  function place(kind, p) {
    if (editingDirty) {
      setError("Save or discard your preview before adding another item.");
      return;
    }
    const far = outsideGrid(p);
    if (far) { setError(far); return; }
    // A label placed inside the active building while editing floors belongs to that level only.
    const indoor = kind === "label" && b && (step === 2 || view === "floors") && pointInPolygon(p, b.footprint) ? { buildingId: b.id, level: floor } : {};
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
    ), z: 0, ...indoor };
    if (commit({ ...plan, [keyOf[kind]]: [...plan[keyOf[kind]], item] }, kind === "camera" ? "Camera placed \u2014 adjust its\
 view" : indoor.buildingId ? `Label placed on ${b.name} \u00b7 Level ${floor + 1}` : "Label placed")) select(item.id, kind);
  }
  function aimCamera(p) {
    if (selected.kind !== 'camera' || !draft) return false;
    const dx = p[0] - draft.x, dy = p[1] - draft.y;
    if (Math.hypot(dx,dy) < .05) { setError('Choose a point away from the camera to aim its view.'); return false; }
    setDraft(d => ({...d, bearing: Math.min(359.99, round((Math.atan2(dx,dy)*180/Math.PI+360)%360))}));
    setError('');
    return true;
  }
  const outsideGrid = p => Math.abs(p[0]) > 2e3 || Math.abs(p[1]) > 2e3 ? `That point is ${formatDistance(Math.hypot(p[0], p[1]), units)} from the site origin. Plan items must stay within ${formatDistance(2e3, units)} east and north of it; move the site origin first.` : '';
  function moveCamera(p) {
    if (selected.kind !== 'camera' || !draft) return false;
    const far = outsideGrid(p);
    if (far) { setError(far); return false; }
    setDraft(d => ({...d,x:round(p[0]),y:round(p[1])}));
    setError('');
    return true;
  }
  // Direct manipulation (drag, rotate handle, Alt+Arrow, [ and ]) edits only the unsaved draft; Save camera commits.
  const manipulate = (step === 3 || step === 4) && selected.kind === 'camera' && !!draft && draft.id === selected.id && tool === 'select';
  function cameraKey(e) {
    if (!manipulate || e.ctrlKey || e.metaKey) return false;
    const nudge = {ArrowUp:[0,.5],ArrowDown:[0,-.5],ArrowLeft:[-.5,0],ArrowRight:[.5,0]}[e.key];
    // Functional updates keep fast key repeats cumulative before the next render.
    if (e.altKey && nudge) {
      const p = [draft.x + nudge[0], draft.y + nudge[1]], far = p.every(Number.isFinite) ? outsideGrid(p) : 'Enter a valid camera position before nudging it.';
      if (far) { setError(far); return true; }
      setDraft(d => ({...d, x: round(d.x + nudge[0]), y: round(d.y + nudge[1])}));
      setError('');
      return true;
    }
    if (e.altKey || !['[', ']'].includes(e.key)) return false;
    if (!Number.isFinite(draft.bearing)) { setError('Enter a valid direction before rotating the camera.'); return true; }
    const turn = b => { const t = round(((b + (e.key === ']' ? 5 : -5)) % 360 + 360) % 360); return t > 359.99 ? 0 : t; };
    setDraft(d => ({...d, bearing: turn(d.bearing)}));
    setError('');
    return true;
  }
  latest.current = { undo, redo, go, cameraKey, onBearing:setMapBearing, onAim:aimCamera, onMoveCamera:moveCamera, onCameraDrag:(kind,active)=>setDragging(active ? kind : ''), onPin: p=>setPickedOrigin(p), onDraw, onPlace: place, onSelect: selectOnMap, onToolDone: () => {
    setTool("select");
  }, onReady: () => setReady(true), onError: setMapError };
  useEffect(() => {
    try {
      api.current = createFacilityMap(mapEl.current, Object.fromEntries(["onBearing", "onAim", "onMoveCamera", "onCameraDrag", "onPin", "onDraw", "onPlace", "onSelect", "onToolDone", "onReady", "onError"].map((k) => [k, (...args) => latest.current[k](...args)])), plan, {fans: fans.current});
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
  // A building move/rotation carries its contents; other edits replace only the selected item.
  const edited = (kind, item) => kind === 'building' ? applyBuildingEdit(plan, item) : { ...plan, [keyOf[kind]]: plan[keyOf[kind]].map((x) => x.id === item.id ? item : x) };
  // Typing settles for 120 ms before the preview is validated and the map rebuilt; Save always uses the live draft.
  const [settledDraft, setSettledDraft] = useState(draft);
  useEffect(() => { if (settledDraft === draft) return; const timer = setTimeout(() => setSettledDraft(draft), 120); return () => clearTimeout(timer); }, [draft]);
  const { plan: preview, error: previewError } = useMemo(() => {
    if (!propertyDirty || !keyOf[selected.kind] || settledDraft?.id !== selected.id) return { plan, error: '' };
    try {
      return { plan: validateFacility(edited(selected.kind, settledDraft)), error: '' };
    } catch (e) {
      return { plan, error: e.message };
    }
  }, [plan, settledDraft, selected, propertyDirty]);
  useEffect(() => {
    let displayed = preview;
    let failure = '';
    if (mapDrafts.length) {
      try { displayed = draftFacility(preview, mapDrafts, replaceDrafts); } catch(e) { failure = e.message; }
    }
    setDraftPreviewError(failure);
    api.current?.update(displayed, selected.id, view, floor, {measurements, units, floorBuildingId:b?.id, manipulate});
  }, [preview, mapDrafts, replaceDrafts, selected.id, view, floor, ready, measurements, units, b?.id, manipulate]);
  // Coverage metrics sample the same cached fans the map draws, from the previewed plan.
  const coverage = useMemo(() => step === 4 ? coverageMetrics(preview, fans.current(wallObstacles(preview))) : null, [step, preview]);
  const blindSpots = useMemo(() => {
    const zone = step === 4 && (preview.zones || []).find(z => z.id === blindZone && z.enabled && z.buildingId === undefined);
    return zone ? zoneCoverage(zone.footprint, enabledFans(preview, fans.current(wallObstacles(preview))), {blindSpots:true}).blindSpots : null;
  }, [step, preview, blindZone]);
  useEffect(() => api.current?.setBlindSpots(blindSpots), [blindSpots, ready]);
  useEffect(() => api.current?.setArea(searchArea), [searchArea, ready]);
  useEffect(() => api.current?.setTrack(step === 5 ? position : null), [step, seconds, plan, ready]);
  useEffect(() => {
    const stop = (e) => {
      if (e.key === "Escape") {
        api.current?.setTool("select");
        setTool("select");
        setHelpOpen(false);
      }
      // Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl+Y redo, unless focus is in a text-entry control.
      const t = e.target, key = e.key?.toLowerCase();
      const typing = t?.isContentEditable || ["TEXTAREA", "SELECT"].includes(t?.tagName) || t?.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "range", "file", "color"].includes(t.type);
      if (!typing && !t?.closest?.("dialog") && !e.ctrlKey && !e.metaKey && !e.altKey && e.key === '?') {
        e.preventDefault(); setHelpOpen(open => !open); return;
      }
      if (!typing && !t?.closest?.("dialog") && !e.ctrlKey && !e.metaKey && !e.altKey && /^[1-7]$/.test(e.key)) {
        e.preventDefault(); setMapFocus(false); latest.current.go(Number(e.key) - 1); return;
      }
      if (!typing && !t?.closest?.("dialog") && latest.current.cameraKey(e)) { e.preventDefault(); return; }
      if (!(e.ctrlKey || e.metaKey) || e.altKey || typing || !["z", "y"].includes(key)) return;
      e.preventDefault();
      if (key === "y" || e.shiftKey) latest.current.redo(); else latest.current.undo();
    };
    document.addEventListener("keydown", stop);
    return () => document.removeEventListener("keydown", stop);
  }, []);
  function go(n) {
    if (editingDirty) {
      setError("Save or discard your preview before changing steps.");
      return;
    }
    setStep(n);
    setError("");
    setTool("select");
    api.current?.setTool("select");
    setPlaying(false);
    const keeps = kind => selected.kind === kind && plan[keyOf[kind]].some(x => x.id === selected.id);
    if (n === 1 && !keeps("building") && b) select(b.id, "building");
    if (n === 2) {
      setView("floors");
      if (b) select(b.id, "building");
    }
    if (n === 3 || n === 4) {
      setView("3d");
      if (!keeps("camera") && plan.cameras[0]) select(plan.cameras[0].id, "camera");
    }
    if (n === 5) setView("3d");
    if (n === 6) { setView("2d"); setSelected({kind:'zone',id:plan.zones?.[0]?.id || ''}); }
  }
  function startTool(kind) {
    if (editingDirty && !["aim-camera", "move-camera"].includes(kind)) {
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
    if (["building", "route", "zone", "search-area", "site-pin", "camera", "aim-camera", "move-camera"].includes(kind) || kind === "label" && view !== "floors") setView("2d");
    if (["room","opening","floor-path"].includes(kind)) setView("floors");
    api.current?.setTool(kind);
  }
  function saveSelected(e) {
    e.preventDefault();
    if (!draft) return;
    let next;
    try { next = edited(selected.kind, draft); } catch (x) { setError(x.message); return; }
    const motion = selected.kind === 'building' && selectedItem && buildingMotion(selectedItem, draft);
    if (commit(next, motion && !motion.identity ? "Building and its contents moved — Undo available" : "Changes saved")) setDraft(structuredClone(draft));
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
      next.labels=plan.labels.map(l=>{if(l.buildingId!==selected.id)return l;const copy={...l};delete copy.buildingId;delete copy.level;return copy;});
    }
    if (commit(next, "Removed \u2014 Undo is available")) {
      setSelected({ kind: "camera", id: "" });
      setDraft(null);
    }
  }
  const busyMessage = action => editingDirty ? `Save or discard your preview before ${action}.` : `Finish or cancel the drawing or map draft before ${action}.`;
  function undo() {
    if (navigationDirty) {setError(busyMessage("undoing"));return;}
    const prev = history.at(-1);
    if (!prev) return;
    let result;try{result=onPersist(prev);}catch(e){setError(e.message);return;}
    setFuture((f) => [...f.slice(-19), plan]);
    setPlan(prev);
    setHistory((h) => h.slice(0, -1));
    setError("");
    setStatus(result.saved?'Previous edit restored · Redo available':'Restored in memory — export a backup');
  }
  function redo() {
    if (navigationDirty) {setError(busyMessage("redoing"));return;}
    const next = future.at(-1);
    if (!next) return;
    let result;try{result=onPersist(next);}catch(e){setError(e.message);return;}
    setHistory((h) => [...h.slice(-19), plan]);
    setPlan(next);
    setFuture((f) => f.slice(0, -1));
    setError("");
    setStatus(result.saved?'Edit redone':'Redone in memory — export a backup');
  }

  function downloadInstallerSheet() {
    try {
      const url = URL.createObjectURL(new Blob([installerSheetHTML(plan, {units, fanOf:fans.current(wallObstacles(plan))})], {type:'text/html'}));
      const a = document.createElement('a'); a.href = url; a.download = installerSheetFilename(plan); a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setError(''); setStatus('Installer sheet downloaded — planning estimate, verify on site');
    } catch (x) { setError(x.message); }
  }
  // Optional camera fields are removed, not stored empty, when their input is cleared.
  const optional = (key, value) => setDraft(d => { const next = {...d}; if (String(value ?? '').trim() === '') delete next[key]; else next[key] = value; return next; });
  function addRectangle() {
    if (editingDirty) {
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
      if (f.size > 4_000_000) throw Error("Facility backups must be smaller than 4 MB.");
      onImportFacilities(await f.text());
    } catch (x) {
      setError(x.message);
    }
  }
  const cameras = plan.cameras.filter((c) => (c.name + " " + c.id).toLowerCase().includes(search.toLowerCase()));
  useEffect(() => setPage((p) => Math.min(p, Math.max(0, Math.ceil(cameras.length / 6) - 1))), [cameras.length]);
  const toolText = { opening:"Trace the open area on this floor. The same opening becomes the ceiling void below.", "floor-path":"Click a route through solid floor. Double-click to finish; openings cannot be crossed.", "aim-camera":"Click the point you want this camera to face, then Save camera.", "move-camera":"Click the new mounting position, then Save camera.", zone:"Trace the zone boundary. Click its first corner to finish.", "site-pin":"Click the map to suggest a site location, then review and Save site.", "search-area":"Click the area corners, then its first corner to finish. Review or edit the vertices before loading.", building: "Click each corner, then click the first corner to finish.", room: "Trace a room inside t\
he selected building. Click its first corner to finish.", route: "Click route points. Double-click the last point to fin\
ish.", camera: "Click the map to place a camera. Adjust its height and view next.", label: "Click the map to position a \
label. Inside the active building it belongs to the current level; elsewhere it is a ground label." };
  const change = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  const note = <p className="facility-estimate"><WarningCircle size={17} /><span>Estimated ground visibility · verify on site. Opaque walls only; excludes floor slabs, openings, furniture and lens effects.</span></p>;
  return <MeasurementUnits.Provider value={units}><section className={`facility-workspace${mapFocus ? ' is-map-focused' : ''}`} aria-label="Guided facility builder">
    <header className="facility-workbench" aria-label="Facility Studio toolbar">
      <div className="facility-workbench-identity"><strong>FACILITY STUDIO</strong><span title={plan.name}>{plan.name} · {plan.buildings.length} buildings · {plan.cameras.length} cameras</span></div>
      <nav className="facility-workbench-tasks" aria-label="Jump to facility task">
        {['Site', 'Buildings', 'Floors', 'Cameras', 'Coverage', 'Handoffs', 'Zones'].map((name, index) => <button key={name}
          type="button" aria-current={step === index ? 'step' : undefined} onClick={() => {setMapFocus(false);go(index);}}
          title={`Step ${index + 1}: ${STEPS[index][0]} (shortcut ${index + 1})`}>{name}</button>)}
      </nav>
      <div className="facility-workbench-actions">
        {navigationDirty && <span className="facility-workbench-unsaved" role="status">Unsaved work</span>}
        <button type="button" className="facility-focus-button" aria-pressed={mapFocus}
          aria-label={mapFocus ? 'Show facility panels' : 'Focus facility map'} onClick={() => setMapFocus(focused => !focused)}>
          {mapFocus ? 'Show panels' : 'Focus map'}</button>
        <button type="button" aria-expanded={helpOpen} aria-controls="facility-shortcuts" onClick={() => setHelpOpen(open => !open)}>Help</button>
      </div>
    </header>
    <aside className="facility-guide">{facilityControls}
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
    if(select(c.id, "camera") && !STEP_KINDS[step].includes("camera")) setStep(3);
  }}><VideoCamera size={17} /><span>{c.name}<small>{c.id}{!c.enabled ? " \xB7 excluded" : ""}</small></span></button>)}{!cameras.
  length && <p>No cameras match.</p>}</div>
          {cameras.length > 6 && <div className="facility-pagination"><button aria-label="Previous cameras" disabled={!page} onClick={() => setPage(
    (p) => p - 1
  )}><CaretLeft /></button><span>{page + 1} / {Math.ceil(cameras.length / 6)}</span><button aria-label="Next cameras" disabled={(page +
  1) * 6 >= cameras.length} onClick={() => setPage((p) => p + 1)}><CaretRight /></button></div>}
        </>}
      </div>
      <div className="facility-file-actions"><button disabled={navigationDirty} onClick={() => download(plan)}><DownloadSimple />Export plan</button><button disabled={navigationDirty} onClick={() => input.
  current.click()}><UploadSimple />Import plan</button><button disabled={navigationDirty} onClick={() => setPasteOpen(true)}><UploadSimple />Paste JSON</button><button onClick={undo} disabled={!history.length || navigationDirty} title="Undo (Ctrl/⌘+Z)" aria-keyshortcuts="Control+Z Meta+Z"><ArrowCounterClockwise />Undo edit</button><button onClick={redo} disabled={!future.length || navigationDirty} title="Redo (Ctrl/⌘+Shift+Z or Ctrl+Y)" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"><ArrowClockwise />Redo edit</button></div>
      <p className="facility-save-state" role="status">{status}</p>
    </aside>
    <div className="facility-stage">
      {helpOpen && <section id="facility-shortcuts" className="facility-workbench-help" role="region" aria-label="Facility keyboard and map help">
        <div><strong>Work faster in Facility Studio</strong><button type="button" onClick={() => setHelpOpen(false)} aria-label="Close facility help"><X size={17}/></button></div>
        <p><kbd>1</kbd>–<kbd>7</kbd> switches tasks, <kbd>?</kbd> toggles this help, and <kbd>Esc</kbd> cancels drawing. Ctrl/⌘+Z undoes committed edits.</p>
        <p>Use <strong>Focus map</strong> to maximize the canvas, then <strong>Show panels</strong> to edit and save. Camera drag/aim previews are unsaved until Save camera. Alt+Arrow nudges a selected camera 0.5 m; [ and ] rotate it 5°.</p>
        <p>Camera coverage, distances and handoffs are planning estimates. Real video sampling is opt-in under a selected camera's Image diagnostics.</p>
      </section>}
      {!plan.buildings.length && !plan.cameras.length && !plan.labels.length && !plan.zones?.length && !plan.route.length && tool==='select' && step===0 && <FacilityEmptyState disabled={navigationDirty} onDraw={()=>{go(1);if(ready)startTool('building');}} onImport={onOpenImport} onLocate={()=>{go(0);input.current?.closest('section')?.querySelector('[aria-label="Facility name"]')?.focus();}}/>}
      <div className="facility-map" ref={mapEl} role="group" aria-label="Facility map. Use arrow keys to pan; use the add-with-coordinates, rectangle and point-list controls to place items without drawing." />
      <div className="facility-view-controls" role="group" aria-label="Map view">{[["2d", "2D"], ["3d", "3D"], ["floors", "Floors"]].
  map(([id, title]) => <button key={id} aria-pressed={view === id} onClick={() => setView(id)}>{title}</button>)}<button className="facility-fit" title="Center facility" aria-label="Center facility" onClick={() => api.
  current?.center()}><Crosshair size={18} /></button><button title="Reset map view" aria-label="Reset map view" onClick={() => api.current?.reset()}><ArrowCounterClockwise size={18}/></button></div>
      <div className="facility-map-tools">
        <button className="facility-compass" aria-label="Point map north" title="Point map north" onClick={() => api.current?.north()}><span style={{transform:`rotate(${-mapBearing}deg)`}}>↑</span><b>N</b><small>{Math.round((mapBearing+360)%360)}°</small></button>
        <label><input type="checkbox" checked={measurements} onChange={e=>setMeasurements(e.target.checked)}/>Dimensions</label>
        <select aria-label="Measurement units" disabled={linePending} value={units} onChange={e=>setUnits(e.target.value)}><option value="metric">Meters · m / m²</option><option value="imperial">Feet · ft / ft²</option></select>
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
      {dragging && <div className="facility-draw-hint facility-drag-hint" role="status"><VideoCamera /><span>{dragging === 'move' ? 'Moving the selected camera' : 'Aiming the selected camera'}<small>Release to update the unsaved preview. Escape cancels. Save camera commits.</small></span></div>}
      {(step === 2 || view === "floors") && <div className="facility-floor-picker"><Stack size={18} /><select aria-label="Building for floor editing" value={b?.
  id || ""} onChange={(e) => {
    if(editingDirty) {setError("Save or discard your preview before changing floors.");return;}
    setFloorBuilding(e.target.value);
    setFloor(0);
    select(e.target.value, "building");
  }}>{plan.buildings.map((b2) => <option value={b2.id} key={b2.id}>{b2.name}</option>)}</select><select aria-label="Active floor" value={floor} onChange={(e) => {
    if(editingDirty) {setError("Save or discard your preview before changing floors.");return;}
    setFloor(+e.target.value);
    setView("floors");
  }}>{Array.from({ length: b?.floors || 1 }, (_, i) => <option key={i} value={i}>{i === 0 ? b?.base ? `Lowest modeled floor (${formatDistance(b.base,units)})` : "Ground floor" : "Level " + (i +
  1)}</option>)}</select><button className="facility-secondary" aria-label="Center active building" onClick={()=>b&&api.current?.centerSelection(b.id)}><Crosshair size={17}/></button></div>}
      <div className="facility-map-legend"><span><i className="coverage-key" />Estimated visibility</span><span><i className="route-key" />Route / object watch</span><span><i className="restricted-key" />Restricted</span><span>Only the selected camera’s 3D volume is shown.</span>{!!blindSpots?.length && <span><i className="blind-spot-key" />Blind spot · estimate</span>}</div>
      {step === 5 && <div className="facility-rehearsal"><div className="facility-rehearsal-top"><button aria-label={playing ?
  "Pause rehearsal" : "Play rehearsal"} disabled={plan.route.length < 2} onClick={() => {
    if (seconds >= duration) setSeconds(0);
    setPlaying((v) => !v);
  }}>{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</button><span>{seconds.toFixed(1)} / {duration.toFixed(1)} s{playRate > 1 ? ` · ${playRate}× playback` : ""}</span><input aria-label="Rehearsal time" type="range" min="0" max={duration.toFixed(1)} step=".1" value={Math.min(seconds, duration)} onChange={(e) => {
    setPlaying(false);
    setSeconds(+e.target.value);
  }} /></div><p><strong>Simulated Track P-014</strong><span>{visibleAtPosition.length ? "In estimated view: " + visibleAtPosition.
  join(", ") : "Blind spot \xB7 no camera observation"}</span></p><small>A planned route walked at an assumed {formatDistance(WALK_SPEED, units)}/s ({formatDistance(routeLength(plan.route), units)}), not measured movement or a person identity.</small></div>}
    </div>
    <aside className="facility-properties">
      <header><p className="eyebrow">STEP {step + 1} OF {STEPS.length}</p><h2>{["Locate your facility", "Shape a building", "Define f\
loors & labels", "Aim this camera", "Check estimated coverage", "Test camera handoffs", "Zones & object rules"][step]}</h2><p>{["Set a geographi\
c origin for your facility; dimensions use the local map grid.", "Trace a footprint or choose a common shape, then set its dimensions.", "Add \
rooms, stairs, openings and pathways on each level.", "Adjust the camera\u2019s position and viewing volume.", "Select a camera to ins\
pect its modeled view.", "Draw a route and review proposed camera transitions.", "Mark restricted areas and define expected objects for review."][step]}</p></header>
      <div className="facility-property-body">
      {step === 0 && <label className="facility-checkbox basemap-choice"><input type="checkbox" checked={streets} disabled={!ready} onChange={(e) => {
    setStreets(e.target.checked);
    api.current?.setBasemap(e.target.checked);
  }} />Online street map<small>Sends the visible map area to OpenStreetMap. No offline tile download.</small></label>}
      {step === 0 && <SiteForm onDirtyChange={setSiteDirty} pickedOrigin={pickedOrigin} onPin={()=>startTool("site-pin")} ready={ready} plan={plan} commit={commit} center={() => api.current?.center()} />}
      {step === 0 && <OpenMapStarter units={units} drawnArea={drawnArea} onDrawArea={()=>startTool("search-area")} onCancelArea={()=>{api.current?.setTool("select");setTool("select");}} ready={ready} plan={plan} commit={commit} onPreview={(buildings,replace) => {setMapDrafts(buildings);setReplaceDrafts(!!replace);}} onArea={setSearchArea} disabled={dirty} />}
      {step === 0 && <div className="facility-section-note"><MapPin/><p>Start with an empty local grid. Set a site location or draw your first building. Saved facilities stay separate; imported files and examples open as new facilities.</p></div>}
      {step === 1 && <><div className="facility-action-row"><button className="facility-primary" disabled={!ready} onClick={() => startTool(
    "building"
  )}><Polygon />Draw building</button><button className="facility-secondary" onClick={addRectangle}><Plus />Add rectangle</button></div>
        <ShapeBuilder onDirtyChange={setShapePending} units={units} onUnits={setUnits} disabled={dirty} add={item => {
          const building = {...item,id:uid('b')};
          if(commit({...plan,buildings:[...plan.buildings,building]},'Building shape added')) {setSelected({id:building.id,kind:'building'});setFloorBuilding(building.id);setFloor(0);return true;}
          return false;
        }}/>
        <ConstructionGuide />
        {selected.kind === "building" && draft?.id === selected.id && <form noValidate onSubmit={saveSelected}>
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
      {step === 2 && <><FacilityLevels units={units} plan={plan} building={b} floor={floor} onFloor={level=>{setFloor(level);setView('floors');}} commit={commit} disabled={editingDirty} onSelect={select}/><div className="facility-action-row"><button className="facility-primary" disabled={!ready || !b} onClick={() => startTool(
    "room"
  )}><Polygon />Draw room</button><button className="facility-secondary" disabled={!b || editingDirty} onClick={addRectangularRoom}><Plus />Add rectangular room</button><button className="facility-secondary" disabled={!ready} onClick={() => startTool(
    "label"
  )}><Plus />Place label</button></div><p className="facility-caption">Choose a building and floor on the map. Modeled floors divide the occupied height above the building base evenly. Room outlines reserve walls independently of the floor surface. Labels can name doors, corridors and outdoor areas.</p><div className="facility-item-list compact">{plan.
  rooms.filter((r) => r.buildingId === b?.id && r.level === floor).map((r) => <button key={r.id} className={selected.id ===
  r.id ? "selected" : ""} onClick={() => select(r.id, "room")}><Stack /><span>{r.name}</span></button>)}{plan.labels.filter(l => !l.buildingId || l.buildingId === b?.id && l.level === floor).map(
    (l) => <button key={l.id} className={selected.id === l.id ? "selected" : ""} onClick={() => select(l.id, "label")}><MapPin /><span>{l.
    name}<small>{l.buildingId ? `Level ${l.level + 1}` : "Outdoor / ground"}</small></span></button>
  )}</div>
        {["room", "label"].includes(selected.kind) && draft?.id === selected.id && <form noValidate onSubmit={saveSelected}><Field label={selected.kind ===
  "room" ? "Room name" : "Label text"} type="text" value={draft.name} onChange={(v) => change("name", v)} />{selected.kind ===
  "room" ? <><ShapeDimensions shape={draft} onChange={setDraft} units={units}/><Field label="Room wall height" suffix="m" value={draft.wallHeight} min={0.2} max={10} onChange={(v) => change(
    "wallHeight",
    v
  )} /></> : <div className="facility-field-pair"><Field label="Label east" suffix="m" value={draft.x} min={-2e3} max={2e3} onChange={(v) => change(
    "x",
    v
  )} /><Field label="Label north" suffix="m" value={draft.y} min={-2e3} max={2e3} onChange={(v) => change("y", v)} /></div>}
  {selected.kind === "label" && <label className="facility-field"><span>Label floor</span><select aria-label="Label floor" value={draft.buildingId ? `${draft.buildingId}:${draft.level}` : "outdoor"} onChange={e => {
    const next = { ...draft }; delete next.buildingId; delete next.level;
    if (e.target.value !== "outdoor") { const [id, level] = e.target.value.split(":"); next.buildingId = id; next.level = Number(level); }
    setDraft(next);
  }}><option value="outdoor">Outdoor / ground plan · all ground views</option>{plan.buildings.flatMap(b2 => Array.from({ length: b2.floors }, (_, i) => <option value={`${b2.id}:${i}`} key={`${b2.id}:${i}`}>{b2.name} · Level {i + 1}</option>))}</select></label>}
  <button className="facility-primary" type="submit">Save {selected.
  kind}<Check /></button></form>}
        <button className="facility-secondary" onClick={() => {
    place("label", [0, 0]);
  }}>Add label at origin</button>
      </>}
      {(step === 3 || step === 4) && <>{step === 4 && coverage && <CoverageMetrics metrics={coverage} blindZone={blindZone} onBlindZone={setBlindZone} blindSpots={blindSpots} dirty={propertyDirty} units={units}/>}<div className="facility-action-row"><button className="facility-secondary" disabled={!ready} onClick={() => startTool(
    "camera"
  )}><Plus />Place camera</button><button className="facility-link" onClick={() => place("camera", [0, -20])}>Add with coordinates</button></div>
        <label className="facility-field"><span>Selected camera</span><select aria-label="Selected camera" value={selected.
  kind === "camera" ? selected.id : ""} onChange={(e) => select(e.target.value, "camera")}><option value="">Choose a camera…</option>{plan.
  cameras.map((c) => <option key={c.id} value={c.id}>{c.id} · {c.name}</option>)}</select></label>
        {selected.kind === 'camera' && draft?.id === selected.id && <>
          <div className="facility-camera-actions"><button className="facility-secondary" disabled={!ready} onClick={()=>api.current?.centerCamera(selected.id)}><Crosshair/>Center camera</button><button className="facility-secondary" disabled={!ready} onClick={()=>startTool('aim-camera')}>Aim on map</button><button className="facility-secondary" disabled={!ready} onClick={()=>startTool('move-camera')}>Move on map</button></div>
          <p className="facility-caption facility-manipulate-help">Drag the selected camera or its round heading handle on the map. With the map or a button focused, Alt+Arrow nudges 0.5 m and [ or ] rotates 5°. These change the preview only; Save camera commits.</p>
          <FacilityCameraPreview onCount={onPreviewCount} key={selected.id} camera={preview.cameras.find(c=>c.id===selected.id)} onCenter={()=>api.current?.centerCamera(selected.id)} onAim={()=>startTool('aim-camera')}/>
        </>}
        {selected.kind === "camera" && draft?.id === selected.id ? <form noValidate className="facility-camera-form" onSubmit={saveSelected}>
          <Field label="Camera name" type="text" value={draft.name} onChange={(v) => change("name", v)} />
          <Field label="Recorder channel" type="text" suffix="optional" maxLength={60} value={draft.channel ?? ''} onChange={(v) => optional("channel", v)} />

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
          <label className="facility-field"><span>Lens preset<small>typical</small></span><select aria-label="Lens preset (typical)" value={lensPreset(draft.hfov)?.id || ''} onChange={(e) => { const lens = LENS_PRESETS.find(l => l.id === e.target.value); if (lens) change("hfov", lens.hfov); }}><option value="">Custom angle</option>{LENS_PRESETS.map(l => <option key={l.id} value={l.id}>{l.label} · {l.hfov}°</option>)}</select></label>
          <Field label="Maximum viewing range" suffix="m" value={draft.range} min={1} max={300} onChange={(v) => change(
    "range",
    v
  )} />
          <Field label="Horizontal resolution" suffix="px" value={draft.pixelsWide} min={PIXELS_WIDE.min} max={PIXELS_WIDE.max} step="1" onChange={(v) => optional("pixelsWide", v)} />
          <PixelDensity camera={draft} units={units} />
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
        <button type="button" className="facility-secondary facility-installer-button" disabled={navigationDirty || !plan.cameras.length} title={navigationDirty ? 'Save or discard edits first' : undefined} onClick={downloadInstallerSheet}><Printer />Download installer sheet</button>
        <p className="facility-caption">Printable offline page of the saved plan: mounts, angles, lenses and DORI distances. {DORI_NOTE}.</p>
      </>}
      {step === 2 && <><FloorGeometry pending={linePending} onPendingChange={setLinePending} plan={plan} building={b} floor={floor} selected={selected} draft={draft} onDraft={setDraft} onSelect={select} commit={commit} onDraw={startTool} disabled={dirty} ready={ready} units={units}/><FacilityStairs plan={plan} building={b} floor={floor} selectedId={selected.kind==='stair'?selected.id:''} onSelect={id=>select(id,'stair')} commit={commit} disabled={propertyDirty || zoneDirty || linePending} units={units} onDirtyChange={setStairDirty}/></>}
      {step === 5 && <><div className="facility-action-row"><button className="facility-primary" disabled={!ready} onClick={() => startTool(
    "route"
  )}><Path />Draw route</button><button className="facility-secondary" disabled={plan.route.length < 2} onClick={() => {
    setSeconds(0);
    setPlaying(true);
  }}><Play />Run rehearsal</button></div><p className="facility-caption">Follow the route in the map and scrub the timeline. Coverage changes produce proposals for review; no identity matching is running.</p>{plan.route.length>1 && <><LineDimensions onDirtyChange={setLinePending} points={plan.route} onChange={route=>commit({...plan,route},'Route dimensions saved — Undo available')} units={units}/><p className="facility-caption">Route dimension edits save immediately. Undo restores the previous geometry.</p></>}<PointListEntry label="Route points" units={units} disabled={linePending} submitLabel={plan.route.length>1?'Replace route with these points':'Save route points'} onSubmit={route=>commit({...plan,route},'Route saved from point list — Undo available')}/><h3 className="facility-subheading">Proposed transitions</h3>{proposals.
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
  }}>Discard preview</button></div>}{propertyDirty && previewError && <p className="error facility-preview-error" role="status">Preview not shown — the map keeps the saved geometry. {localizeLengths(previewError,units)}</p>}{error && <p className="error" role="alert">{localizeLengths(error,units)}</p>}<div><button className="facility-secondary" disabled={step ===
  0} onClick={() => go(step - 1)}><CaretLeft />Back</button>{step < STEPS.length - 1 ? <button className="facility-primary" onClick={() => go(
    step + 1
  )}>Continue<CaretRight /></button> : <button disabled={dirty} className="facility-primary" onClick={() => download(
    plan
  )}>Export plan<DownloadSimple /></button>}</div></div>
    </aside><>{pasteOpen && <PlanPasteDialog close={() => setPasteOpen(false)} onImport={text=>onImportFacilities(text)} />}</><input ref={input} hidden type="file" accept=".json,application/json" aria-label="Import facility plan" onChange={importFile} />
  </section></MeasurementUnits.Provider>;
}
const percent = v => `${(Math.round(v * 1000) / 10).toFixed(1)}%`;
// Pixel density bands for the draft camera; nothing is shown until a horizontal resolution is entered.
function PixelDensity({ camera, units }) {
  const bands = doriDistances(camera);
  if (!bands) return <p className="facility-caption facility-dori-empty">{pixelsWideOK(camera?.pixelsWide) ? 'Enter a valid height, viewing angles and range to estimate pixel-density distances.' : `Enter the horizontal resolution (${PIXELS_WIDE.min}–${PIXELS_WIDE.max} px) to estimate Detect, Observe, Recognize and Identify distances.`}</p>;
  const { near, far } = groundRange(camera), d = v => formatDistance(v, units);
  return <div className="facility-dori" role="group" aria-label="Pixel density estimate">
    <p className="facility-dori-note"><WarningCircle size={15} />{DORI_NOTE}</p>
    <table><thead><tr><th>Band</th><th>≥ px/m</th><th>Slant ≤</th><th>Ground distance</th></tr></thead><tbody>{bands.map(band => <tr key={band.id}><th scope="row"><i style={{ background: band.color }} />{band.name}</th><td>{band.ppm}</td><td>{d(band.slant)}</td><td>{band.reached ? `${d(band.from)}–${d(band.to)}${band.limited ? ' · view limit' : ''}` : 'Not reached'}</td></tr>)}</tbody></table>
    <p className="facility-caption">Slant d = width ÷ (2 · px/m · tan(HFOV ÷ 2)); ground distance √(d² − height²), clipped to the {d(near)}–{d(Math.max(near, far))} ground view. About {Math.round(densityAtGround(camera, far))} px/m at the far ground limit. IEC 62676-4 figures used as planning thresholds; colored arcs on the map mark each limit.</p>
  </div>;
}
function CoverageMetrics({ metrics, blindZone, onBlindZone, blindSpots, dirty, units }) {
  const shown = metrics.zones.find(z => z.id === blindZone && z.estimated);
  return <section className="facility-coverage-metrics" aria-label="Estimated coverage metrics"><h3 className="facility-subheading">Estimated coverage</h3>
    {metrics.zones.length || metrics.route ? <table><thead><tr><th>Area</th><th>Coverage<small>≥1 camera</small></th><th>Overlap<small>≥2 cameras</small></th><th aria-label="Blind-spot overlay" /></tr></thead><tbody>
      {metrics.zones.map(z => <tr key={z.id}><th scope="row">{z.name}<small>{z.type === 'object_watch' ? 'Object watch' : 'Restricted'}{z.estimated ? '' : ' · indoor'}</small></th>{z.estimated ? <><td>{percent(z.coverage)}</td><td>{percent(z.overlap)}</td><td><button type="button" className="facility-blind-toggle" aria-pressed={blindZone === z.id} aria-label={`Blind spots for ${z.name}`} onClick={() => onBlindZone(blindZone === z.id ? '' : z.id)}>Blind spots</button></td></> : <td colSpan={3} className="facility-not-estimated">Not estimated · ground-plane only</td>}</tr>)}
      {metrics.route && <tr><th scope="row">Handoff route<small>{formatDistance(metrics.route.length, units)} · {metrics.route.samples} samples</small></th><td>{percent(metrics.route.coverage)}</td><td>{percent(metrics.route.overlap)}</td><td /></tr>}
    </tbody></table> : <p className="facility-caption">Add an enabled outdoor zone (step 7) or a handoff route (step 6) to estimate coverage.</p>}
    {shown && blindSpots && <p className="facility-caption" role="status">{blindSpots.length ? `Map shows uncovered sample cells in ${shown.name} (cells about ${formatDistance(shown.cell, units)}).` : `No uncovered sample cells in ${shown.name}.`}</p>}
    <p className="facility-caption">Grid sample of up to {MAX_COVERAGE_CELLS.toLocaleString('en-US')} cells per zone, and about every {formatDistance(.5, units)} along the route, tested against the drawn ground fans of {metrics.cameras} included {metrics.cameras === 1 ? 'camera' : 'cameras'}. {dirty ? 'Includes the unsaved camera preview. ' : ''}Indoor and level zones are not estimated because coverage is ground-plane only. Planning estimate; verify on site.</p>
  </section>;
}
function SiteForm({ plan, commit, center, pickedOrigin, onPin, ready, onDirtyChange }) {
  const [name, setName] = useState(plan.name), [lng, setLng] = useState(plan.origin[0]), [lat, setLat] = useState(plan.origin[1]);
  const [locating, setLocating] = useState(false), [locationNote, setLocationNote] = useState("");
  const mapped = plan.buildings.some(b => b.source), [keep, setKeep] = useState(mapped), [formError, setFormError] = useState("");
  const hasGeometry = plan.buildings.length || plan.cameras.length || plan.labels.length || plan.zones?.length || plan.route.length;
  const locationRequest = useRef(0);
  const changed=name!==plan.name || lng!==plan.origin[0] || lat!==plan.origin[1];
  useEffect(()=>{onDirtyChange(changed);return()=>onDirtyChange(false);},[changed,onDirtyChange]);
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
      setLocationNote("Suggested device position only." + accuracy + " Confirm this is your facility before saving.");
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
    setKeep(plan.buildings.some(b => b.source));
    setFormError("");
  }, [plan]);
  return <><button type="button" className="facility-secondary" disabled={!ready} onClick={onPin}>Pick site on map</button><AddressSearch onChoose={p=>{locationRequest.current++;setLocating(false);setLng(+p.origin[0].toFixed(7));setLat(+p.origin[1].toFixed(7));setLocationNote('Suggested: '+p.label+'. Review before saving. Existing plan positions remain unchanged until Save site.');}} /><form onSubmit={(e) => {
    e.preventDefault();
    const moved = lng !== plan.origin[0] || lat !== plan.origin[1];
    let next = { ...plan, name, origin: [lng, lat] };
    if (moved && keep && hasGeometry) {
      try { next = { ...reoriginPlan(plan, [lng, lat]), name }; } catch (x) { setFormError(x.message); return; }
    }
    setFormError("");
    if (commit(next, moved && keep && hasGeometry ? "Site origin saved — buildings and cameras kept their map positions" : "Site origin saved — choose an area and review building outlines below")) center();
  }}><button type="button" className="facility-secondary" disabled={locating} onClick={locate}>{locating ? "Finding location…" : "Use my location"}</button>
  {locating && <button type="button" className="facility-secondary" onClick={() => { locationRequest.current++; setLocating(false); setLocationNote("Location suggestion cancelled. Enter site coordinates below."); }}>Cancel location</button>}
  <p className="facility-caption">Uses your browser’s location service once, only when requested. Review the suggestion before Save site. This does not find building outlines.</p>
  {locationNote && <p className="facility-caption" role="status">{locationNote}</p>}
  <Field label="Facility name" type="text" value={name} onChange={setName} /><Field label="Latitude" value={lat} min={-80} max={80} onChange={setLat} /><Field label="Longitude" value={lng} min={-180} max={180} onChange={setLng} />
  {!!hasGeometry && <label className="facility-checkbox"><input type="checkbox" checked={keep} onChange={e=>setKeep(e.target.checked)} />Keep buildings at their map positions<small>{mapped ? 'On by default because this plan has map-sourced buildings.' : 'Off by default for hand-drawn plans.'}</small></label>}
  <p className="facility-caption">Building and camera positions are meters east and north of this origin. {hasGeometry && keep ? 'Saving a new origin re-centres the local grid; buildings, cameras, zones and routes keep their map positions and dimensions.' : 'Changing the origin moves the whole plan geographically.'} This is a local planning coordinate system, not a surveyed model.</p>{formError && <p className="error" role="alert">{formError}</p>}<button className="facility-primary" type="submit" disabled={locating}>Save site<Check /></button>{changed && <button type="button" className="facility-secondary" onClick={()=>{setName(plan.name);setLng(plan.origin[0]);setLat(plan.origin[1]);setLocationNote('');setFormError('');}}>Discard site edits</button>}</form></>;
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
  return <dialog aria-labelledby="facility-import-title" className="modal facility-paste-modal" ref={ref} onCancel={close} {...backdropDismiss(close)}><div className="modal-heading"><h2 id="facility-import-title">Import facility JSON</h2><button className="icon-button" onClick={close} aria-label="Close JSON import"><X /></button></div><p>Paste an exported facility plan. Only validated geometry and labels are retained. Maximum 4 MB for a facility collection, 2 MB per facility. Import adds separate facilities and keeps existing work.</p><form onSubmit={(e) => {
    e.preventDefault();
    try {
      if (onImport(text)) close();
    } catch (e2) {
      setError(e2.message);
    }
  }}><label className="facility-field"><span>Facility plan JSON</span><textarea autoFocus aria-label="Facility plan JSON" value={text} onChange={(e) => setText(
  e.target.value)} maxLength={4e6} required rows={9} spellCheck={false} /></label>{error && <p className="error" role="alert">{error}</p>}<div className="facility-paste-actions"><button className="facility-secondary" type="button" onClick={close}>Cancel</button><button className="facility-primary" type="submit">Import pasted plan<UploadSimple /></button></div></form></dialog>;
}
export {
  FacilityBuilder
};
