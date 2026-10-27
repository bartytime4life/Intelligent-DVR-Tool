# Motion with provenance

All interface pixels come from actual browser screenshots. No UI mockup or generated product screenshot is substituted for the running program. Generated camera artwork already belongs to the prototype and remains marked SAMPLE.

| Asset | What it shows | Editing | Static alternative |
| --- | --- | --- | --- |
| [Workspace tour](workspace-tour.gif) | Monitor, review dialog, confirmed event history, Zones, Facility | Five screenshot states at 2.3 seconds each, looping; captions added | [Visual tour](../visual-tour.md#still-image-tour) |
| [Facility rehearsal](facility-rehearsal.gif) | Actual slider states across a fictional 30-second route | 31 screenshots at approximately one simulated-second intervals; time compressed and looping | [Route state](route-15.webp) |
| [Building shapes](building-shapes.gif) | Actual L-wing, U-wing and round additions | Three screenshot states at 2.4 seconds each, looping | [U wing](shape-u.webp) |
| [Cover](cover.webp) | Actual complete monitor screenshot with editorial heading | Resized and framed; no interface content altered | [Unframed monitor](monitor.webp) |

Captures were made October 27, 2026 in a desktop view in the in-app Chromium browser, from the existing local development preview. The displayed sample date (October 24) is fixture content, not the capture date. The screenshot dimensions are 1761×1292 pixels. No live camera, real facility, live GPS, provider retrieval or trained inference was recorded for these visuals.

The preview source was local facility revision `2b6290e`; the displayed `App.jsx`, `FacilityBuilder.jsx`, `FacilityStarter.jsx`, facility model/map/starter and facility CSS blobs match main `5fbb604cd0a2962a0bb830fefe8475a161a9b737`. See [source hashes](../verification/2026-10-27/source-hashes.json). Other application text/style files were synchronized from main for the automated checks; this is not an exact production-deployment recording. Native development-server startup was unavailable in the restricted test executor, so the already-running preview was used.

## Recreate the media

1. Start the app locally. Use a dedicated browser profile with synthetic sample state, online tiles off and no private metadata. Set the capture viewport to reproduce 1761×1292-pixel screenshots.
2. Save screenshots as `docs/media/captures/monitor.png`, `review.png`, `history.png`, `zones.png` and `facility.png`. Confirm the synthetic Loading Dock event and inspect its history entry.
3. In Facility → Handoffs, scrub the fictional sample route from 0 to 30 seconds. Save `route-00.png` through `route-30.png`. Wait for each visible state before capturing; keyboard increments are 0.1 second. Captures may land slightly before a nominal whole second, so the animation labels snapshot indexes.
4. In Buildings add L wing, U wing and Round at east=115 m, with the default 32×40 m dimensions and 8 m height. Capture `shape-l.png`, `shape-u.png`, `shape-round.png`; Undo each addition. Capture the expanded OSM draft panel as `map-starter.png` without making a provider request.
5. With Pillow installed for documentation tooling, run `python3 scripts/build-docs-media.py`. The script resizes screenshots, adds external captions and encodes GIFs with a shared palette. It does not perform inference or draw replacement interfaces.
6. Inspect all assets and refresh `manifest.json` hashes deliberately. Do not treat regeneration as a detector or capacity test.

Raw source captures are transient and excluded from Git. Published media has SHA-256 hashes, dimensions and frame counts in [manifest.json](manifest.json). The three animations together are about 1.3 MB; they are documentation assets, not included in the application bundle. Static alternatives support readers who prefer no looping motion. GitHub's GIF renderer has no project-controlled reduced-motion setting.
