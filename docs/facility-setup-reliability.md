# Dependable facility setup: implementation and qualification

Updated October 28, 2026. This increment advances issue #6 with pointer location,
custom areas, v2 courtyard/base geometry and an opt-in native local-service route.
The [qualification record](verification/facility-2026-10-28/README.md) separates
checks from field acceptance. **Issue #6 stays open:** arbitrary overlapping parts,
live providers, installed regional services, real GPS/site accuracy and the novice
comparison remain unqualified.

## Guided workflow

1. **Locate site:** submit an address, request one GPS suggestion, pick a map pin,
   or enter coordinates. Suggestions populate fields only. Review and **Save site**;
   changing the origin geographically relocates the entire existing local plan.
2. Open **Draft buildings from OpenStreetMap**. Use numeric rectangular bounds,
   **Draw search area**, or **Custom polygon** with keyboard-editable east/north
   vertex pairs. Add/remove/move corners in the text field; closure is automatic.
   Escape/Cancel stops pointer drawing. Polygon selection never commits a plan.
3. Both area modes have bounds 20–500 m per side within 1,800 m of the origin.
   Custom polygons have 3–50 corners, simple topology and at least 1 m² area. The
   provider receives the bounding rectangle; the client filters against the actual
   polygon and retains whole intersecting shells. Courtyard-only intersections do
   not become buildings. Changing the area/provider/site invalidates drafts and
   pending network/file results. Switching away from a polygon cancels drawing.
4. Choose the disclosed provider and explicitly **Load open building drafts**, or
   open/paste a complete Overpass JSON extract (2 MB maximum). No public fallback
   occurs when the local service is unavailable. No text is sent while typing.
5. Review source dates/license, footprint area minus courtyards, roof and base
   heights, floors and estimates. Uncheck unwanted buildings, then explicitly
   apply. Add preserves cameras/rooms/labels/routes; clean replacement clears them
   as disclosed. Undo restores the previous transaction.
6. In **Buildings**, rename, move/resize, edit roof height/base and occupied floors.
   Courtyards transform with the exterior. Room containment rejects crossing,
   touching or enclosing courtyard space. No interiors are inferred.

Numeric selection and offline review remain available when WebGL is unavailable.
The pointer controls need a ready map. External tiles remain off by default.

## Geometry contract

New exports use `intelligent-dvr.facility.v2`. Ordinary v1 plans migrate in memory
without changing local geometry. The existing browser storage key is retained.
V2 adds optional `holes` (at most 20 and 1,000 total vertices per building), `base`
(elevation above ground, default zero) and `part` (independent building-part flag).
`height` is the roof's elevation above ground; occupied volume is base to height.
Older code rejects v2 instead of silently discarding its courtyards/bases. Export
before rollback; there is no automatic downgrade or destructive storage migration.

Complete ways and multipolygon outer/inner members can stitch reversed segments.
Each hole must belong to exactly one exterior and stay strictly inside it. Touching,
intersecting, nested, duplicate, incomplete or unknown-role topology is excluded.
Disjoint exteriors become separate shells; relation members never import separately
when their parent fails. Each ring remains bounded at 201 points. OSM source ID,
license, retrieved/edit date and height/floor basis survive validation and export.

Tagged `min_height` is retained; `building:min_level × 3 m` is explicitly an estimate
when no base height is supplied. Occupied floors subtract a tagged minimum level.
Independent non-overlapping parts and vertically disjoint volumes are supported.
Overlapping part/envelope volumes are excluded together with a visible reason;
the adapter does not invent a union/decomposition or support arbitrary OSM building
relations. Full building-parts acceptance is therefore still open.

Map polygons preserve holes and extrude from the base. Coverage includes exterior
and courtyard walls at their actual modeled elevations. Room walls start at the
base plus their occupied-floor offset. Coverage remains an **estimated opaque-wall
ground visibility** model: no slabs, windows, furniture, calibrated optics or
identity association. Recorded OSM coordinates are not survey ground truth.

The pinned 2014 church extract remains excluded because its relation lacks a
building tag; it is not relabelled to force success. Complete synthetic courtyard
relations test the new contract independently. Historical extracts retain original
bytes, hashes, provenance and ODbL notice.

## Retrieval and delivery

| Request | Bound |
| --- | --- |
| Photon | Explicit submitted text, five results requested; 100 KB response, 12 s deadline, one active search, 1.5 s spacing, 20-query in-memory cache |
| Overpass | Explicit rectangle, 20 s server/30 s client deadline, 300 elements/2 MB, 15 s UI spacing, four-response in-memory cache |
| Both | No credentials, referrer or redirects; no automatic retry/failover; errors preserve saved plans |

## Local and offline delivery

The [native local-delivery guide](facility-local-delivery.md) describes fixed
loopback Photon/Overpass routes for Vite development and preview. Native launchers
use preview and inherit explicit operator environment settings. Services and
regional databases must already be installed separately. Sites' Worker remains
unchanged and does not provide these local routes. Public providers still require
their own live qualification; simulated HTTP success is not proof of installed
Photon/Overpass or current-site completeness.

## Human acceptance

Use the [novice study kit](facility-novice-study.md) to compare the original three
proposed flows with 5–8 novice users. Imagery assistance is unavailable and is never
silently substituted with address/GPS/offline variants. The kit reports this as a
blocked comparison. Targets are 80% unaided completion, median attempt duration
under three minutes and correct recognition of estimated heights. No participants
or survey/device trials have been performed by this change.

## Completed CI receipt

Code revision: `c39961338478d535abeed45257be7685c84f34f2` (2026-10-27).
[Chromium run 40571593636](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/40571593636)
passed all **6 browser scenarios**, including actual map readiness, with zero retries.
The uploaded evidence includes the JSON report and `reviewed-exteriors.png`.
[Cross-platform run 40571602245](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/40571602245)
passed on **Linux and Windows**: **46 frontend and 4 Sites tests** per platform;
Python **66 passed on Linux, 63 passed with 3 Linux-only skips on Windows**
(66 discovered on each). Production builds, documentation links/media checks and
wiki drift checks passed. Skipped cases are not counted as passes.

One automated ready-page numeric/offline flow reported **5.926 seconds** from
entering the recorded origin through selecting/applying two exterior shells.
A prescribed correction of one building-height field followed by one Save reported
**1.944 seconds**. The flow also verified both Undo steps and unchanged camera/room
metadata. Page startup, source acquisition, human review time and field verification
are excluded. The address suggestion test used a mocked Photon result; these
numbers do not measure live geocoding/retrieval or how many corrections an actual
site requires. The 80%/three-minute novice targets remain untested.

## Merged-main follow-through

The October 28 audit also checked the merged-main runs at
`82c862c68735720b8840461fc624e8dbe148a53a`: **116 passed on Linux; 113 passed and
3 skipped on Windows**, plus **6 separate Chromium scenarios**. The
[main-baseline record](verification/facility-2026-10-27/README.md) contains exact
run/job URLs, timestamped excerpts and distinct scripted effort observations.
Earlier timings above remain attributed to their original run.
