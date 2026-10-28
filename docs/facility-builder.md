# Guided facility builder

[Visual tour](visual-tour.md) · [Getting started](getting-started.md) · [Verification index](verification/README.md)

![Actual fictional sample facility in the 3D planner. Coverage is estimated.](media/facility.webp)

The **Facility** navigation item opens a browser-local, subscription-free planning
editor. Direct entry is `/#facility`. The existing camera wall and event review
remain available. This is an editable planning prototype, not a calibrated digital
twin or an operational multi-camera tracking service.

## Workflow

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
3. Choose a building and floor. Trace rooms within its footprint, name rooms,
   place labels, and inspect the floor view. Floors divide building height evenly.
4. Place a camera on the map or add one with coordinates. Set ground-relative
   mounting elevation, direction clockwise from north, downward tilt, horizontal
   and vertical field of view, and maximum viewing range. Save the camera.
5. Inspect the selected camera's ground-plane visibility estimate and 3D volume.
6. Draw a route, run the 30-second rehearsal, scrub it, and review proposed camera
   transitions. Links and separations are session-only simulation decisions.

Drawing uses clicks and polygon closure (line routes finish by double-click).
Escape cancels. Building and camera placement have numeric alternatives. Rooms
currently require pointer drawing; keyboard room drawing is an accessibility gap.
Undo restores the previous 20 committed edits. Import from a file or the Paste JSON dialog validates before replacing
the current plan; replacement can be undone. Export is a plain JSON metadata file.

## Visibility model and evidence limits

Camera inputs describe an idealized pinhole view intersecting a horizontal ground
plane. The near/far intersection uses mounting height and vertical viewing angles;
range is capped by the configured maximum. The horizontal viewing angle determines
the sector. Building and room wall intersections shorten rays when the modeled
wall spans the ray's height. The displayed sector samples 49 directions.

This approximation treats wall polygons as opaque and does **not** model floor or
roof slabs, door openings, windows, furniture, terrain, lens distortion, lighting,
pixel density, motion blur, or recognition quality. A colored footprint is not a
claim that a person can be detected or identified at that location. The current
Three.js volume is an illustrative rendering of that estimate.

The route is a planned, simulated path. It is not an observed trajectory. Rehearsal
uses 61 distance-spaced samples over 30 seconds and labels gaps explicitly.
Transitions are proposals, not proof of identity continuity. Real cross-camera
tracking remains separate work: synchronized recordings, camera/floor calibration,
per-camera tracklets, qualified association models, uncertainty and source review.

## Local data and maps

Plans persist in `localStorage` under `dvr.facility.v1`. A storage failure is visible
and leaves the current plan in memory so it can be exported. These records are
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
The workspace's pre-existing optional Google Font has a system-font fallback.

## Bounds and capacity

The JSON contract permits at most 100 buildings, 500 cameras, 500 rooms, 1,000
labels and 200 route points, in a 2 MB file. Coordinates are within 2 km of the
origin. It rejects invalid IDs, duplicate IDs, unsupported numeric ranges,
self-crossing/degenerate footprints, and orphaned or out-of-floor rooms. It copies
only declared fields and does not fetch media URLs from imported metadata.

The map renders camera inventory points as GPU features, limits coverage sectors
to 12 cameras (including the selection), displays at most 80 general text labels plus the selected camera label, and
renders a 3D volume for the selected camera only. Camera search, pagination and
the selected-camera dropdown provide access to the full inventory. Rendering is
event-driven; rehearsal updates at 10 Hz. The facility code and its map/3D
dependencies load only when Facility is opened.

The 100-camera automated case exercises **metadata validation and synthetic route
evaluation only**. It does not establish recording throughput, detector throughput,
video decoding capacity, target-host latency or live 100-camera operation.

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
[map/measurement guide](map-measurements-and-shapes.md) and
[facility reliability guide](facility-setup-reliability.md) for workflow,
disclosures, provenance, preservation/Undo behavior and scoped evidence.

Courtyards/holes, building parts, raised bases and invalid/incomplete geometry are
excluded. A polygon AOI, imagery assistance, generic GIS/BIM adapters, live-provider
and local-service deployment qualification, current-site accuracy and the novice
study remain open. [Issue #6](https://github.com/bartytime4life/Intelligent-DVR-Tool/issues/6)
tracks remaining acceptance; [setup research](easy-facility-setup.md) retains dated
proposals. Address search is implemented, with external availability unqualified.
