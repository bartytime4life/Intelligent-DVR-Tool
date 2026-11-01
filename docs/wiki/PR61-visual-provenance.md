# Documentation visual collection — PR #61 captures

[Visual atlas](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-atlas) · [Source documentation](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guide-index) · [Historical media](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Historical-visual-provenance)

These are **current-software browser captures and original explanatory diagrams**, not artificial live-camera images. The screenshots were recorded by the [successful Chromium job](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/41263964836) using source commit `9719eda31887ac5991a487f2107a9b31a93b14e3`, with no live camera, network provider, or pretrained detector. The app used a blank camera wall and a blank facility; System fields were browser planning defaults.

**Revision boundary:** `current/` is the collection's original directory name, not a promise of latest-main screenshots. Captured November 1 UTC (October 31 Central), these five images predate the Train workspace and enrolled-person suggestions. Their pixels and manifest hashes are retained unchanged. Read the [capability register](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Product-status) for later merged behavior; do not apply the capture job's test counts to that later source.

The later [November 1 guide collection](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-provenance) captures merged source `2566d845`, including Train and the expanded facility tools. This PR #61 collection remains unchanged historical evidence.

## Tested interface captures

| Surface | Desktop | Mobile (390 px) |
| --- | --- | --- |
| Monitor · empty / opt-in source chooser | ![Monitor source chooser in the real React application, desktop Chromium, no connected camera](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/current/monitor-desktop.jpg) | ![Monitor opt-in connection workflow in mobile Chromium](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/current/monitor-mobile.jpg) |
| Facility Studio · local plan editor | ![Facility Studio map-first interface with step selector and empty facility, desktop Chromium](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/current/facility-desktop.jpg) | ![Facility Studio step selector and map editor, mobile Chromium](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/current/facility-mobile.jpg) |
| System · capacity planner | [System guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Resource-controls) | ![System sizing planner on mobile browser; values are editable defaults](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/current/system-mobile.jpg) |

Image provenance is bound to the [machine-readable manifest](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/media/current/manifest.json), including Git blob identities, dimensions, and the source CI job. JPEG captures are compressed documentation images, not pixel-faithful source recordings or detector output.

## Visual language

![Original diagram: product operations shown as schematic facility geometry, not a real surveillance screen](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/current/overview.svg)

| Artwork | Teaches | Important boundary |
| --- | --- | --- |
| ![Illustrated operator-controlled flow](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/current/workflow.svg) | [Recording and review workflow](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recording-workflow) | No automatic camera recording, AI or enforcement |
| ![Illustrated planar reference calibration](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/current/facility-science.svg) | [Calibration and image diagnostics](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Planar-calibration) | Plane-only estimation; not optical/physical accuracy |
| ![Four local data and export boundaries](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/current/data-boundary.svg) | [Architecture and data ownership](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Architecture-and-data) | Source match is not authenticated origin |
| ![Stages toward a 100 camera target](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/current/scale-gates.svg) | [Staged performance qualification](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/100-camera-plan) | Scale is a goal, not a capacity result |
| ![Computer planning budget lanes](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/current/system-planning.svg) | [Resource controls](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Resource-controls) | Planning estimates are not system quotas |

The diagrams are original, static SVGs with no scripts, external fonts, remote images or tracking beacons. Labels are intentionally conservative. SVGs remain legible at desktop width and have descriptive Markdown alt text. Readers who need textual alternatives can use the linked guides. The historic animation assets remain in `docs/media/` with their own untouched October 27 provenance.

## Reproduce and audit

1. Check out the screenshot's exact source commit; run the [Facility browser configuration](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/playwright.facility.config.mjs) with Chromium and offline fixture routing. See the [workspace audit](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Workspace-audit-2026-10-31).
2. Compare the saved `qa-local/workspace-audit` PNGs in the linked GitHub Actions artifact against these compressed JPEGs. They are reference thumbnails; crop, text antialiasing and compression can differ.
3. Run `python3 scripts/check-docs.py` from the repository root. Its current-media checks verify each asset's exact Git blob hash and size, and enforce an independent visual-asset budget.
4. Only claim real camera, storage, detector, map-source or physical-mobile readiness after the [field acceptance runbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Field-acceptance) has recorded actual operator and device results.

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/media/current/README.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
