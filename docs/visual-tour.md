# A workspace you can see through

[Home](../README.md) · [Try it](getting-started.md) · [Test evidence](verification/README.md)

These visuals are captured from the actual React program. All camera scenes are generated artwork; detection overlays and sample playback are simulated. The facility is fictional. These demonstrations establish interface behavior, not operational surveillance or recognition quality.

![Edited walkthrough of five actual prototype screens.](media/workspace-tour.gif)

## Still-image tour

Use the stills below to inspect the interface without looping motion. Every animation has a static alternative. GitHub's image renderer does not provide a project-controlled reduced-motion or pause switch for GIFs.

## 1. Observe the scene

![Four-view wall with compact review queue and five source selectors. Generated scenes are marked SAMPLE.](media/monitor.webp)

The central 2×2 wall keeps the images dominant. The right queue surfaces observations needing review; the bottom strip changes the selected source. Individual tiles can expand or hide their overlays. Scrubbers demonstrate the interaction over still artwork; they do not replay a camera recording.

**Try:** open Monitor, expand Loading Dock, close it, toggle its overlay and select Parking Lot. Imported recording observations remain separate from sample imagery.

## 2. Review the evidence

![Review dialog showing a simulated scene, configured rule, score, note and confirm/dismiss controls.](media/review.webp)

Review brings the observation, rule, score and decision into one dialog. A score of 0.87 on this sample is fixture content, not measured accuracy or risk. A confirmation records a review decision; it triggers no external action.

**Verified in this sweep:** a note was entered on the synthetic Loading Dock observation, confirmation reduced the queue from two to one, and the resulting history entry showed Confirmed.

![History showing the confirmed synthetic observation and another awaiting review.](media/history.webp)

Decisions save in this browser. They have no multi-user access controls or tamper-evident audit guarantee. Export before clearing site data.

## 3. Make the rule explicit

![Zone editor with generated scene, rectangular zone and editable geometry and rule controls.](media/zones.webp)

Define the region, label, dwell time and score threshold. Numeric geometry controls accompany pointer drawing. “Object” is a sample category; actual detector classes must match the selected model's supported labels.

**Try:** adjust Width (%), save the rule and use Try simulated event. Browser-rule export is distinct from the edge CLI's rule format; see the [edge guide](../edge/README.md).

## 4. Build the facility

![Fictional facility in the 3D planner, with buildings, cameras, estimated coverage and guided workflow.](media/facility.webp)

Set a location, draw buildings, name floors and rooms, place cameras, inspect estimated ground visibility and rehearse a route. The map starts with a local grid; online street tiles are optional.

![Actual L-wing, U-wing and round building additions, shown as an edited animation.](media/building-shapes.gif)

*Three added-shape states, edited into a loop. [Static U-wing](media/shape-u.webp). Dimensions are editable planning inputs, not inferred measurements. Each demonstration addition was undone.*

Seven shapes are available. Rotation and metric/imperial inputs help with starter layouts. Measurement references explain the examples' basis; they do not certify a structure. [Full facility guide](facility-builder.md).

## 5. Begin with open map data

![OSM draft panel with bounded area fields, provider disclosure, offline import and source attribution.](media/map-starter.webp)

The current starter offers submitted address search, GPS/numeric origin, selectable public/local Overpass services and offline JSON file/paste review. It supports complete simple ways and selected outer-only relations, preserving provider, way/relation ID, ODbL license and height/floor basis. Review precedes explicit additive/replacement apply. The image above captures an earlier panel; its [media provenance](media/README.md) is unchanged.

The original capture sweep inspected the panel and ran adapter tests. It did **not** establish live provider availability, completeness of a real facility, GPS accuracy, interior reconstruction or building-code compliance. Supported outer-only relations were added later; courtyards, parts, raised bases and invalid/incomplete geometry remain excluded. [Current evidence](facility-setup-reliability.md) · [Dimensions and source limits](map-measurements-and-shapes.md).

## 6. Rehearse the handoff

![Actual timeline states showing a planned route crossing camera coverage and gaps.](media/facility-rehearsal.gif)

*[Still at approximately 15 seconds](media/route-15.webp). The 31 captures sample the slider across the fictional 30-second route, with time compressed for display.*

The marker follows a planned route. Coverage changes create proposals for review; the UI labels blind spots and simulated links. No actual movement, identity verification or camera association is being measured.

The model excludes floor/roof slabs, doors, windows, furniture, terrain, lens distortion, illumination and recognition quality. Colored coverage estimates ground-plane geometry. It does not establish detection or identification range.

## Beyond the pictures

The offline analyzer, annotation evaluator and synthetic capacity model run separately from the browser. The browser does not open camera streams or perform detector inference. Read the [architecture](architecture.md) and [verification index](verification/README.md) before interpreting a demonstration as a deployment result.
