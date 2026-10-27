import { Map, NavigationControl, ScaleControl, AttributionControl, Marker, MercatorCoordinate, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import * as THREE from "three";
import { TerraDraw, TerraDrawPolygonMode, TerraDrawLineStringMode } from "./vendor/terra-draw.mjs";
import { TerraDrawMapLibreGLAdapter } from "./vendor/terra-maplibre.mjs";
import { centroid, toLngLat, fromLngLat, coverageFan, wallObstacles } from "./facility.mjs";
setWorkerUrl(workerUrl);
const fc = (features) => ({ type: "FeatureCollection", features });
const feat = (type, coordinates, properties = {}) => ({ type: "Feature", geometry: { type, coordinates }, properties });
const polygon = (ring, origin, props) => feat("Polygon", [ring.map((p) => toLngLat(p, origin))], props);
const empty = () => fc([]);
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
  update(plan, selected, view, floor) {
    disposeGroup(this.group);
    this.origin = MercatorCoordinate.fromLngLat(plan.origin, 0);
    const unit = this.origin.meterInMercatorCoordinateUnits();
    this.model = new THREE.Matrix4().makeTranslation(this.origin.x, this.origin.y, this.origin.z).scale(new THREE.Vector3(
      unit,
      -unit,
      unit
    ));
    if (view === "2d") return;
    const c = plan.cameras.find((c2) => c2.id === selected);
    if (c?.enabled) {
      const fan = coverageFan(c, wallObstacles(plan));
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
    if (view === "3d") for (const b of plan.buildings) {
      const [x, y] = centroid(b.footprint);
      const geo = new THREE.BoxGeometry(5, 3, 1.1);
      const mat = new THREE.MeshBasicMaterial({ color: 6320515 });
      const unit2 = new THREE.Mesh(geo, mat);
      unit2.position.set(x, y, b.height + 0.6);
      this.group.add(unit2);
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
function createFacilityMap(container, callbacks, initialPlan) {
  const map = new Map({
    container,
    center: initialPlan.origin,
    zoom: 18.3,
    pitch: 52,
    bearing: -27,
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
  map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
  const volumes = new CameraVolumes();
  let draw, ready = false, suppressSelection = false, current = initialPlan, selected = "C-07", view = "3d", floor = 0, tool = "\
select", markers = [];
  map.on("error", (e) => callbacks.onError(e.error?.message || "Map rendering error."));
  map.on("webglcontextlost", () => callbacks.onError("3D graphics were interrupted. Save or export the plan, then reload\
 to recover."));
  map.on("load", () => {
    const sources = ["grid", "site", "buildings", "rooms", "coverage", "cameras", "route", "track", "search-area"];
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
    ], "fill-extrusion-height": ["get", "top"], "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.96, "fill-extrusio\
n-vertical-gradient": true } });
    map.addLayer({ id: "building-edge", type: "line", source: "buildings", paint: {
      "line-color": "#72bec7",
      "line-width": 1.3,
      "line-opacity": 0.8
    } });
    map.addLayer({ id: "rooms", type: "fill-extrusion", source: "rooms", paint: { "fill-extrusion-color": "#6b9397", "fi\
ll-extrusion-base": ["get", "base"], "fill-extrusion-height": ["get", "top"], "fill-extrusion-opacity": 0.55 } });
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
        if (!f) return;
        const geometry = f.geometry.type === "Polygon" ? f.geometry.coordinates[0] : f.geometry.coordinates;
        callbacks.onDraw(tool, geometry.map((p) => fromLngLat(p, current.origin)));
        draw.clear();
        draw.setMode("static");
        tool = "select";
        callbacks.onToolDone();
        requestAnimationFrame(() => {
          suppressSelection = false;
        });
      });
    });
    ready = true;
    update(current, selected, view, floor);
    fitPlan(false);
    callbacks.onReady();
  });
  map.on("click", (e) => {
    if (!ready || suppressSelection) return;
    if (tool === "camera" || tool === "label") {
      callbacks.onPlace(tool, fromLngLat([e.lngLat.lng, e.lngLat.lat], current.origin));
      tool = "select";
      callbacks.onToolDone();
      map.getCanvas().style.cursor = "";
      return;
    }
    if (tool !== "select") return;
    const hit = map.queryRenderedFeatures(e.point, { layers: ["cameras", "buildings", "rooms"] })[0];
    if (hit) callbacks.onSelect(hit.properties.id, hit.layer.id === "cameras" ? "camera" : hit.layer.id === "rooms" ? "r\
oom" : "building");
  });
  function update(plan, selection, mode, level) {
    const originChanged = current.origin[0] !== plan.origin[0] || current.origin[1] !== plan.origin[1];
    current = plan;
    selected = selection;
    floor = level;
    if (!ready) return;
    if (originChanged) map.jumpTo({ center: plan.origin });
    if (view !== mode) {
      view = mode;
      map.easeTo({ pitch: mode === "2d" ? 0 : 52, duration: 350 });
    }
    const o = plan.origin, grid = [];
    for (let n = -300; n <= 300; n += 20) {
      grid.push(feat("LineString", [toLngLat([n, -300], o), toLngLat([n, 300], o)]));
      grid.push(feat("LineString", [toLngLat([-300, n], o), toLngLat([300, n], o)]));
    }
    map.getSource("grid").setData(fc(grid));
    map.getSource("site").setData(fc([polygon([[-125, -110], [130, -110], [130, 108], [-125, 108], [-125, -110]], o)]));
    map.getSource("buildings").setData(fc(plan.buildings.map((b) => polygon(b.footprint, o, { id: b.id, selected: b.id ===
    selected, top: mode === "2d" ? 0 : mode === "floors" ? Math.min(b.floors - 1, floor) * b.height / b.floors + 0.15 : b.
    height }))));
    map.getSource("rooms").setData(fc(mode === "floors" ? plan.rooms.filter((r) => r.level === floor).map((r) => {
      const b = plan.buildings.find((b2) => b2.id === r.buildingId), base = r.level * b.height / b.floors;
      return polygon(r.footprint, o, { id: r.id, base, top: base + r.wallHeight });
    }) : []));
    const obstacles = wallObstacles(plan);
    const visible = plan.cameras.filter((c) => c.id === selected).concat(plan.cameras.filter((c) => c.id !== selected).slice(
      0,
      11
    ));
    map.getSource("coverage").setData(fc(visible.map((c) => ({ c, fan: coverageFan(c, obstacles) })).filter((x) => x.fan.
    length > 3).map(({ c, fan }) => polygon(fan, o, { selected: c.id === selected }))));
    map.getSource("cameras").setData(fc(plan.cameras.map((c) => feat("Point", toLngLat([c.x, c.y], o), { id: c.id, selected: c.
    id === selected, enabled: c.enabled }))));
    map.getSource("route").setData(fc(plan.route.length > 1 ? [feat("LineString", plan.route.map((p) => toLngLat(p, o)))] :
    []));
    for (const m of markers) m.remove();
    markers = [];
    const labels = [...plan.buildings.map((b) => {
      const [x, y] = centroid(b.footprint);
      return { name: b.name, x, y };
    }), ...plan.labels, ...mode === "floors" ? plan.rooms.filter((r) => r.level === floor).map((r) => {
      const [x, y] = centroid(r.footprint);
      return { name: r.name, x, y };
    }) : []].slice(0, 80);
    for (const l of labels) {
      const el = document.createElement("span");
      el.className = "facility-map-label";
      el.textContent = l.name;
      markers.push(new Marker({ element: el, anchor: "center" }).setLngLat(toLngLat([l.x, l.y], o)).addTo(map));
    }
    const cam = plan.cameras.find((c) => c.id === selected);
    if (cam) {
      const el = document.createElement("span");
      el.className = "facility-map-label selected-camera-label";
      el.textContent = cam.id + " \xB7 " + cam.name;
      markers.push(new Marker({ element: el, anchor: "top", offset: [0, 14] }).setLngLat(toLngLat([cam.x, cam.y], o)).
      addTo(map));
    }
    volumes.update(plan, selected, mode, floor);
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
    labels.map((l) => [l.x, l.y])];
    if (!points.length) {
      map.easeTo({ center: current.origin, zoom: 17.4, pitch: view === "2d" ? 0 : 52, duration: 300 });
      return;
    }
    const min = [Math.min(...points.map((p) => p[0])) - 12, Math.min(...points.map((p) => p[1])) - 12], max = [Math.max(
      ...points.map((p) => p[0])
    ) + 12, Math.max(...points.map((p) => p[1])) + 12];
    map.fitBounds([toLngLat(min, current.origin), toLngLat(max, current.origin)], {
      padding: 28,
      maxZoom: 19.4,
      bearing: -27,
      pitch: view === "2d" ? 0 : 52,
      duration: animate ? 400 : 0
    });
  }
  return {
    update,
    setArea(bounds) {
      if(!ready)return;
      const ring = bounds ? [[bounds[1],bounds[0]],[bounds[3],bounds[0]],[bounds[3],bounds[2]],[bounds[1],bounds[2]],[bounds[1],bounds[0]]] : null;
      map.getSource('search-area').setData(fc(ring?[feat('Polygon',[ring])]:[]));
    },
    setTool(next) {
      if (!ready) return;
      tool = next;
      draw.clear();
      draw.setMode(["building", "room"].includes(next) ? "polygon" : next === "route" ? "linestring" : "static");
      map.getCanvas().style.cursor = next === "select" ? "" : "crosshair";
      if (["building", "room", "route"].includes(next)) map.easeTo({ pitch: 0, duration: 250 });
    },
    center: fitPlan,
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
    destroy() {
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
