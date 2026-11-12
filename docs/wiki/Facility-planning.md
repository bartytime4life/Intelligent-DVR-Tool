# Guided facility builder

**Current branch proposal:** camera views now use a tilted pinhole ground
footprint with complete wall shadows. The map, coverage, rehearsal and installer
share one revision-bound estimate. This is under review alongside the earlier
pixel-density and zone-area proposals; see [status](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Product-status) and the
[source-bound geometry record](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/ground-frustum-math-2026-11-12/README.md).

October 28 follow-up: [current workflow/geometry](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-setup-reliability)
adds map pin/custom AOI selection, v2 courtyards/bases and independent parts.
The earlier v1 limitations and evidence below describe the original increment;
overlapping parts, live/installed services, field accuracy and novice acceptance
remain open. [Local delivery](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Local-map-services) · [Study kit](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-study-kit).


[Guide index](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guide-index) · [Visual handbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-handbook#8-build-a-facility) · [Saved facilities](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Saved-facilities) · [Screenshot atlas](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-atlas)

![Site and shell, rooms and openings, then camera planning and backup.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/facility.svg)

![Actual Facility Studio building controls with a fictional built-in example, local grid and estimated dimensions.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/facility.jpg)

*Captured from merged source `2566d845`; the opt-in example is a fictional planning aid. Fresh installs start blank. [Capture provenance](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-provenance).*

**Quick path:** New facility → site and building → floor and rooms → doors/windows/stairs → cameras and estimates → export. The November 1 building and interior tools are merged in [PR #70](https://github.com/bartytime4life/Intelligent-DVR-Tool/pull/70).

The **Facility** navigation item opens a browser-local, subscription-free planning
editor. Direct entry is `/#facility`. The existing camera wall and event review
remain available. This is an editable planning prototype, not a calibrated digital
twin or an operational multi-camera tracking service.

Fresh installs start with a blank facility. Use **New facility** to keep separate
named sites, or explicitly open an example under **Backup & examples**. Existing
saves reopen the last active site. See [saved facilities and backups](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Saved-facilities).

## Workflow

Use **Current task** at the top or the seven detailed steps in the left rail. Press **1–7** outside inputs for quick task navigation, **?** for Help, and **Focus map / Show panels** when you need more space. Save or discard any in-progress edit before changing tasks. [Keyboard and measurement details](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Image-diagnostics).

On narrow and intermediate windows, the property inspector sits below the full-width
map. Map-layer buttons wrap when needed and remain available by keyboard.

1. Set the facility name and geographic origin. Coordinates are longitude then
   latitude; local geometry is meters east/north of that origin.
   A new facility starts in central Kansas. **Use my location** asks the browser
   for high accuracy for up to 20 seconds. A fresh reading with a reported
   radius of 100 m or less previews a pin. Check it against the roof and choose
   **Save site**. Coarse results leave the coordinates and pin alone. If the
   device cannot provide a close fix, search the address, pick the roof on the
   map, enter coordinates, or explicitly keep the entered coordinates. Editing
   coordinates, choosing a different location, leaving the form or cancelling
   stops the request. Device accuracy depends on the location provider.
   Submitted address/place search is another route: choose a provider, submit,
   select a suggestion, review coordinates and Save site. Nothing is sent while
   typing. If the plan already has geometry, choose whether to **Keep buildings
   at their map positions** before saving. It is on by default for map-sourced
   buildings and off for hand-drawn plans. When checked, saving re-centres the
   local grid while retaining the plan's geographic positions in the existing
   projection; local coordinate values can change. When unchecked, the local
   coordinates stay the same and the whole plan moves geographically with the
   origin. A refused correction leaves the existing plan intact. See
   [origin changes and their limits](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Maps-and-shapes#change-the-site-origin).
2. Review a bounded OSM area and supported exterior drafts, use an offline JSON
   file/paste extract, trace with Terra Draw, or add one of seven common shapes.
   Map drafts require explicit selection and apply; additive import preserves
   cameras/rooms, while a clean replacement explicitly clears them. Edit name,
   footprint position/dimensions, height and number of floors. Save the building.

   **Quick start.** On a blank plan, choose **Add first building**. Pick the
   silhouette that matches your site and adjust its width and depth. The dashed
   outline previews its size and position. Use the suggested space or choose
   **Pick on map** and click or tap a center point. Hold Shift while clicking
   to snap to whole meters or feet. **Add selected shape** saves the footprint.

   For repeated buildings, **Copy building outline** places a separate shell
   nearby with the same dimensions, courtyards, height and floor count. Rooms
   and cameras stay with the original. To reposition an existing building,
   choose **Move on map** or **Rotate 90°**, then **Save building**. Escape
   cancels placement, **Discard preview** drops pending edits, and **Undo edit**
   restores the previous saved plan.
3. Choose **Sketch rooms inside** on a building or **Sketch rooms** in Floors &
   labels. The preview starts with three rooms across the selected floor. Choose
   one room, a row, or a center hall. Use the whole floor, drag a box, or tap two
   corners. Edges follow the longest exterior wall and snap to nearby wall
   coordinates and the unit grid. Turn the layout, change the count or hall
   width, or open **Dimensions & names** for precise entry in meters or feet.
   **Keep & draw more** lets you combine several areas; **Add rooms** saves them
   together. One **Undo edit** restores the previous floor. Each saved room can
   then be selected, named, and edited separately.

   After saving rooms, open **Edit room walls** in Floors & labels. Select a
   room, then split it, move its shared wall, or merge it with an adjoining
   room. Drag the divider, tap a position, or enter a distance in meters or
   feet. The preview shows each room’s resulting area. Moving a shared wall
   updates both rooms together. Splitting gives the new room its own name and
   ID. Merging keeps the selected room’s name and requires matching wall
   heights. Each save is one Undo step. A wall move requires a straight
   division, and each resulting room must have one connected outline.

   Choose **Place doorway** to highlight shared room walls. Click a wall to
   preview an opening, then drag the round handle along it. Arrow keys adjust
   the handle by a tenth of the selected unit, or a whole unit with Shift.
   Width, height and distance along the wall are also editable in meters or
   feet. **Save doorway** commits the preview and **Undo edit** restores it.
   **Place by room pair** offers the same workflow through numeric controls.

   Doorways represent planned open passages. Shared-wall moves carry attached
   doorways, splitting reassigns them to the corresponding room, and merging
   removes a doorway in the removed divider. An edit that cannot keep an
   opening on a shared wall is rejected with the doorway’s name. Copying rooms
   upstairs also copies their doorways. Removing a room removes its attached
   doorways as one undoable edit.

   Choose **Place window** and click an outside wall of the active building.
   No rooms are required. Courtyard walls are available too. Drag the center to
   move the pane; drag either end to widen or narrow it with the opposite end
   fixed. Corners and neighboring windows stop the drag. Arrow keys nudge a map
   handle by a tenth of the selected unit, or a whole unit with Shift. Escape
   cancels a map drag. The **Wall elevation** shows the pane above the floor:
   drag it up or down, or drag the top or sill to change its height. **Window
   measurements & name** accepts exact values; **Choose a wall by name** works
   without WebGL. **Save window** commits one undoable edit.

   Windows follow the building when it moves or rotates. Copy rooms upstairs
   also copies that floor’s windows; an overlap on the destination floor blocks
   the copy. The floor and 3D views draw glazing, sill and head at the planned
   dimensions. Camera estimates keep exterior walls opaque: neither glazing
   transparency nor real visibility is known. New exports use facility v6 and
   accept ordinary v1–v5 inputs. Windows in a file labeled v4 or earlier, and
   doorways in v3 or earlier, are rejected to avoid silent geometry loss.

   **Place stairs**: click the center of the start landing, then choose a
   destination in the map’s **Go to** menu. Drag **Start** to move the flight;
   drag **Turn** to rotate it around the start. Hold Shift to snap rotation to
   15°; Escape cancels the current drag. With either handle focused, use the
   arrow keys to move or turn. **Suggest a position** and **Stair dimensions &
   position** work without graphics. A one-floor building offers **Add
   destination level**. Stairs can go up or down. Changing the destination
   adjusts the riser count to the modeled rise while keeping the start fixed.
   Red previews need a correction before **Save stair**. The reservation must
   fit the building, and both landings need solid floor. Cut floor openings
   separately, including any intermediate floors. Earlier schemas support
   only stairs going up one level.

   With a floor drawing, choose **Trace a floor plan image** and open a local PNG
   or JPEG. **Match two landmarks** asks for two points on the image, then the
   same points on the building. This rotates, scales and positions the image
   without stretching it. Adjust its opacity and sketch over it. Alignment
   does not correct perspective or establish survey accuracy. The image stays
   in memory for this sketch; only room geometry is saved and exported.

   The sketch uses local plan geometry. It avoids courtyards, saved rooms,
   openings on this floor, and stairs including both landings. A center hall
   leaves an unassigned strip. Separate pieces become separate rooms; pieces
   too small or complex to save, or that surround a void, are flagged. Sketch
   a smaller area along the void to include more space. These are proposed
   partitions, not inferred walls. Freeform **Draw room** remains available.
4. Place a camera on the map or add one with coordinates. Set ground-relative
   mounting elevation, direction clockwise from north, downward tilt, horizontal
   and vertical field of view, and maximum viewing range. Optionally add a
   recorder channel label, a typical lens preset and the horizontal resolution
   for [pixel-density estimates](#camera-planning-estimates). Drag the selected
   camera or its heading handle on the map, or use the keyboard, then Save the camera.
5. Inspect the selected camera's ground-plane visibility estimate and 3D volume,
   estimated zone and route coverage, and the blind-spot overlay for one zone.
6. Draw a route, play or scrub the simulated rehearsal, and review proposed camera
   transitions. Links and separations are session-only simulation decisions.

Drawing uses clicks and polygon closure (line routes finish by double-click).
Escape cancels. Building and camera placement have numeric alternatives; a
selected camera also accepts Alt+Arrow (0.5 m east/west/north/south) and `[` / `]`
(5° rotation) when focus is not in a text field. In Room sketch, focus the floor
plan and use the arrows to position the cursor (Shift for ten units). Enter sets
each corner; Escape cancels an unfinished box. Room sketch also works without
WebGL.
Undo restores the previous 20 committed edits in the current editor session.
Facility file imports and the Paste JSON dialog validate the entire input, then
add separate facilities without replacing saved sites. Export plan saves named
JSON metadata; Export all facilities backs up the collection. Switching facilities
clears the local Undo history and requires pending edits to be applied or discarded.

## Visibility model and evidence limits

Camera inputs describe an idealized pinhole view intersecting a horizontal ground
plane. Mount height, bearing, tilt and both viewing angles determine the ground
footprint. The configured range is a horizontal distance from the mount. Its
circular boundary is approximated conservatively by an inscribed 256-sided
polygon; the maximum inward radial error is about 0.023 m at the largest allowed
300 m range. Steep views can include ground below and behind the mount.

Building and room wall faces cast projected shadows. A low wall can leave a blind
patch with visible ground beyond it; a raised wall can allow a view underneath.
The estimate retains holes and separate visible pieces rather than stopping a
whole viewing direction at its first obstruction. A camera's pieces count as
one camera. The existing 0.5 m facade-mount clearance policy is retained.

This approximation includes planned doorway gaps and opaque lintels above their
entered heights. Exterior glazing stays opaque to this estimate. It excludes floor and roof slabs, furniture, terrain,
lens distortion, lighting,
motion blur, or recognition quality. Pixel density is a separate horizontal
ground-detail planning estimate (below). A colored footprint is not a claim that a person can be
detected or identified at that location. The current Three.js volume is an
illustrative envelope connecting the mount to its visible ground regions; it
does not establish visibility throughout a physical 3D volume.

Estimated views update in a bounded background worker. While a changed view is
pending, its old footprint, density contours and 3D envelope are hidden. Camera
markers remain editable. **Try views again** retries a failed calculation.
Incomplete views withhold coverage totals and handoff proposals; they do not
become zero coverage or an asserted blind spot. Calculation adds no new editing
or backup restriction; the existing Save/Discard guards still apply. The [science guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Science-and-algorithms#project-the-visible-ground-footprint)
explains the geometry, arithmetic and approximation limits.

## Camera planning estimates

Everything in this section is labelled **Planning estimate — assumes ideal focus
and no compression**. None of it is a calibration, compliance or
recognition-quality claim.

- **Pixel density (DORI).** An optional `pixelsWide` (integer 320–7680) gives
  ideal horizontal pixels per metre across the ground, perpendicular to the
  camera bearing. Pinhole projection uses camera-axis depth, rather than slant
  distance; tilt therefore matters even for targets close to the mount.
  The IEC 62676-4 figures — Detect 25, Observe 62.5, Recognize 125 and Identify
  250 px/m — are used as planning thresholds. The table and installer sheet show
  **centreline ground ranges**, from the near view limit along the bearing to
  each threshold or the far view limit. Short positive ranges retain enough
  displayed precision to remain visible in metres or feet. These intervals
  describe the ideal centreline view, before wall occlusion. Colored straight
  lines show equal-density thresholds, clipped to the current visible ground
  regions; wall shadows can split a line into separate fragments. A contour can
  appear behind the mount even when the forward centreline has no interval.
  The footprint assumes ideal, roll-free optics. [Projection mathematics and
  generated checks](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Science-and-algorithms#project-ground-detail-through-the-camera).
  Lens presets (2.8–12 mm) fill a **typical** horizontal view only;
  vertical view is unchanged, and a datasheet value always wins.
- **Coverage metrics.** The Coverage step calculates from the previewed plan
  using the same captured visible-ground geometry as the map. Outdoor zone percentages
  measure polygon **area** inside at least one camera's footprint. **Overlap**
  requires at least two different cameras; duplicate fragments of one camera
  count once. A footprint touching an edge or point contributes no area.
  The **Blind spots** toggle shades the zone minus that coverage, preserving
  disconnected pieces and covered islands as holes. It does not fill bounding
  rectangles outside a concave zone. Planned area appears beneath the zone name
  in your selected metres/feet units. The saved zone is still a single-ring
  footprint; computed overlay holes do not add editable holes to the plan schema.
  These remain estimates of the drawn ground plane, not calibrated visibility.
  Indoor and level zones remain **Not estimated · ground-plane only**.

  Coverage calculation runs in a second bounded background worker, reusing the
  current view snapshot. **Updating coverage** hides
  old numbers and shading while you keep editing; newer drafts supersede older
  requests. Leaving Coverage cancels the coverage calculation; views continue
  to serve the other planning tasks. **Save camera**, Discard and Undo
  retain their existing meaning. A worker error or timeout offers **Try coverage
  again**. A zone that exceeds the geometry budget or cannot be resolved shows
  **Not estimated**, with no numeric or empty-overlay fallback. Change or simplify
  its geometry to retry. Local per-zone and whole-plan work caps can leave complex
  plans partly unestimated; they do not establish a target-host latency guarantee.
  See the [area mathematics, limits and generated checks](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/zone-area-math-2026-11-12/README.md).
  The **handoff route** uses covered path length rather than sample-point counts.
  Each segment is intersected with the visible positive-area polygons, including
  their separate pieces and holes; intervals
  from the same camera count once before coverage and overlap are measured.
  The displayed polygons use closed boundaries, including the edges of shadow
  holes. A boundary segment contributes its length; touching a footprint at a single point
  contributes none. Repeated/backtracking passages count each time. The display
  includes total uncovered distance and the longest continuous gap across route
  vertices. Zero-length segments add no distance. Calculations retain gaps above
  floating-point tolerance, but the result remains an estimate of the drawn
  ground plane, not calibrated visibility. The separate rehearsal below uses
  sampled, simulated handoff proposals. [Mathematics and generated checks](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/route-coverage-math-2026-11-12/README.md).
  Coverage and overlap read **<0.1%** or **>99.9%** when a small positive fraction
  or a fraction just below complete would otherwise round to an endpoint. Only
  calculated fractions exactly zero or one display **0.0%** or **100.0%**.
  Small positive lengths and areas retain a nonzero readout: a 4 cm route gap is
  **0.04 m**, rather than **0.0 m**. The map, dimensional summaries and printable
  installer sheet use the same distance formatting; short installer ground
  intervals keep their two endpoints distinct. Plan JSON retains the original
  coordinates and values. These display rules do not increase planning accuracy.
- **Direct manipulation.** Dragging the selected camera (mouse or touch) or its
  round heading handle previews its position on the map; release, Alt+Arrow and
  `[` / `]` change only the unsaved draft. Save camera commits, Discard preview
  restores it and Undo covers the commit. Release recalculates the changed view.
  Escape, leaving the browser window, leaving camera editing or changing the
  plan, selected camera, view or floor cancels an in-progress drag and restores
  map panning. Undo that changes the plan also cancels it. A units-only
  refresh preserves the current gesture.
- **Installer sheet.** Download installer sheet writes a printable, offline HTML
  page of the saved plan with the same restrictive CSP as the recognition report:
  an inline SVG plan (buildings, outdoor zones, route, estimated ground regions and camera
  bearings), and a per-camera table of ID, name, an optional `channel` label
  (≤60 characters), east/north, mount height, bearing, tilt, H/V field of view,
  range, resolution and DORI centreline ground ranges (including both near and
  far endpoints), followed by its interpretation
  limits. Save or discard pending edits and wait for the saved plan's complete
  estimated views before downloading. Export stays unavailable if those views
  fail; retry the views first. The SVG preserves visible pieces and shadow holes.
  It contains no credentials, stream addresses or footage.

The route is a planned, simulated path. Rehearsal assumes a walking pace of
1.4 m/s, so its displayed duration is the planned route length divided by that
pace. The default uses 2–601 distance-spaced positions, increasing with route
length up to that cap, and labels gaps explicitly. Simulations longer than
60 seconds use the integer playback multiplier shown beside the timeline to
fit nominal playback within a minute; the scrubber still shows simulated time.
These sampled handoff proposals are separate from the covered-distance metrics.
They are not an observed trajectory or proof of identity continuity. Real
cross-camera tracking remains separate work: synchronized recordings,
camera/floor calibration, per-camera tracklets, qualified association models,
uncertainty and source review. [Rehearsal documentation correction](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/documentation-alignment-2026-11-12/README.md).

## Local data and maps

Named plans persist in `localStorage` under `dvr.facilities.v1`. Existing
`dvr.facility.v1` data migrates once and remains untouched for recovery. A storage
failure is visible and leaves the collection in memory so it can be exported. These records are
editable local state, not an authoritative audit trail. They have no multi-user
authentication, encrypted-at-rest database, server retention or signed provenance.
Do not put camera credentials or recordings in a facility JSON file.

Facility saves use a shared browser lock and report pending saves. If another tab
changes a collection, download both versions and choose one in **Facilities save
conflict**. The replaced version is preserved first; failed backups block the
choice. See [storage and recovery](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Saved-facilities#storage-and-recovery).

The default map uses only local geometry and a 20-meter grid. The **Map layer**
switch on the map (available in every task) adds a real map under the plan so a
site can be traced instead of drawn from memory; see [Real map layer](#real-map-layer).
Nothing is requested until the user chooses Streets, Aerial or Satellite (or **Find my site
on the map**), and the choice is then remembered in this browser only. There is
no tile-prefetch, bulk-download or offline-download feature. See the
[OSMF tile policy](https://operations.osmfoundation.org/policies/tiles/).
Private/offline deployments should supply independently licensed, self-hosted
tiles, imagery, fonts and other assets; no public tile service SLA is assumed.
The workspace font is bundled locally; it makes no external request.

## Real map layer

Owner request (2026-11-01): the site builder needs the real map so a site can be
mocked up with little effort. The flow is:

1. On a blank facility, **Find my site on the map** turns on Aerial (Streets
   outside the contiguous U.S.) and focuses the address search.
2. Choosing an address, receiving a precise device fix or clicking a map pin moves the map
   to that place and shows a pin. Nothing is saved until **Save site**.
3. After **Save site**, the "Next: outline your buildings" card offers:
   - **Find mapped buildings** — one click opens the OpenStreetMap draft panel and
     loads volunteer-mapped outlines for its search area (250 m × 250 m around the
     site by default). The map switches to a top-down view framing the drafts. Each
     draft starts included; click an outline on the map (or its checkbox) to exclude
     it — excluded drafts stay visible as dashed amber outlines so they can be clicked
     back in. **Use N selected buildings** adds them as one undoable edit. Only the
     search area's coordinates are sent, to the building service selected in the panel.
   - **Trace a building** opens the Buildings task in drawing mode for anything
     unmapped or out of date.

   Plan buildings are drawn translucent over map pictures so roof edges stay
   visible; adjust corners and dimensions afterwards. Mapped heights and floors are
   often placeholders (shown in the draft list) and need checking.

Public Overpass services can be slow or unavailable: during 2026-11-01 testing both
public endpoints timed out (30 s) from the browser. The panel then reports the
timeout and the user can pick another service, open an offline extract or trace.

| Layer | Source and requests | Limits |
| --- | --- | --- |
| Grid (default) | None | Local 20 m grid only. |
| Streets | `tile.openstreetmap.org` tiles for the area being viewed; ODbL data, OSMF tile policy | Worldwide. Building outlines appear only where volunteers have mapped them. Light interactive use only; no SLA. |
| Aerial | USGS The National Map `USGSImageryOnly` cached tiles (`basemap.nationalmap.gov`, zoom ≤ 16, about 2 m per pixel) plus one 800 m × 800 m NAIP site photo at about 0.6 m per pixel from `imagery.nationalmap.gov` `exportImage` | Contiguous United States only; outside it the photo is not requested and the map offers Streets. Public-domain USGS/USDA imagery. The photo is rendered on request (6–45 s observed on 2026-11-01); a 60 s timeout, 6 MB limit and Retry apply. Capture dates vary by state and are not shown. |
| Satellite | 2016 Sentinel-2 cloudless imagery from EOX. At zoom 16 and closer, 512-pixel USGS/USDA NAIP tiles follow the view across the contiguous U.S. | Satellite imagery provides regional context at about 10 m/pixel. The roof layer is aircraft photography, typically 0.6 m/pixel, with varying capture dates. Beyond native resolution, zooming enlarges the same pixels. |

Select **Satellite** in the map toolbar, switch to **2D** and zoom in to inspect roofs. Panning requests imagery for the new view. Building and camera edits remain local. Providers receive the tile area. [EOX public endpoint terms](https://cloudless.eox.at/documentation/faq) · [USGS imagery service](https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer).

![Kansas State Capitol roof and paths visible in the Facility editor with Satellite selected, 2D view and USGS/USDA aerial detail.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/facility-capitol-roof-detail.webp)

This example shows the Kansas State Capitol at public coordinates entered by hand. The built editor received real Sentinel-2 and USGS imagery in Chromium. The location tests used controlled browser readings.

Requests are made by the browser, so the provider sees the viewer's IP address and
the area being viewed. For Streets, the request also includes the app origin
(scheme, hostname and port). If OpenStreetMap declines access, the editor shows
the local grid and offers Aerial where available. Plans, cameras, recordings and credentials are never sent.
Only the layer name and a picture-strength setting are stored (`localStorage`
keys `dvr.facility.basemap` and `dvr.facility.basemapFade`); the site photo is
kept in memory for the session and is not part of saved plans or exports.
Failed pictures show a non-blocking notice; editing, saving and export keep
working on the local grid.

Map pictures are a tracing guide, not a survey. Roofs include overhangs, tall
buildings lean in aerial photos and orthoimagery can be offset by several meters;
verify dimensions on site. Imagery is not a live view and does not establish
interior rooms, entrances, camera positions or coverage. Google and Esri imagery
are not used: their terms require separate licensing for this use (see
[setup research](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-setup-research)). Private/offline deployments can still
supply independently licensed, self-hosted tiles.

## Bounds and capacity

The JSON contract permits at most 100 buildings, 500 cameras, 500 rooms, 1,000
labels and 200 route points, in a 2 MB file. Coordinates are within 2 km of the
origin. It rejects invalid IDs, duplicate IDs, unsupported numeric ranges,
self-crossing/degenerate footprints, and orphaned or out-of-floor rooms. It copies
only declared fields (cameras may add optional `pixelsWide` and `channel`, which
v3 files without them do not need) and does not fetch media URLs from imported metadata.

The map renders camera inventory points as GPU features and all successfully
calculated footprints in the current snapshot. It displays at most 80 general text labels plus the selected camera label, and
renders a 3D volume for the selected camera only. Camera search, pagination and
the selected-camera dropdown provide access to the full inventory. Rendering is
event-driven; rehearsal updates at 10 Hz. The facility code and its map/3D
dependencies load only when Facility is opened.

View calculations have per-camera and whole-plan operation, edge and vertex
budgets, plus a ten-second response deadline. Complex valid plans can remain
unestimated. These limits bound submitted work; they do not guarantee a frame
rate or latency on every computer. See the [recorded limits and checks](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/ground-frustum-math-2026-11-12/README.md).

The 100-camera automated case exercises **metadata validation and synthetic route
evaluation only**. It does not establish recording throughput, detector throughput,
video decoding capacity, target-host latency or live 100-camera operation.

## Inspect video pixels and the calibrated ground plane

![Schematic of image reference markers mapped to a single measured ground plane, with a withheld check marker.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/current/facility-science.svg)

After placing cameras, **Image diagnostics** can freeze an operator-selected preview or locally opened recording frame, compare two frames and report image statistics. **Ground-plane calibration** fits user-marked correspondences and requires withheld checks and an operator-selected threshold before offering a plane-only ruler. These **experimental estimates** are not lens calibration, verified physical measurements, depth reconstruction or identity tracking. [Image science guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Image-diagnostics) · [Ground-plane guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Planar-calibration).

## Dependencies

- MapLibre GL JS 6.9.0 — BSD-3-Clause; package and lockfile pinned.
- Three.js 0.186.1 — MIT; package and lockfile pinned.
- polyclip-ts 0.16.8 and BigNumber.js 9.3.1 — MIT; pinned for projected shadow
  and coverage Boolean operations. Their transitive splaytree-ts 1.0.2 uses BSD-3-Clause.
  Full notices: [ground-visibility-LICENSE.txt](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/public/licenses/ground-visibility-LICENSE.txt).
- Terra Draw 1.38.0 and MapLibre adapter 1.5.0 — MIT; compiled from upstream
  commit `18ca034880232b8b618ef1ca843d8e0b6c82f1ab` into `src/vendor/`.
  These source snapshots were used because registry access was unavailable in the
  development sandbox. They are not patched behavior forks.

Full distributed notices are served from `public/licenses/`. Terra Draw bundle
headers retain its full permission notice. To reproduce its two bundles, obtain
that exact upstream commit, then use esbuild 0.25.12 with `--bundle --format=esm
--minify --legal-comments=inline`: bundle `packages/terra-draw/src/terra-draw.ts`,
then the adapter entry with `--alias:terra-draw=<absolute path to that entry>`.
Retain the MIT headers when regenerating. Audit/update snapshots deliberately.

## Verification

`npm test` includes facility geometry and import-contract cases. `npm run build`
and `npm run test:sites` verify the retained deployment packaging. Restricted
executors that cannot spawn test children can use Node's
`--experimental-test-isolation=none` with the same test files. Visual and browser
interaction evidence is recorded separately in `design-qa.md`; a build or unit
test result does not substitute for browser verification.

## Map setup and remaining work

Submitted address search, GPS/numeric origin, a bounded rectangular area, selectable
public/local services, direct offline JSON review, supported complete outer-only
OSM relations and seven common shapes are implemented. See the
[map/measurement guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Maps-and-shapes) and
[facility reliability guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-setup-reliability) for workflow,
disclosures, provenance, preservation/Undo behavior and scoped evidence.

The October 28 follow-up added map-pin location, a custom polygon area, facility v2
courtyards/holes, raised bases and independent non-overlapping building parts.
Overlapping parts/envelopes and invalid/incomplete geometry are still excluded
with a visible reason. Imagery assistance, generic GIS/BIM adapters, live-provider
and installed local-service qualification, current-site accuracy and the novice
study remain open. [Issue #6](https://github.com/bartytime4life/Intelligent-DVR-Tool/issues/6)
tracks remaining acceptance; [setup research](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-setup-research) retains dated
proposals. Address search is implemented, with external availability unqualified.

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/facility-builder.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
