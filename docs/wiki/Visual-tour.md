# A workspace you can see through

[Home](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Home) · [Current visual atlas](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-atlas) · [Media provenance](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/media/current/README.md) · [Product status](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Product-status)

This page is a dated visual tour of the software **and its earlier prototype**. The newest images below are genuine interface captures from a headless browser test that connected **no real cameras**. Older sample scenes are preserved in the historical section with their original fictional/animated status.

## PR #61 interface captures: map, monitor and system

![Original illustrative overview of the current DVR application: schematic geometry and camera-review boundaries.](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/current/overview.svg)

| Monitor · connect only on request | Facility Studio · map-first planning |
| --- | --- |
| ![Current Monitor desktop interface with the real-source chooser and no camera streams](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/current/monitor-desktop.jpg) | ![Current Facility Studio desktop interface with task selector, local plan and camera workspace](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/current/facility-desktop.jpg) |
| **Three intentional source choices** (webcam, configured LAN RTSP, permitted public). Preview alone is not recording or AI. [Camera setup](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Camera-sources). | **Compact task chooser, one saved-site inventory, geometry tools and camera inspector.** Field optics and visibility are not certified. [Facility guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-planning). |

| Monitor · mobile | Facility Studio · mobile | System · mobile |
| --- | --- | --- |
| ![Monitor first-run source selector at 390px](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/current/monitor-mobile.jpg) | ![Facility editor on 390px mobile test viewport](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/current/facility-mobile.jpg) | ![System capacity planner at 390px; values are defaults, not measured hardware](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/current/system-mobile.jpg) |
| No automatic stream. | Long forms still require real touch testing. | Planner, not a host performance probe. |

*Dated screenshots: [Chromium job 41263964836](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/41263964836), source `9719eda`; 1440×1000 and 390×844 viewports. Full [source and file manifest](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/media/current/manifest.json). The successful 92 browser scenarios describe that revision and use controlled fixtures, not on-site acceptance.*

Later merged features are not pictured here: [guided training](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guided-training), [consent-based enrollment and possible matches](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Person-enrollment), and [macOS source setup](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/local-analysis-service.md#start-the-local-application). See [product status](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Product-status) for their implementation and qualification boundaries.

## The human-controlled recording journey

![Schematic of user-approved source, local capture, bounded analysis, source-matched human review and explicit exports.](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/current/workflow.svg)

**Connect, record, analyze, review, export.** Each stage is an explicit operator action. The local single-camera recorder is separate from the Monitor preview wall. A review observation is metadata, and its SHA-256 proves file correspondence, not image authenticity or the model's accuracy. [Full workflow](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recording-workflow).

## Image science without invented certainty

![Original schematic of four fitted sample points and an independent check point on a measured ground plane.](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/current/facility-science.svg)

Image diagnostics expose luma, histograms, clipping proxies, Sobel edge energy and A/B differences. The experimental planar ruler requires a measured common plane, at least four fitting markers and a withheld check inside the reference hull. It is not a 3D tracker, identity system or verified optical survey. [Image lab](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Image-diagnostics) · [Planar method](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Planar-calibration).

## Historical prototype captures

The images and GIFs below were taken in the **October 27, 2026 prototype**. They used **generated camera scene artwork, simulated observations and fictional buildings**. They are **not a current Monitor start screen, real live camera recording, or recognition benchmark**. Their unchanged [original provenance and hashes](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/media/README.md) allow readers to understand the development history.

### Archived workspace loop

![Edited animated tour of five historic browser screens with fictional camera scenes and sample observations.](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/workspace-tour.gif)

*Animation may loop; static alternatives are shown below. There is no project-controlled pause or reduced-motion behavior for GitHub's GIF renderer.*

### Historic Monitor / review / history

| Simulated camera wall | Human review dialog | Review history |
| --- | --- | --- |
| ![Archived old Monitor with generated SAMPLE camera scenes.](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/monitor.webp) | ![Archived synthetic event review dialog with a fixture score and note.](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/review.webp) | ![Archived historical queue with fictional decisions.](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/history.webp) |

In this older experiment, sample scores and playback controls were interface fixtures. The present Monitor starts empty and connects only to operator-approved sources. For real evidence, compare the selected recording with its original and retain human review. [Recognition workflow](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/recording-recognition.md).

### Historic Zones, facility shapes and OSM starter

| Zone rules | Fictional facility | OSM draft review |
| --- | --- | --- |
| ![Older Zones editor on generated scene, with a rectangular rule region](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/zones.webp) | ![Earlier 3D facility with estimated sector cones and fictional structures](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/facility.webp) | ![Earlier OSM review panel; public provider availability not established](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/map-starter.webp) |

![Historical animation of L-wing, U-wing and rounded building additions in an earlier Facility editor.](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/building-shapes.gif)

*Static [U-shaped example](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/shape-u.webp). These were plan-edit demonstrations, not surveyed architecture.*

### Simulated route and handoff

![Older simulation scrubbing a fictional route through planned camera coverage and gaps; there is no person tracking or physical detection.](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/facility-rehearsal.gif)

*Static [route state](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/route-15.webp). The animation accelerates 31 simulated samples of a planned route and does not establish continuous coverage, detection or camera identity association.*

## Read before deployment

![Schematic of browser, local service, review and explicit export boundaries.](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/current/data-boundary.svg)

The present software can run bounded local video tasks, but real webcam/DVR compatibility, optical calibration, recognition quality, sustained recording, native performance and 100+ camera operation require **separate device and operator acceptance**. [Field runbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Field-acceptance) · [Evidence index](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Evidence-and-validation) · [Architecture](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Architecture-and-data) · [Project terms](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/SECURITY.md).

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/visual-tour.md) · Generated from the checked documentation source; historical and schematic images are labeled.
