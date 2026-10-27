<div align="center">

# Intelligent DVR

**See the scene. Plan the space. Review the evidence.**

A local camera-analysis foundation and visual review prototype from BARTA AI Solutions.

[Visual tour](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-tour) · [Start here](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Getting-started) · [Wiki](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki) · [Test evidence](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Evidence-and-validation)

![Actual camera-wall interface, with generated sample scenes and a human review queue. No cameras are connected.](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/cover.webp)

</div>

> **Working prototype.** The interface below is real; its camera scenes, overlays and playback are simulated. Recording analysis is a separate offline CLI. Live camera operation, representative detection accuracy and the required **100-camera capacity remain unqualified**.

## Watch the workspace unfold

![Animated walkthrough of the actual monitor, observation review, saved sample decision, zone editor and fictional 3D facility. These captured interface states are not live footage or measured detections.](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/workspace-tour.gif)

*Five actual browser views, edited into a looping walkthrough. [Still-image tour](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-tour#still-image-tour) · [Capture provenance](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/media/README.md).*

| Observe | Make a decision | Plan the facility |
| --- | --- | --- |
| Four-view wall, five selectable sample scenes, overlay controls and expanded views | Review observations, add notes, confirm or dismiss, search history and export decisions | Editable buildings, floors, rooms, labels, camera placement and estimated coverage |
| [Explore the wall](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-tour#1-observe-the-scene) | [Follow a review](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-tour#2-review-the-evidence) | [Build a plan](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-planning) |

## Put the space in motion

![Animated captures of a fictional route rehearsal moving through estimated camera coverage and blind spots. No person tracking or identity association is performed.](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/facility-rehearsal.gif)

*A planned route, scrubbed across 31 captured states and played faster for this illustration. Proposed camera transitions are simulated and unverified. [Static view](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/route-15.webp) · [Visibility-model limits](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-planning#visibility-model-and-evidence-limits).*

- **Start from a map:** optional one-shot location suggestion, bounded search area, OpenStreetMap simple building drafts, dimensions and a review step before applying. An offline extract can be imported instead.
- **Start from a shape:** rectangle, L wing, T wing, U wing, cross, octagon or round, with editable dimensions and rotation.
- **Refine the plan:** add floors, rooms and labels; place and aim cameras; inspect estimated ground-plane visibility; undo edits and export the plan.

Footprints are approximate map geometry. Unknown heights/floors can be placeholders. Interiors are not inferred, and planning references do not establish code compliance. [Map and shape guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Maps-and-shapes).

## Set up a Linux or Windows machine

The new **System** workspace combines recording/retention sizing, RAM and VRAM budgets, GPU candidates, startup-power arithmetic and explicit resource-policy export. Applied browser limits control visible tiles, overlay pixel scale and background sample playback. The offline analyzer accepts exported OpenCV thread and decoded-frame caps.

[Hardware and drive shortlist](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Hardware-guide) · [Linux setup](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Linux-setup) · [Windows setup](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Windows-setup) · [GPU planning](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/GPU-planning) · [Control scopes](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Resource-controls)

## Run the review prototype

Use Node.js 22 and npm. From the repository root:

```bash
npm ci
npm run dev -- --host 127.0.0.1 --port 4173
```

Open the address Vite prints. **Monitor**, **Facility**, **Events**, **Zones**, **System** and **Settings** are the workspace areas. Start with the [five-minute walkthrough](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Getting-started).

The browser prototype needs no subscription, paid inference, API key, camera credentials or remote backend. Review decisions, rules and plans save in this browser's localStorage; they are editable and can be lost when storage is cleared. Export anything you need to keep. The optional Google Font and explicitly enabled online maps are external requests. [Data boundaries](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Architecture-and-data#where-data-goes).

## Claims you can check

| Claim | Evidence | Boundary |
| --- | --- | --- |
| Earlier documentation-refresh review/zone/facility checks | **27 passed**, plus **4 packaging tests passed**, October 27, 2026 | Automated tests cover their assertions; browser checks are recorded separately |
| Earlier documentation-refresh Python checks | **CI: 55 passed, no skips.** Local: 47 passed, 8 skipped | [CI evidence](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Evidence-and-validation#ci-follow-through) records the tested commit and native dependencies |
| The production package builds | Fresh build completed | Vite reports a large lazy-loaded facility bundle; no load-time claim follows |
| A pretrained YOLOX-S artifact previously ran through compatibility probes | [October 26 model report](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/model-qualification-20261026.md) and JSON receipts | Historical synthetic-input/recording smoke tests; no recognition-quality result |
| The scheduler can be exercised with 100 synthetic source IDs | [Fresh load-model reports](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Evidence-and-validation) | Virtual time, assumed service costs and synthetic payloads; no camera throughput measured |

The [machine-setup verification record](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/hardware-2026-10-27/README.md) adds 37 passing JavaScript tests, 4 packaging tests and a local Python run of 58 passes / 8 explicit skips. Its CI follow-through records native Linux/Windows results when available. **No detector weights or representative recordings are bundled.**

## From a recording to evidence

```mermaid
flowchart TD
  A["Explicitly selected local recording"] --> B["Offline analyzer + selected ONNX profile"]
  B --> C["Review receipt: observations + source hashes"]
  C --> D["Explicit browser import"]
  D --> E["Human review + exported decision"]
  B --> F["Optional bounded frame trace"]
  F --> G["Offline evaluation + independent annotations"]
  G --> H["Quality and timing report; qualification remains explicit"]
```

The browser does not run the detector. Imported observations never borrow the generated sample images. The evaluator's report is a different schema from the browser's review receipt. [Architecture](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Architecture-and-data) · [Offline CLI](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/edge/README.md) · [Evaluation guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/offline-evaluation.md).

## Build toward 100 cameras

**At least 100 simultaneously active cameras is the owner's requirement.** The bounded scheduler, fair dispatch, stale/drop accounting and deterministic load model prepare that work. Live ingest, recording services, accelerated inference and distributed workers still need implementation and qualification.

Connection count, recording continuity, analysis cadence and visible browser tiles are separate workloads. [Scaling plan](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/performance-100-cameras.md) · [Evidence-led roadmap](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Roadmap).

## Documentation map

| I want to… | Read |
| --- | --- |
| See what the program does | [Visual tour](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-tour) |
| Try the prototype and preserve my work | [Getting started](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Getting-started) |
| Draw buildings and place cameras | [Facility builder](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-planning) |
| Use maps, dimensions and common shapes | [Map starter](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Maps-and-shapes) |
| Understand evidence, storage and trust boundaries | [Architecture](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Architecture-and-data) |
| Analyze an approved recording locally | [Edge CLI](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/edge/README.md) |
| Evaluate quality and false alerts | [Offline evaluation](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/offline-evaluation.md) |
| Reproduce the published checks | [Verification record](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Evidence-and-validation) |
| Understand implementation priorities | [Roadmap](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Roadmap) |

## Checks and project terms

```bash
npm run build
npm test
npm run test:sites
python3 -m unittest discover -s tests -p 'test_*.py'
python3 scripts/check-docs.py
```

Install `edge/requirements-test.txt` in an isolated Python environment to enable synthetic native-inference integration tests. Without them, those cases are explicitly skipped. Restricted runners can use the [single-process Node commands](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Evidence-and-validation#reproduce).

This repository does **not** currently assign a software license. No open-source licensing grant is implied by public availability. [Third-party notices](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/third-party-notices.md) cover separately licensed components and model sources; [SECURITY.md](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/SECURITY.md) describes the prototype boundary. Camera imagery is generated sample artwork, not a record of a real workplace.

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/README.md) · Documentation refresh: October 27, 2026.
