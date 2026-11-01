# Guided facility builder

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

1. Set the facility name and geographic origin. Coordinates are longitude then
   latitude; local geometry is meters east/north of that origin.
   **Use my location** requests one browser position after a click. It fills a
   suggestion, reports accuracy and requires Save site to commit. Denied,
   unavailable and timed-out requests retain manual coordinate entry. Cancel
   ignores late results. No location request starts on page load or continuously.
   Submitted address/place search is another route: choose a provider, submit,
   select a suggestion, review coordinates and Save site. Nothing is sent while
   typing. Changing the origin relocates all existing local geometry geographically.
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
6. Draw a route, run the 30-second rehearsal, scrub it, and review proposed camera
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
plane. The near/far intersection uses mounting height and vertical viewing angles;
range is capped by the configured maximum. The horizontal viewing angle determines
the sector. Building and room wall intersections shorten rays when the modeled
wall spans the ray's height. The displayed sector samples 49 directions.

This approximation includes planned doorway gaps and opaque lintels above their
entered heights. Exterior glazing stays opaque to this estimate. It excludes floor and roof slabs, furniture, terrain,
lens distortion, lighting,
motion blur, or recognition quality. Pixel density is a separate, centre-of-image
planning estimate (below). A colored footprint is not a claim that a person can be
detected or identified at that location. The current Three.js volume is an
illustrative rendering of that estimate.

## Camera planning estimates

Everything in this section is labelled **Planning estimate — assumes ideal focus
and no compression**. None of it is a calibration, compliance or
recognition-quality claim.

- **Pixel density (DORI).** An optional `pixelsWide` (integer 320–7680) gives
  horizontal pixels per metre at slant distance *d* as `W / (2·d·tan(hfov/2))`.
  The IEC 62676-4 figures — Detect 25, Observe 62.5, Recognize 125 and Identify
  250 px/m — are used as planning thresholds. Each band's ground distance is
  `√(d² − z²)` for mount height *z*, clipped to the camera's modeled near/far
  ground range. The camera form shows a distance table; colored arcs on the
  selected camera's fan mark each limit and break where modeled walls shorten
  the view. Lens presets (2.8–12 mm) fill a **typical** horizontal view only;
  vertical view is unchanged, and a datasheet value always wins.
- **Coverage metrics.** The Coverage step grid-samples each enabled outdoor
  zone (at most 20,000 cells, minimum 0.25 m) and the handoff route (about every
  0.5 m, at most 20,000 samples) against the same cached fans the map draws,
  with a camera bounding-box prefilter and no polygon-union library. It reports
  coverage (≥1 camera) and overlap (≥2 cameras), includes any unsaved camera
  preview, and can overlay one zone's uncovered cells as merged row rectangles.
  Indoor and level zones show "not estimated" because coverage is ground-plane only.
- **Direct manipulation.** Dragging the selected camera (mouse or touch) or its
  round heading handle previews the move live on the map; release, Alt+Arrow and
  `[` / `]` change only the unsaved draft. Save camera commits, Discard preview
  restores it and Undo covers the commit. Escape cancels a drag.
- **Installer sheet.** Download installer sheet writes a printable, offline HTML
  page of the saved plan with the same restrictive CSP as the recognition report:
  an inline SVG plan (buildings, outdoor zones, route, estimated fans and camera
  bearings), and a per-camera table of ID, name, an optional `channel` label
  (≤60 characters), east/north, mount height, bearing, tilt, H/V field of view,
  range, resolution and DORI ground distances, followed by its interpretation
  limits. It contains no credentials, stream addresses or footage.

The route is a planned, simulated path. It is not an observed trajectory. Rehearsal
uses 61 distance-spaced samples over 30 seconds and labels gaps explicitly.
Transitions are proposals, not proof of identity continuity. Real cross-camera
tracking remains separate work: synchronized recordings, camera/floor calibration,
per-camera tracklets, qualified association models, uncertainty and source review.

## Local data and maps

Named plans persist in `localStorage` under `dvr.facilities.v1`. Existing
`dvr.facility.v1` data migrates once and remains untouched for recovery. A storage
failure is visible and leaves the collection in memory so it can be exported. These records are
editable local state, not an authoritative audit trail. They have no multi-user
authentication, encrypted-at-rest database, server retention or signed provenance.
Do not put camera credentials or recordings in a facility JSON file.

The default map uses only local geometry and a 20-meter grid. An optional online
street basemap requests only the visible viewport from OpenStreetMap after the
user enables it. The choice is not persisted. The map displays OSM attribution;
there is no tile-prefetch, bulk-download or offline-download feature. See the
[OSMF tile policy](https://operations.osmfoundation.org/policies/tiles/).
Private/offline deployments should supply independently licensed, self-hosted
tiles, imagery, fonts and other assets; no public tile service SLA is assumed.
The workspace font is bundled locally; it makes no external request.

## Bounds and capacity

The JSON contract permits at most 100 buildings, 500 cameras, 500 rooms, 1,000
labels and 200 route points, in a 2 MB file. Coordinates are within 2 km of the
origin. It rejects invalid IDs, duplicate IDs, unsupported numeric ranges,
self-crossing/degenerate footprints, and orphaned or out-of-floor rooms. It copies
only declared fields (cameras may add optional `pixelsWide` and `channel`, which
v3 files without them do not need) and does not fetch media URLs from imported metadata.

The map renders camera inventory points as GPU features, limits coverage sectors
to 12 cameras (including the selection), displays at most 80 general text labels plus the selected camera label, and
renders a 3D volume for the selected camera only. Camera search, pagination and
the selected-camera dropdown provide access to the full inventory. Rendering is
event-driven; rehearsal updates at 10 Hz. The facility code and its map/3D
dependencies load only when Facility is opened.

The 100-camera automated case exercises **metadata validation and synthetic route
evaluation only**. It does not establish recording throughput, detector throughput,
video decoding capacity, target-host latency or live 100-camera operation.

## Inspect video pixels and the calibrated ground plane

![Schematic of image reference markers mapped to a single measured ground plane, with a withheld check marker.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/current/facility-science.svg)

After placing cameras, **Image diagnostics** can freeze an operator-selected preview or locally opened recording frame, compare two frames and report image statistics. **Ground-plane calibration** fits user-marked correspondences and requires withheld checks and an operator-selected threshold before offering a plane-only ruler. These **experimental estimates** are not lens calibration, verified physical measurements, depth reconstruction or identity tracking. [Image science guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Image-diagnostics) · [Ground-plane guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Planar-calibration).

## Dependencies

- MapLibre GL JS 6.9.0 — BSD-3-Clause; package and lockfile pinned.
- Three.js 0.186.1 — MIT; package and lockfile pinned.
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
