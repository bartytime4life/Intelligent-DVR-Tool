# Open-map starter layouts and measurements

Implemented 2026-10-27 in the existing MapLibre/Three.js editor. No subscription,
API key, recording upload or live person tracking is required.

## Workflow

1. Facility → Locate site → submit an address/place search, use GPS or manual coordinates → review → Save site.
   GPS suggests device location; it does not measure buildings. Changing the
   origin moves the whole local plan geographically.
2. Open **Draft buildings from OpenStreetMap**. Select a rectangular search area
   by width/depth and east/north offsets. Its boundary appears in amber. Numeric
   controls support keyboard input; pointer-drawn AOIs remain future work.
3. **Load open building drafts** sends selected bounds to the chosen Overpass provider (Private.coffee by default; the main public instance or a configured local service are selectable). It does not send local rooms, cameras, routes or recordings.
   Nothing is requested on page load or merely by opening the panel.
4. Review map shells, dimensions and height/floor assumptions. Uncheck unwanted
   buildings. Boundary-crossing footprints are kept whole. Explicitly choose
   additive import or a clean replacement site, then **Use selected buildings**.
   Replacement clears the old cameras/rooms/labels/route; Undo restores it.
5. Buildings → **Common building shapes** offers Rectangle, L, T, U, Cross,
   Octagon and Round. Set width, depth, wing thickness, rotation, position,
   height and floors. Inputs support meters/feet; stored geometry uses meters.

Offline fallback: open a JSON file or paste an Overpass JSON extract with complete way/member geometry into the same review flow. This is not a generic GeoJSON, imagery or BIM importer.

## Measurements and assumptions

Footprint vertices are georeferenced longitude/latitude, not pixels in a screenshot.
They are converted to the editor's local east/north coordinates. Area uses the
polygon; perimeter sums its edges. Length/width use the smallest enclosing
rectangle across the footprint's edge orientations, so rotating a rectangle does
not inflate its measured dimensions. For L/U shapes these are enclosing dimensions,
not solid rectangular floor area. Both meters/feet and m²/ft² are displayed.

The inherited projection approximates 111,320 meters per latitude degree and
applies cos(latitude) to longitude. It has latitude-dependent scale error and is
not a survey-grade local CRS. Coordinate rounding or display decimals do not
establish accuracy. Mapping errors, roof overhangs, old data and GPS accuracy need
on-site verification before camera calibration or operational decisions.

Supported OSM height tags take precedence. Otherwise tagged floors × 3 m is an
explicit rendering estimate. Missing floors use a one-floor placeholder; missing
height/levels use a 6 m placeholder. No interiors or real floor counts are inferred.
Source update timestamps describe OSM edits, not survey/imagery dates. Original
height/floor basis remains a source record when users edit the shell.

## Construction references

Codes constrain designs; they cannot establish an existing building's dimensions.
The app's reference panel therefore does not snap imported outlines to a code
minimum or claim compliance. Local adoption, amendments, occupancy and exceptions
must be checked for the actual facility.

| Reference | Planning meaning | Limit |
| --- | --- | --- |
| 2024 IBC §1208.2: general 7 ft 6 in / 2.286 m ceiling minimum | Interior clear-height reference | Exceptions apply; not floor-to-floor or roof height |
| ADA §403.5.1: generally 36 in / 0.9144 m clear route | Corridor/route reference | Turning, passing and scoping rules also apply |
| ADA §404.2.3: generally 32 in / 0.8128 m clear opening | Door reference | Not nominal door-leaf width; depth/maneuvering rules apply |
| SCI portal-frame examples: 25–40 m spans, 6–10 m frame spacings | Grounds the editable 32 m span × five 8 m bays template | UK industry examples, not U.S. code or universal dimensions |

The default 8 m template height is an editable example. No structural member
sizing, fire/egress analysis or accessible-route compliance calculation is made.
Round uses 32 segments. U wings have an open recess; fully enclosed courtyards
require a future holes-capable geometry schema.

## Bounds, provenance and service

- Manual POST to `https://overpass.private.coffee/api/interpreter`, whose published
  terms permit commercial use and request fair shared-resource use. Terms/privacy
  are linked in the UI. It is not a critical-infrastructure dependency or SLA.
  Private/larger deployments should prepare self-hosted extracts.
- 20–500 m per search side; area corners within 1,800 m of origin; no date-line
  crossing. Server/client timeouts: 20/30 seconds. Minimum request interval:
  15 seconds. Response cap: 300 elements and 2 MB streamed bytes. No auto-retry.
- Cancel/unmount or changed plan/area invalidates late responses. Partial/runtime
  error responses are rejected. Existing source IDs are excluded on repeat imports.
  Final plans still obey the 100-building and ±2 km limits.
- Complete simple ways and complete outer-only multipolygon relations are supported. Relation segments may be joined or disjoint outer rings split into editable shells. Courtyards, incomplete/overlapping/nested relations and their members, parts, raised bases and invalid geometry are excluded with reasons.
- Bounded per-building source records preserve OSM provider/way or relation ID, ODbL license,
  retrieval/source timestamps and original height/floor basis through JSON export.
  Unknown fields/media URLs are discarded; labels render as text. Attribution is
  visible on the map even when street tiles are off.
- OSM is ODbL. Review attribution/derivative-database/share-alike obligations before
  distributing enriched datasets. Combined plan export retains source fields but
  does not decide the legal status of an arbitrary private database or collection.

## Primary sources checked 2026-10-27

- [OpenStreetMap copyright/license](https://www.openstreetmap.org/copyright)
- [Private.coffee service, terms and privacy](https://overpass.private.coffee/)
- [Overpass service guidance](https://wiki.openstreetmap.org/wiki/Overpass_API)
- [OSM levels](https://wiki.openstreetmap.org/wiki/Key:building:levels) and [height units](https://wiki.openstreetmap.org/wiki/Key:height)
- [2024 IBC §1208.2](https://codes.iccsafe.org/s/IBC2024P1/chapter-12-interior-environment/IBC2024P1-Ch12-Sec1208.2) (official indexed text verified; full-page access returned 403)
- [U.S. Access Board ADA chapter 4](https://www.access-board.gov/ada/chapter/ch04/)
- [SCI industrial-building examples](https://steelconstruction.info/topics/cost-of-structural-steelwork/cost-planning-industrial-buildings)

See [facility setup reliability](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/facility-setup-reliability.md) for address-search privacy, local-service paths, licensed source evaluation, pinned real extracts, browser regressions and the distinction between scripted effort and unmeasured novice usability.

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/map-measurements-and-shapes.md) · Documentation refresh: October 27, 2026.
