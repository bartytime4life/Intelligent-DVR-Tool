# Facility workspace upgrades — 2026-10-29

The facility workspace now supports visible measurements, reusable building levels, direct camera aiming, explicit source previews, and restricted/object-watch planning.

## Build and measure

Select a building, room or zone to show boundary dimensions, usable polygon area and total boundary length. Courtyard dimensions are labelled separately. Routes show segment and total lengths. The map has a Dimensions toggle and a persistent Meters/Feet setting for display and numeric entry; plan coordinates remain metres. Switching units does not resize the plan. Polygon editors expose bounding spans, center position and individual edge length; the edge editor moves its end corner and changes adjacent edges. Line editors expose segment lengths and vertex positions. At most 64 dimension labels are drawn, with exact summary calculations retained. Small shapes suppress colliding labels; zooming in reveals additional edges. These are measurements of the drawn plan, not survey certification.

Floors & labels provides a floor stack, Add top level and Copy rooms upstairs. Adding a top level retains existing floor spacing; copying requires an empty destination and creates the next level if necessary. Changes remain undoable. Floor editing displays room walls for the selected building and floor. Room outlines are wall reservations independent of floor surfaces, so they can describe an atrium boundary.

## Floor openings, pathways and stairs

Use **Solid floor at this level** to remove or restore the whole floor slab, or draw a partial floor opening. Each opening on level n is also the ceiling void above n−1. Other levels retain their own slabs. Openings cannot overlap courtyards or other openings; cutouts must be fully inside the building. Restore solid floor retains any saved partial cutouts. **Convert selected room to opening** replaces that room outline with a cutout; Undo restores it.

Per-floor pathways are editable open lines. They must remain inside the building on solid floor and cannot cross or touch cutouts/courtyards. They are planning geometry, not detected movement or a verified accessible/egress route. Removing an entire floor with a pathway is rejected until the pathway is removed. Floor drawing switches to an overhead active-floor view.

**Add straight stair** uses the actual modeled level rise to calculate equal risers, tread run and clear reservation including two landings. Width, tread, riser count, landing depth, total reservation length, position, bearing and adjacent level pair are editable in meters or feet. The **Cut upper floor over stair run** action makes an explicit editable upper-floor opening and keeps the landings. Stair dimensions and openings remain separate after editing; review their alignment after changes.

General defaults and warnings refer to [2024 IBC §1011](https://codes.iccsafe.org/content/IBC2024V2.0/chapter-10-means-of-egress). They cover riser/tread sizing, clear width, landing depth and maximum rise per flight. The tool reserves clear stair/landing space; users must allow extra wall, handrail and door-swing space. Headroom, structure, guards, fire separation, occupancy-specific exceptions, local adoption/amendments and accessibility are not automatically checked. There is no compliance approval.

Plans export schema `intelligent-dvr.facility.v3`. Ordinary v1/v2 plans import and upgrade; v3-only geometry in an older schema is rejected to prevent silent loss. Openings, stairs, pathways and wholly open floors survive save/import/export/Undo. Copy rooms upstairs deliberately copies only room outlines.

## Place and compare cameras

Place a camera, use Move on map or Aim on map, then Save camera. Center camera moves the map to its planned position. The north compass and Reset map view restore orientation/framing without editing geometry.

Camera alignment offers an explicit webcam or configured local DVR preview, a toggleable center reticle, and planned horizontal/vertical angles, bearing and tilt. The image keeps its actual aspect ratio. The guide is uncalibrated: it does not measure the lens or certify visibility. Source selection starts no capture until Connect preview. Preview stops on changing camera, leaving the component, hiding the page or disconnecting; late permission/connect results are cleaned up. No physical PTZ movement, audio, recording or live AI is enabled.

## Restricted areas and unexpected classes

Zones & objects draws red restricted-person areas and amber object-watch areas. Floor zones must fit inside their building, outside courtyards. Disabled zones are gray. A camera image rectangle is manually configured separately because a map polygon cannot be projected into camera pixels without calibration.

Save the zone, export its recognition rules, then configure that file for analysis of a recording from the matching camera. Restricted rules detect person-class presence; object-watch rules flag supported COCO80 classes outside the expected-class list. Confidence, dwell and maximum sampling gap are explicit. Out-of-model objects, learned unusual behavior, abandoned-object identity and continuous live inference are not implemented. Dwell can accumulate across different objects of the same class; all resulting events require review.

Deleting a camera clears its image-region links while preserving zone geometry; Undo restores both. Deleting a building removes its rooms, indoor zones, openings, stairs and pathways. Replacing a complete facility clears all of these. Unsaved geometry, camera, stair and zone edits block navigation and import/export/Undo until saved or discarded.

## Verification

Base source: `eb925c8ad55686abdef33c4e882354bd75b987ce` (updated from the initial main revision while preserving public-webcam support).

- All JavaScript test files: 156 passed, one existing socket-gated test skipped in the restricted runner.
- Production/Sites build and four Sites packaging tests passed (existing large facility chunk warning remains).
- Six Python rule-engine tests passed.
- Actual Chrome checks: visible dimensions and measurement controls; floor copying and adding levels with 3.20 m floor spacing; click-to-aim changes bearing; camera draft guard; zone draft guard; camera deletion/Undo restores the image binding; 390px CSS layout without horizontal page overflow.
- Production Chrome checks: 4 ft stair width retained as 1.2192 m; 6 ft opening width retained as 1.8288 m; stair cutout selected its upper floor; whole-floor toggle and Undo retained partial openings; drawn per-floor path edited to 100 ft; removing its floor was rejected with an explanation.
- Browser-downloaded restricted-person rule loaded by Python RuleEngine and emitted a review event after two seconds of synthetic person observations. Expected-class export also passed a direct synthetic RuleEngine check. These establish contract behavior, not detection quality.
- Eight browser regression cases are included in `tests/browser/facility-workspace.spec.mjs` for CI. The new automated browser suite was not executed locally; the listed Chrome checks were performed through the available browser.
- Physical webcam/DVR alignment, representative detection accuracy, 100-camera operation and live AI were not qualified or activated.

The local preview runtime stopped during finalization. The final rebuild and tests passed, but the remaining environment blocked restarting the loopback server, so the final label-decluttering and courtyard stair-placement changes were checked by tests rather than another live capture. `docs/verification/2026-10-29-facility/workspace.png` shows the earlier measured workspace, before the additional stair/opening controls.
