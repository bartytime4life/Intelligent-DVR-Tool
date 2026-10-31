import { Map, NavigationControl, ScaleControl, AttributionControl, Marker, MercatorCoordinate, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import * as THREE from "three";
import { TerraDraw, TerraDrawPolygonMode, TerraDrawLineStringMode } from "./vendor/terra-draw.mjs";
import { TerraDrawMapLibreGLAdapter } from "./vendor/terra-maplibre.mjs";
import { centroid, toLngLat, fromLngLat, coverageFan, wallObstacles, buildingFeature, floorSlabRings, ceilingOpenings } from "./facility.mjs";
import { stairDimensions, stairFootprint, stairTreadPolygons } from "./facility-stairs.mjs";
import { measurementLabels, lineRibbonSegments, floorRenderPlan, floorElevation, visibleLabelIndices, formatDistance } from "./facility-measurements.mjs";
import { fanCache } from "./facility-coverage.mjs";
import { doriArcs } from "./facility-dori.mjs";
import "./facility-map-geometry.css";
setWorkerUrl(workerUrl);
const fc = (features) => ({ type: "FeatureCollection", features });
const feat = (type, coordinates, properties = {}) => ({ type: "Feature", geometry: { type, coordinates }, properties });
const polygon = (ring, origin, props) => feat("Polygon", [ring.map((p) => toLngLat(p, origin))], props);
const empty = () => fc([]);
// Placing labels is overhead too; in the Floors view the active slab is flattened so a click lands where it appears.
const FLOOR_DRAW_TOOLS = ["room", "opening", "floor-path", "label"];
const OVERHEAD_TOOLS = ["building", "room", "zone", "opening", "route", "floor-path", "search-area", "site-pin", "camera", "aim-camera", "move-camera", "label"];
const viewPitch = (view, tool) => view === "2d" || OVERHEAD_TOOLS.includes(tool) ? 0 : 52;
// MapLibre's mercator metre uses a 6,371,008.8 m sphere; plan coordinates use 111,320 m per degree.
const PLAN_METRE_SCALE = 2 * Math.PI * 6371008.8 / 360 / 111320;
const PICK_LAYERS = ["cameras", "zones", "openings", "stairs", "stair-steps", "floor-paths", "rooms", "room-areas", "floor-slabs", "ghost-envelope", "buildings"];
const BACKGROUND_LAYERS = ["floor-slabs", "ghost-envelope", "buildings"];
const headingTip = c => { const a = c.bearing * Math.PI / 180, l = Math.min(c.range, 12); return [c.x + Math.sin(a) * l, c.y + Math.cos(a) * l]; };
const cm = v => Math.round(v * 100) / 100;
function structureBuilding(plan, selected, view, options) {
  if (view === "2d") return undefined;
  const owner = [...plan.rooms, ...(plan.openings || []), ...(plan.stairs || []), ...(plan.paths || [])].find(item => item.id === selected);
  const id = view === "floors" ? options.floorBuildingId : plan.buildings.some(b => b.id === selected) ? selected : owner?.buildingId;
  return plan.buildings.find(building => building.id === id);
}
function floorSlabFeature(plan, building, level, origin, selected, flattened = false) {
  const elevation = floorElevation(building, level, flattened);
  const rings = floorSlabRings(plan, building.id, level);
  if (!rings.length) return null;
  return feat("Polygon", rings.map(ring => ring.map(point => toLngLat(point, origin))), {
    id: building.id, selected: building.id === selected, level,
    base: Math.max(0, elevation - .12), top: elevation + .02,
  });
}
function visibleStairs(plan, selected, view, floor, options) {
  const building = structureBuilding(plan, selected, view, options);
  if (!building) return [];
  return (plan.stairs || []).filter(stair => stair.buildingId === building.id &&
    (view === "3d" || (view === "floors" && (stair.fromLevel === floor || stair.toLevel === floor))));
}
function disposeGroup(group) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
    });
  }
}
class CameraVolumes {
  constructor() {
    this.id = "facility-volumes";
    this.type = "custom";
    this.renderingMode = "3d";
    this.group = new THREE.Group();
  }
  onAdd(map, gl) {
    this.map = map;
    this.scene = new THREE.Scene();
    this.scene.add(this.group);
    this.camera = new THREE.Camera();
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
  }
  update(plan, selected, view, floor, options = {}) {
    disposeGroup(this.group);
    this.origin = MercatorCoordinate.fromLngLat(plan.origin, 0);
    const unit = this.origin.meterInMercatorCoordinateUnits() * PLAN_METRE_SCALE;
    this.model = new THREE.Matrix4().makeTranslation(this.origin.x, this.origin.y, this.origin.z).scale(new THREE.Vector3(
      unit,
      -unit,
      unit
    ));
    if (view === "2d") return;
    const c = plan.cameras.find((c2) => c2.id === selected);
    if (c?.enabled) {
      const fan = options.fanOf ? options.fanOf(c) : coverageFan(c, wallObstacles(plan));
      const half = (fan.length - 1) / 2;
      if (half > 1) {
        const positions = [];
        for (let i = 0; i < half - 1; i++) positions.push(c.x, c.y, c.z, ...fan[i], 0.12, ...fan[i + 1], 0.12);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geo.computeVertexNormals();
        this.group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
          color: 3530979,
          transparent: true,
          opacity: 0.12,
          side: THREE.DoubleSide,
          depthWrite: false
        })));
        const lines = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(c.x, c.y, c.z), new THREE.Vector3(
          ...fan[0],
          0.12
        ), new THREE.Vector3(...fan[half - 1], 0.12), new THREE.Vector3(c.x, c.y, c.z)]);
        this.group.add(new THREE.Line(lines, new THREE.LineBasicMaterial({ color: 6155245, transparent: true, opacity: 0.8 })));
      }
    }
    // A floor n slab is also the ceiling above floor n-1. Its opening is
    // drawn once at that elevation; it never cuts the entire building envelope.
    const floorBuilding = structureBuilding(plan, selected, view, options);
    if (floorBuilding) {
      const base = floorBuilding.base || 0, rise = (floorBuilding.height - base) / floorBuilding.floors;
      const flattened = options.floorDrawing;
      const levels = flattened ? [floor] : view === "floors" ? [floor, Math.min(floor + 1, floorBuilding.floors)] : Array.from({length: floorBuilding.floors + 1}, (_,level) => level);
      for (const level of levels.filter(level => !(floorBuilding.openFloors || []).includes(level))) for (const ring of [floorBuilding.footprint, ...(floorBuilding.holes || [])]) {
        const geometry = new THREE.BufferGeometry().setFromPoints(ring.map(([x,y]) => new THREE.Vector3(x,y,floorElevation(floorBuilding,level,flattened) + .035)));
        this.group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({color: level === floor ? 0x70e3d2 : 0x8ba1b8, transparent: true, opacity: .7, depthTest: true})));
      }
      const openings = (plan.openings || []).filter(opening => opening.buildingId === floorBuilding.id && !(floorBuilding.openFloors || []).includes(opening.level) && (view === "3d" || opening.level === floor));
      const ceilings = view === "floors" && !flattened ? ceilingOpenings(plan, floorBuilding.id, floor) : [];
      for (const opening of [...openings, ...ceilings]) {
        const geometry = new THREE.BufferGeometry().setFromPoints(opening.footprint.map(([x,y]) => new THREE.Vector3(x,y,floorElevation(floorBuilding,opening.level,flattened) + .045)));
        const material = new THREE.LineDashedMaterial({color: 0xef94ee, transparent: true, opacity: opening.level === floor || view === "3d" ? 1 : .6, dashSize: .65, gapSize: .4, depthTest: true});
        const line = new THREE.Line(geometry, material); line.computeLineDistances(); this.group.add(line);
      }
    }
    for (const stair of options.floorDrawing ? [] : visibleStairs(plan, selected, view, floor, options).sort((a,b)=>Number(b.id===selected)-Number(a.id===selected)).slice(0,24)) {
      const building = plan.buildings.find(b => b.id === stair.buildingId);
      const metrics = stairDimensions(stair,building), angle = stair.bearing * Math.PI / 180;
      const along = [Math.sin(angle),Math.cos(angle)], across = [Math.cos(angle),-Math.sin(angle)];
      const tip = metrics.length * .38, wing = Math.min(.7,stair.width * .35);
      const point = (d,w,z) => new THREE.Vector3(stair.x+along[0]*d+across[0]*w,stair.y+along[1]*d+across[1]*w,z);
      const geometry = new THREE.BufferGeometry().setFromPoints([point(-tip,0,metrics.base+.12),point(tip,0,metrics.top+.12),point(tip-wing,wing,metrics.top+.12),point(tip,0,metrics.top+.12),point(tip-wing,-wing,metrics.top+.12)]);
      this.group.add(new THREE.Line(geometry,new THREE.LineBasicMaterial({color:0xd7f4ff,transparent:true,opacity:.9})));
    }
    this.map?.triggerRepaint();
  }
  render(gl, options) {
    if (!this.model) return;
    this.camera.projectionMatrix.fromArray(options.defaultProjectionData.mainMatrix).multiply(this.model);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    this.renderer.resetState();
  }
  onRemove() {
    disposeGroup(this.group);
    this.renderer?.dispose();
  }
}
// options.fans shares the fan cache with coverage metrics so both use the same drawn fans.
function createFacilityMap(container, callbacks, initialPlan, options = {}) {
  const map = new Map({
    container,
    center: initialPlan.origin,
    zoom: 18.3,
    pitch: 52,
    bearing: 0,
    attributionControl: false,
    renderWorldCopies: false,
    maxPitch: 65,
    maxZoom: 22,
    minZoom: 14,
    style: { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#0d\
2029" } }] }
  });
  let attribution = new AttributionControl({ compact: false }), hasOsm = false;
  map.addControl(attribution, "bottom-right");
  const osmCredit = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> · ODbL';
  map.addControl(new NavigationControl({ visualizePitch: true }), "bottom-right");
  const scaleControl = new ScaleControl({ unit: "metric" });
  map.addControl(scaleControl, "bottom-left");
  const volumes = new CameraVolumes(), fans = options.fans || fanCache();
  let draw, ready = false, suppressSelection = false, current = initialPlan, selected = "C-07", view = "3d", floor = 0, tool = "\
select", markers = [];
  let displayOptions = {measurements: true, units: "metric", floorBuildingId: null};
  let labelRecords = [], labelFrame = null, markerKey = "";
  // Direct manipulation of the selected camera: drag state, the rotate handle and markers that follow a drag.
  let fanOf = null, volumeOptions = null, drag = null, handle = null, cameraLabel = null, doriLabels = [];
  function declutterLabels() {
    labelFrame = null;
    const visible = visibleLabelIndices(labelRecords.map(record => ({priority:record.priority,keep:record.keep,rect:record.element.getBoundingClientRect()})));
    labelRecords.forEach((record,index) => {
      record.element.style.visibility = visible.has(index) ? "visible" : "hidden";
      record.element.setAttribute("aria-hidden", visible.has(index) ? "false" : "true");
    });
  }
  function scheduleLabels() { if (labelFrame === null) labelFrame = requestAnimationFrame(declutterLabels); }
  function trackLabel(element, priority, keep = false) {
    element.style.visibility = "hidden";
    labelRecords.push({element,priority,keep});
  }
  map.on("move", scheduleLabels);
  map.on("resize", scheduleLabels);
  map.on("rotate", () => callbacks.onBearing?.((map.getBearing() + 360) % 360));
  map.on("error", (e) => callbacks.onError(e.error?.message || "Map rendering error."));
  map.on("webglcontextlost", () => callbacks.onError("3D graphics were interrupted. Save or export the plan, then reload\
 to recover."));
  map.on("load", () => {
    const sources = ["grid", "site", "buildings", "rooms", "room-areas", "coverage", "cameras", "route", "track", "search-area", "zones", "camera-heading", "floor-slabs", "ghost-envelope", "openings", "stairs", "stair-steps", "stair-heading", "floor-paths", "blind-spots", "dori-arcs"];
    for (const id of sources) map.addSource(id, { type: "geojson", data: empty() });
    map.addLayer({ id: "grid", type: "line", source: "grid", paint: { "line-color": "#36505c", "line-opacity": 0.26, "li\
ne-width": 0.6 } });
    map.addLayer({ id: "site", type: "fill", source: "site", paint: { "fill-color": "#1b323c", "fill-opacity": 0.8 } });
    map.addLayer({ id: "site-edge", type: "line", source: "site", paint: { "line-color": "#607a83", "line-width": 1, "li\
ne-dasharray": [3, 4] } });
    map.addLayer({id:'search-area',type:'line',source:'search-area',paint:{'line-color':'#ffbd45','line-width':2,'line-dasharray':[4,2]}});
    map.addLayer({ id: "coverage", type: "fill", source: "coverage", paint: { "fill-color": [
      "case",
      ["get", "selected"],
      "#35e0e3",
      "#258ea0"
    ], "fill-opacity": ["case", ["get", "selected"], 0.22, 0.055] } });
    map.addLayer({ id: "coverage-edge", type: "line", source: "coverage", paint: {
      "line-color": "#39d2da",
      "line-width": 1,
      "line-opacity": 0.7
    } });
    map.addLayer({ id: "buildings", type: "fill-extrusion", source: "buildings", paint: { "fill-extrusion-color": [
      "case",
      ["get", "selected"],
      "#648894",
      "#405661"
    ], "fill-extrusion-height": ["get", "top"], "fill-extrusion-base": ["get", "base"], "fill-extrusion-opacity": 0.96, "fill-extrusio\
n-vertical-gradient": true } });
    map.addLayer({id: "ghost-envelope", type: "fill-extrusion", source: "ghost-envelope", paint: {
      "fill-extrusion-color": "#78929e", "fill-extrusion-height": ["get", "top"], "fill-extrusion-base": ["get", "base"], "fill-extrusion-opacity": .12,
    }});
    map.addLayer({id: "floor-slabs", type: "fill-extrusion", source: "floor-slabs", paint: {
      "fill-extrusion-color": ["case", ["get", "active"], "#608a94", "#334f5e"], "fill-extrusion-height": ["get", "top"], "fill-extrusion-base": ["get", "base"], "fill-extrusion-opacity": .97,
    }});
    map.addLayer({ id: "building-edge", type: "line", source: "buildings", paint: {
      "line-color": "#72bec7",
      "line-width": 1.3,
      "line-opacity": 0.8
    } });
    // A faint floor surface inside each room makes room interiors selectable, not only their walls.
    map.addLayer({id: "room-areas", type: "fill-extrusion", source: "room-areas", paint: {
      "fill-extrusion-color": "#6b9397", "fill-extrusion-base": ["get", "base"], "fill-extrusion-height": ["get", "top"], "fill-extrusion-opacity": .04,
    }});
    map.addLayer({ id: "rooms", type: "fill-extrusion", source: "rooms", paint: { "fill-extrusion-color": "#6b9397", "fi\
ll-extrusion-base": ["get", "base"], "fill-extrusion-height": ["get", "top"], "fill-extrusion-opacity": 0.55 } });
    map.addLayer({id: "stairs", type: "fill", source: "stairs", paint: {"fill-color": "#80c9ee", "fill-opacity": .09}});
    map.addLayer({id: "stair-steps", type: "fill-extrusion", source: "stair-steps", paint: {
      "fill-extrusion-color": ["case", ["get", "selected"], "#9addfb", "#6597b2"], "fill-extrusion-base": ["get", "base"], "fill-extrusion-height": ["get", "top"], "fill-extrusion-opacity": .95,
    }});
    map.addLayer({id: "stair-edge", type: "line", source: "stairs", paint: {"line-color": "#9addfb", "line-width": 1.5}});
    map.addLayer({id: "stair-heading", type: "line", source: "stair-heading", paint: {"line-color": "#d7f4ff", "line-width": 2}});
    // A very faint hit surface preserves map selection inside the actual slab hole.
    map.addLayer({id: "openings", type: "fill-extrusion", source: "openings", paint: {
      "fill-extrusion-color": "#ef94ee", "fill-extrusion-base": ["get", "base"], "fill-extrusion-height": ["get", "top"], "fill-extrusion-opacity": .065,
    }});
    map.addLayer({id: "floor-paths", type: "fill-extrusion", source: "floor-paths", paint: {
      "fill-extrusion-color": ["case", ["get", "selected"], "#fff2a8", "#f1cc64"], "fill-extrusion-base": ["get", "base"], "fill-extrusion-height": ["get", "top"], "fill-extrusion-opacity": .95,
    }});
    map.addLayer({id: "zones", type: "fill-extrusion", source: "zones", paint: {
      "fill-extrusion-color": ["case", ["!", ["get", "enabled"]], "#81919e", ["==", ["get", "type"], "object_watch"], "#f3b65d", "#f27782"],
      "fill-extrusion-base": ["get", "base"], "fill-extrusion-height": ["get", "top"],
      "fill-extrusion-opacity": .3,
    }});
    map.addLayer({id: "zone-edge", type: "line", source: "zones", filter: ["==", ["get", "base"], 0], paint: {
      "line-color": ["case", ["!", ["get", "enabled"]], "#81919e", ["==", ["get", "type"], "object_watch"], "#f3b65d", "#f27782"],
      "line-width": ["case", ["get", "selected"], 3, 1.5], "line-dasharray": [3, 2],
    }});
    map.addLayer({id: "blind-spots", type: "fill", source: "blind-spots", paint: {"fill-color": "#ff5d73", "fill-opacity": .34}});
    map.addLayer({id: "blind-spots-edge", type: "line", source: "blind-spots", paint: {"line-color": "#ff8a9a", "line-width": .6, "line-opacity": .7}});
    map.addLayer({id: "dori-arcs", type: "line", source: "dori-arcs", paint: {"line-color": ["get", "color"], "line-width": 2, "line-opacity": .9}});
    map.addLayer({id: "camera-heading", type: "line", source: "camera-heading", paint: {"line-color": "#9bfff0", "line-width": 2, "line-dasharray": [2,2]}});
    map.addLayer(volumes);
    map.addLayer({ id: "route", type: "line", source: "route", paint: { "line-color": "#ffc15a", "line-width": 3, "line-\
dasharray": [2, 2] } });
    map.addLayer({ id: "cameras", type: "circle", source: "cameras", paint: { "circle-radius": ["case", ["get", "selecte\
d"], 8, 5], "circle-color": ["case", ["get", "enabled"], "#35e0e3", "#6c8493"], "circle-stroke-color": "#09222d", "circl\
e-stroke-width": 2 } });
    map.addLayer({ id: "track", type: "circle", source: "track", paint: {
      "circle-radius": 8,
      "circle-color": "#ffbc3c",
      "circle-stroke-color": "#fff3d1",
      "circle-stroke-width": 2
    } });
    draw = new TerraDraw({ adapter: new TerraDrawMapLibreGLAdapter({ map, coordinatePrecision: 8 }), modes: [new TerraDrawPolygonMode(
      { styles: { fillColor: "#35e0e3", fillOpacity: 0.15, outlineColor: "#35e0e3" } }
    ), new TerraDrawLineStringMode({ styles: {
      lineStringColor: "#ffbc3c",
      lineStringWidth: 3
    } })] });
    draw.start();
    draw.setMode("static");
    draw.on("finish", (id) => {
      suppressSelection = true;
      queueMicrotask(() => {
        const f = draw.getSnapshotFeature(id);
        if (!f) { suppressSelection = false; return; }
        const geometry = f.geometry.type === "Polygon" ? f.geometry.coordinates[0] : f.geometry.coordinates;
        const stale = draw.getSnapshot().filter((x) => x.id !== id && x.geometry.type !== "Point").map((x) => x.id);
        if (stale.length) draw.removeFeatures(stale);
        // A rejected outline stays visible and the tool stays active, so it can be redrawn beside it.
        if (callbacks.onDraw(tool, geometry.map((p) => fromLngLat(p, current.origin))) === false) {
          requestAnimationFrame(() => { suppressSelection = false; });
          return;
        }
        draw.clear();
        draw.setMode("static");
        tool = "select";
        callbacks.onToolDone();
        update(current, selected, view, floor, displayOptions);
        map.getCanvas().style.cursor = "";
        requestAnimationFrame(() => {
          suppressSelection = false;
        });
      });
    });
    ready = true;
    update(current, selected, view, floor, displayOptions);
    callbacks.onBearing?.((map.getBearing() + 360) % 360);
    fitPlan(false);
    callbacks.onReady();
  });
  map.on("click", (e) => {
    if (!ready || suppressSelection) return;
    if (tool === 'site-pin') {
      callbacks.onPin([e.lngLat.lng,e.lngLat.lat]); tool='select';callbacks.onToolDone();map.getCanvas().style.cursor='';return;
    }
    if (tool === "aim-camera" || tool === "move-camera") {
      const point = fromLngLat([e.lngLat.lng, e.lngLat.lat], current.origin);
      if (tool === "aim-camera") callbacks.onAim?.(point); else callbacks.onMoveCamera?.(point);
      tool = "select";
      callbacks.onToolDone();
      map.getCanvas().style.cursor = "";
      return;
    }
    if (tool === "camera" || tool === "label") {
      callbacks.onPlace(tool, fromLngLat([e.lngLat.lng, e.lngLat.lat], current.origin));
      tool = "select";
      callbacks.onToolDone();
      map.getCanvas().style.cursor = "";
      return;
    }
    if (tool !== "select") return;
    // Building envelopes and slabs are large backdrops; any specific item under the pointer wins.
    const hits = map.queryRenderedFeatures(e.point, { layers: PICK_LAYERS });
    const hit = hits.find(h => !BACKGROUND_LAYERS.includes(h.layer.id)) || hits[0];
    if (hit) callbacks.onSelect(hit.properties.id, hit.layer.id === "cameras" ? "camera" : hit.layer.id === "zones" ? "zone" : hit.layer.id === "openings" ? "opening" : hit.layer.id === "floor-paths" ? "path" : ["stairs", "stair-steps"].includes(hit.layer.id) ? "stair" : ["rooms", "room-areas"].includes(hit.layer.id) ? "room" : "building");
  });
  // Only the selected camera can be dragged, and only while the editor enables manipulation.
  const cameraHit = (point, radius) => ready && !drag && tool === "select" && !!displayOptions.manipulate &&
    map.queryRenderedFeatures([[point.x - radius, point.y - radius], [point.x + radius, point.y + radius]], {layers: ["cameras"]}).some(f => f.properties.id === selected);
  map.on("mousedown", (e) => { if (e.originalEvent.button === 0 && cameraHit(e.point, 7)) { e.preventDefault(); begin("move", e.originalEvent); } });
  map.on("touchstart", (e) => { if (e.originalEvent.touches.length === 1 && cameraHit(e.point, 16)) { e.preventDefault(); begin("move", e.originalEvent.touches[0]); } });
  map.on("mousemove", (e) => { if (!drag && tool === "select" && displayOptions.manipulate && ready) map.getCanvas().style.cursor = cameraHit(e.point, 7) ? "move" : ""; });
  // A drag previews through setData only; release reports one point and the editor updates its unsaved draft.
  function begin(kind, start) {
    const cam = current.cameras.find(c => c.id === selected);
    if (!ready || drag || !cam) return;
    map.dragPan.disable();
    const at = p => { const r = map.getCanvasContainer().getBoundingClientRect(), l = map.unproject([p.clientX - r.left, p.clientY - r.top]); return fromLngLat([l.lng, l.lat], current.origin); };
    const paint = () => {
      drag.frame = null;
      renderCameras(current, drag.preview);
      if (volumeOptions) volumes.update({...current, cameras: current.cameras.map(c => c.id === cam.id ? drag.preview : c)}, selected, view, floor, volumeOptions);
      if (kind === "move") cameraLabel?.setLngLat(toLngLat([drag.preview.x, drag.preview.y], current.origin));
    };
    const move = (e) => {
      const p = e.touches ? e.touches[0] : e;
      if (!drag || !p) return;
      if (e.cancelable) e.preventDefault();
      if (!drag.moved && Math.hypot(p.clientX - drag.start[0], p.clientY - drag.start[1]) < 3) return;
      const point = at(p), dx = point[0] - cam.x, dy = point[1] - cam.y;
      if (kind === "rotate" && Math.hypot(dx, dy) < .05) return;
      if (!drag.moved) { drag.moved = true; for (const el of doriLabels) el.style.visibility = "hidden"; callbacks.onCameraDrag?.(kind, true); }
      drag.point = point;
      drag.preview = kind === "move" ? {...cam, x: cm(point[0]), y: cm(point[1])} : {...cam, bearing: Math.min(359.99, cm((Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360))};
      if (drag.frame === null) drag.frame = requestAnimationFrame(paint);
    };
    const finish = (accept) => {
      document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up);
      document.removeEventListener("touchmove", move); document.removeEventListener("touchend", up); document.removeEventListener("touchcancel", cancel);
      document.removeEventListener("keydown", key, true);
      const done = drag;
      drag = null;
      if (done.frame !== null) cancelAnimationFrame(done.frame);
      map.dragPan.enable();
      suppressSelection = true;
      requestAnimationFrame(() => { suppressSelection = false; });
      if (!done.moved) return;
      const kept = accept && (done.kind === "move" ? callbacks.onMoveCamera?.(done.point) : callbacks.onAim?.(done.point)) !== false;
      callbacks.onCameraDrag?.(done.kind, false);
      if (!kept) { renderCameras(current); if (volumeOptions) volumes.update(current, selected, view, floor, volumeOptions); cameraLabel?.setLngLat(toLngLat([cam.x, cam.y], current.origin)); }
      scheduleLabels();
    };
    const up = () => finish(true), cancel = () => finish(false);
    const key = (e) => { if (e.key === "Escape") { e.stopPropagation(); cancel(); } };
    drag = {kind, start: [start.clientX, start.clientY], moved: false, point: null, preview: null, frame: null, cancel};
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
    document.addEventListener("touchmove", move, {passive: false}); document.addEventListener("touchend", up); document.addEventListener("touchcancel", cancel);
    document.addEventListener("keydown", key, true);
  }
  function handleElement() {
    const el = document.createElement("span");
    el.className = "facility-rotate-handle";
    el.title = "Drag to aim this camera \u00b7 [ and ] rotate 5\u00b0";
    el.setAttribute("aria-hidden", "true");
    el.addEventListener("mousedown", (e) => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); begin("rotate", e); });
    el.addEventListener("touchstart", (e) => { if (e.touches.length !== 1) return; e.preventDefault(); e.stopPropagation(); begin("rotate", e.touches[0]); }, {passive: false});
    el.addEventListener("click", (e) => e.stopPropagation());
    return el;
  }
  let handleShown = false;
  // Cameras, their fans, the heading line, DORI arcs and the rotate handle; `moved` replaces one camera during a drag.
  function renderCameras(plan, moved = null) {
    const o = plan.origin, cameras = moved ? plan.cameras.map(c => c.id === moved.id ? moved : c) : plan.cameras, cam = cameras.find(c => c.id === selected);
    map.getSource("coverage").setData(fc(cameras.filter((c) => c.enabled || c.id === selected).map((c) => ({ c, fan: fanOf(c) })).filter((x) => x.fan.
    length > 3).map(({ c, fan }) => polygon(fan, o, { selected: c.id === selected }))));
    map.getSource("cameras").setData(fc(cameras.map((c) => feat("Point", toLngLat([c.x, c.y], o), { id: c.id, selected: c.
    id === selected, enabled: c.enabled }))));
    map.getSource("camera-heading").setData(fc(cam ? [feat("LineString", [toLngLat([cam.x, cam.y], o), toLngLat(headingTip(cam), o)])] : []));
    map.getSource("dori-arcs").setData(fc(cam?.enabled ? doriArcs(cam, fanOf(cam)).flatMap(arc => arc.lines.map(line => feat("LineString", line.map(p => toLngLat(p, o)), {band: arc.id, color: arc.color}))) : []));
    const show = !!(displayOptions.manipulate && cam && tool === "select");
    if (show) {
      handle ||= new Marker({element: handleElement(), anchor: "center"});
      handle.setLngLat(toLngLat(headingTip(cam), o));
      if (!handleShown) handle.addTo(map);
    } else if (handleShown) handle.remove();
    handleShown = show;
    return cam;
  }
  function update(plan, selection, mode, level, options = {}) {
    displayOptions = {...displayOptions, ...options};
    const originChanged = current.origin[0] !== plan.origin[0] || current.origin[1] !== plan.origin[1];
    current = plan;
    selected = selection;
    const levelBuilding = plan.buildings.find(building => building.id === displayOptions.floorBuildingId);
    floor = Number.isInteger(level) ? Math.max(0, Math.min(level, levelBuilding ? levelBuilding.floors - 1 : 39)) : 0;
    const modeChanged = view !== mode;
    view = mode;
    if (!ready) return;
    scaleControl.setUnit(displayOptions.units === "imperial" ? "imperial" : "metric");
    if (originChanged) map.jumpTo({ center: plan.origin });
    if (modeChanged) {
      map.easeTo({ pitch: viewPitch(mode, tool), duration: 350 });
    }
    const o = plan.origin, grid = [];
    for (let n = -300; n <= 300; n += 20) {
      grid.push(feat("LineString", [toLngLat([n, -300], o), toLngLat([n, 300], o)]));
      grid.push(feat("LineString", [toLngLat([-300, n], o), toLngLat([300, n], o)]));
    }
    map.getSource("grid").setData(fc(grid));
    map.getSource("site").setData(fc([]));
    const inspectedBuilding = structureBuilding(plan, selected, mode, displayOptions);
    const floorPresentation = floorRenderPlan(inspectedBuilding,floor,mode,FLOOR_DRAW_TOOLS.includes(tool));
    const floorDrawing = floorPresentation.flattened;
    const normalBuildings = plan.buildings.filter(building => building.id !== inspectedBuilding?.id);
    map.getSource("buildings").setData(fc(normalBuildings.map(b => buildingFeature(b,o,{id:b.id,selected:b.id===selected,
      base:mode==='2d'?0:(b.base || 0), top:mode==='2d'?0:b.height}))));
    map.getSource("ghost-envelope").setData(fc(inspectedBuilding && !floorDrawing ? [buildingFeature(inspectedBuilding,o,{id: inspectedBuilding.id,base:inspectedBuilding.base || 0,top:inspectedBuilding.height})] : []));
    const slabLevels = floorPresentation.slabLevels;
    map.getSource("floor-slabs").setData(fc(slabLevels.map(level => {
      const feature = floorSlabFeature(plan,inspectedBuilding,level,o,selected,floorDrawing);
      if (feature) feature.properties.active = level === floor; return feature;
    }).filter(Boolean)));
    const activeOpenings = (plan.openings || []).filter(opening => opening.buildingId === inspectedBuilding?.id && !(inspectedBuilding.openFloors || []).includes(opening.level) && (mode === "3d" || opening.level === floor));
    map.getSource("openings").setData(fc(activeOpenings.map(opening => {
      const base = floorElevation(inspectedBuilding,opening.level,floorDrawing);
      return polygon(opening.footprint,o,{id:opening.id,base:base + .025,top:base + .03});
    })));
    const activeStairs = visibleStairs(plan, selected, mode, floor, displayOptions);
    map.getSource("stairs").setData(fc(activeStairs.map(stair => polygon(stairFootprint(stair,inspectedBuilding),o,{id:stair.id}))));
    const detailedStairs = [...activeStairs].sort((a,b)=>Number(b.id===selected)-Number(a.id===selected)).slice(0,24);
    map.getSource("stair-steps").setData(fc(detailedStairs.flatMap(stair => stairTreadPolygons(stair,inspectedBuilding).map(tread => polygon(tread.footprint,o,{id:stair.id,selected:stair.id===selected,base:floorDrawing ? 0 : tread.base,top:floorDrawing ? .04 : tread.top})))));
    map.getSource("stair-heading").setData(fc((floorDrawing ? activeStairs : []).map(stair => {
      const metrics = stairDimensions(stair,inspectedBuilding), angle=stair.bearing*Math.PI/180;
      const along=[Math.sin(angle),Math.cos(angle)], across=[Math.cos(angle),-Math.sin(angle)];
      const point=(d,w=0)=>[stair.x+along[0]*d+across[0]*w,stair.y+along[1]*d+across[1]*w];
      const tip=metrics.length*.38, wing=Math.min(.7,stair.width*.35);
      return feat("LineString",[point(-tip),point(tip),point(tip-wing,wing),point(tip),point(tip-wing,-wing)].map(p=>toLngLat(p,o)));
    })));
    const activePaths = (plan.paths || []).filter(path => path.buildingId === inspectedBuilding?.id && (mode === "3d" || path.level === floor));
    map.getSource("floor-paths").setData(fc(activePaths.flatMap(path => {
      const base = floorElevation(inspectedBuilding,path.level,floorDrawing) + .045;
      return lineRibbonSegments(path.points).map(ring => polygon(ring,o,{id:path.id,selected:path.id===selected,base,top:base+.025}));
    })));
    const activeRooms = plan.rooms.filter(r => r.level === floor && (!displayOptions.floorBuildingId || r.buildingId === displayOptions.floorBuildingId));
    map.getSource("rooms").setData(fc(mode === "floors" ? activeRooms.flatMap((r) => {
      const b = plan.buildings.find((b2) => b2.id === r.buildingId), base = floorElevation(b,r.level,floorDrawing);
      return lineRibbonSegments(r.footprint,.14).map(ring => polygon(ring, o, { id: r.id, base, top: base + (floorDrawing ? .05 : r.wallHeight) }));
    }) : []));
    map.getSource("room-areas").setData(fc(mode === "floors" ? activeRooms.map((r) => {
      const base = floorElevation(plan.buildings.find((b2) => b2.id === r.buildingId),r.level,floorDrawing);
      return polygon(r.footprint, o, { id: r.id, base: base + .022, top: base + .026 });
    }) : []));
    const activeZones = (plan.zones || []).filter(zone => !zone.buildingId || (mode === "floors" && zone.buildingId === displayOptions.floorBuildingId && zone.level === floor));
    map.getSource("zones").setData(fc(activeZones.map(zone => {
      const building = plan.buildings.find(b => b.id === zone.buildingId);
      const base = building ? floorElevation(building,zone.level,floorDrawing) : 0;
      return polygon(zone.footprint, o, {id: zone.id, type: zone.type, enabled: zone.enabled !== false, selected: zone.id === selected, base, top: base + .2});
    })));
    fanOf = fans(wallObstacles(plan));
    renderCameras(plan, drag?.preview);
    map.getSource("route").setData(fc(plan.route.length > 1 ? [feat("LineString", plan.route.map((p) => toLngLat(p, o)))] :
    []));
    const labels = [...plan.buildings.map((b) => {
      const [x, y] = centroid(b.footprint);
      return { id:b.id, name: b.name, x, y };
    }), ...plan.labels.filter(l => mode === "floors" ? (l.buildingId ? l.buildingId === displayOptions.floorBuildingId && l.level === floor : floor === 0) : !l.level), ...mode === "floors" ? activeRooms.map((r) => {
      const [x, y] = centroid(r.footprint);
      return { id:r.id, name: r.name, x, y };
    }) : [], ...activeZones.map(zone => {const [x,y] = centroid(zone.footprint); return {id:zone.id,name: `${zone.enabled === false ? "Disabled · " : ""}${zone.type === "object_watch" ? "Object watch" : "Restricted"} · ${zone.name}`, x, y, zone: true};}), ...activeOpenings.map(opening => {const [x,y] = centroid(opening.footprint); return {id:opening.id,name: `Floor ${opening.level + 1} opening · ${opening.name}`, x, y, opening: true};}), ...activeStairs.map(stair => ({id:stair.id,name: `↑ ${stair.name} · L${stair.fromLevel + 1}–L${stair.toLevel + 1}`,x:stair.x,y:stair.y,stair:true})), ...activePaths.map(path => ({id:path.id,name:`Path · ${path.name}`,x:path.points[0][0],y:path.points[0][1],path:true}))].sort((a,b)=>Number(b.id===selected)-Number(a.id===selected)).slice(0, 80);
    if (inspectedBuilding && mode === "floors" && (inspectedBuilding.openFloors || []).includes(floor)) {
      const [x,y] = centroid(inspectedBuilding.footprint);
      labels.unshift({name:`Level ${floor + 1} · open floor · no slab`,x,y,opening:true,activeFloor:true});
      labels.length = Math.min(labels.length,80);
    }
    // Marker DOM is rebuilt only when some label's text, style or position changed.
    const specs = labels.map(l => {
      const isSelected = l.id === selected;
      return { className: "facility-map-label" + (l.zone ? " facility-zone-label" : l.opening ? " facility-opening-label" : l.stair ? " facility-stair-label" : l.path ? " facility-floor-path-label" : ""),
        text: l.name, priority: l.activeFloor ? 0 : isSelected ? 1 : 4, keep: !!l.activeFloor, anchor: l.activeFloor || isSelected ? "bottom" : "center",
        offset: l.activeFloor ? [0,-42] : isSelected ? [0,-18] : [0,0], lngLat: toLngLat([l.x, l.y], o) };
    });
    const cam = plan.cameras.find((c) => c.id === selected);
    if (cam) specs.push({ className: "facility-map-label selected-camera-label", text: cam.id + " \xB7 " + cam.name, priority: 1, keep: false, anchor: "top", offset: [0, 14], lngLat: toLngLat([cam.x, cam.y], o) });
    if (cam?.enabled) for (const arc of doriArcs(cam, fanOf(cam))) specs.push({ className: "facility-map-label facility-dori-label", text: `${arc.name} \u2264 ${formatDistance(arc.to, displayOptions.units)}`,
      title: "Pixel-density planning estimate \u00b7 assumes ideal focus and no compression", priority: 3, keep: false, anchor: "center", offset: [0, 0], lngLat: toLngLat(arc.label, o) });
    if (displayOptions.measurements) for (const label of measurementLabels(plan, selected, {...displayOptions, floor, view: mode})) specs.push({
      className: `facility-map-label facility-dimension-label${label.summary ? " facility-measurement-summary" : ""}${label.route ? " facility-route-dimension" : ""}`,
      text: label.text, title: "Plan dimensions · verify on site", priority: label.primary ? 0 : label.summary ? 2 : 3, keep: !!label.primary,
      anchor: "center", offset: label.summary ? [0, 24] : [0,-9], lngLat: toLngLat(label.point,o) });
    const specKey = JSON.stringify(specs);
    if (specKey !== markerKey) {
      markerKey = specKey;
      for (const m of markers) m.remove();
      markers = [];
      labelRecords = [];
      cameraLabel = null;
      doriLabels = [];
      for (const spec of specs) {
        const el = document.createElement("span");
        el.className = spec.className;
        el.textContent = spec.text;
        if (spec.title) el.title = spec.title;
        trackLabel(el, spec.priority, spec.keep);
        const marker = new Marker({ element: el, anchor: spec.anchor, offset: spec.offset }).setLngLat(spec.lngLat).addTo(map);
        markers.push(marker);
        if (spec.className.includes("selected-camera-label")) cameraLabel = marker;
        if (spec.className.includes("facility-dori-label")) doriLabels.push(el);
      }
    }
    scheduleLabels();
    volumeOptions = {...displayOptions,floorDrawing,fanOf};
    volumes.update(plan, selected, mode, floor, volumeOptions);
    const nextHasOsm = plan.buildings.some(b=>b.source?.provider==='OpenStreetMap');
    if(nextHasOsm!==hasOsm) {
      map.removeControl(attribution);
      attribution = new AttributionControl({compact:false,customAttribution:nextHasOsm?osmCredit:[]});
      map.addControl(attribution,'bottom-right');
      hasOsm=nextHasOsm;
    }
  }
  function fitPlan(animate = true) {
    if (!ready) return;
    const points = [...current.buildings.flatMap((b) => b.footprint), ...current.cameras.map((c) => [c.x, c.y]), ...current.
    labels.map((l) => [l.x, l.y]), ...(current.zones || []).flatMap(zone => zone.footprint), ...current.route];
    if (!points.length) {
      map.easeTo({ center: current.origin, zoom: 17.4, bearing: 0, pitch: viewPitch(view, tool), duration: animate ? 300 : 0 });
      return;
    }
    const min = [Math.min(...points.map((p) => p[0])) - 12, Math.min(...points.map((p) => p[1])) - 12], max = [Math.max(
      ...points.map((p) => p[0])
    ) + 12, Math.max(...points.map((p) => p[1])) + 12];
    map.fitBounds([toLngLat(min, current.origin), toLngLat(max, current.origin)], {
      padding: 28,
      maxZoom: 19.4,
      bearing: 0,
      pitch: viewPitch(view, tool),
      duration: animate ? 400 : 0
    });
  }
  return {
    update,
    setArea(area) {
      const bounds=area?.bounds || area;
      if(!ready)return;
      const ring = bounds ? [[bounds[1],bounds[0]],[bounds[3],bounds[0]],[bounds[3],bounds[2]],[bounds[1],bounds[2]],[bounds[1],bounds[0]]] : null;
      map.getSource('search-area').setData(fc(area?.ring ? [polygon(area.ring,current.origin)] : ring?[feat('Polygon',[ring])]:[]));
    },
    setTool(next) {
      if (!ready) return;
      tool = next;
      draw.clear();
      draw.setMode(["building", "room", "zone", "opening", "search-area"].includes(next) ? "polygon" : ["route", "floor-path"].includes(next) ? "linestring" : "static");
      map.getCanvas().style.cursor = next === "select" ? "" : "crosshair";
      update(current,selected,view,floor,displayOptions);
      if (OVERHEAD_TOOLS.includes(next)) map.easeTo({ pitch: 0, duration: 250 });
    },
    center: fitPlan,
    reset() { fitPlan(); },
    north() { if (ready) map.easeTo({bearing: 0, duration: 300}); },
    centerCamera(id = selected) {
      const camera = current.cameras.find(c => c.id === id);
      if (ready && camera) map.easeTo({center: toLngLat([camera.x,camera.y],current.origin), zoom: Math.max(map.getZoom(),19), duration: 350});
    },
    centerSelection(id = selected) {
      const pointItem = [...current.cameras,...current.labels,...(current.stairs || [])].find(item => item.id === id);
      const shape = [...current.buildings,...current.rooms,...(current.zones || []),...(current.openings || []),...(current.paths || []).map(path => ({...path,footprint:path.points}))].find(item => item.id === id);
      if (!ready) return;
      if (pointItem) map.easeTo({center: toLngLat([pointItem.x,pointItem.y],current.origin), duration: 350});
      else if (shape) {
        const points = shape.footprint;
        map.fitBounds([toLngLat([Math.min(...points.map(p=>p[0]))-5,Math.min(...points.map(p=>p[1]))-5],current.origin),toLngLat([Math.max(...points.map(p=>p[0]))+5,Math.max(...points.map(p=>p[1]))+5],current.origin)],{padding: 60,maxZoom:21,duration:350});
      }
    },
    setBasemap(enabled) {
      if (!ready) return;
      if (enabled && !map.getSource("street-tiles")) {
        map.addSource("street-tiles", {
          type: "raster",
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          maxzoom: 19,
          attribution: '\xA9 <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetM\
ap</a> contributors'
        });
        map.addLayer({ id: "street-basemap", type: "raster", source: "street-tiles", paint: { "raster-opacity": 0.55, "r\
aster-saturation": -1, "raster-brightness-max": 0.55 } }, "grid");
      } else if (!enabled && map.getSource("street-tiles")) {
        map.removeLayer("street-basemap");
        map.removeSource("street-tiles");
      }
    },
    setTrack(point) {
      if (ready) map.getSource("track").setData(fc(point ? [feat("Point", toLngLat(point, current.origin))] : []));
    },
    setBlindSpots(rings) {
      if (ready) map.getSource("blind-spots").setData(fc((rings || []).map(ring => polygon(ring, current.origin))));
    },
    destroy() {
      drag?.cancel();
      handle?.remove();
      if (labelFrame !== null) cancelAnimationFrame(labelFrame);
      labelRecords = [];
      for (const m of markers) m.remove();
      draw?.stop();
      map.remove();
    },
    resize() {
      map.resize();
    }
  };
}
export {
  createFacilityMap
};
