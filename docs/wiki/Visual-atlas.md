# Explore Intelligent DVR visually

[Home](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Home) · [Get started](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Getting-started) · [Software status](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Product-status) · [Visual provenance](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/media/current/README.md)

![Original schematic overview of the Intelligent DVR camera, facility and human-review system. This is illustration rather than an application screenshot.](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/current/overview.svg)

**One workspace, distinct responsibilities.** These pages combine **real interface screenshots from a controlled Chromium run** with **original schematic diagrams**. A screenshot proves only what that software revision rendered in its test environment; no image here is evidence of an actual camera, real facility, person-tracking result, optical calibration or 100-camera acceptance.

The five screenshots below document **PR #61 source `9719eda`**, captured November 1 UTC (October 31 Central), before Train and enrolled-person suggestions were added. The `media/current/` path names this visual collection; it does not mean the images are regenerated on each release. [Current capability register](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Product-status).

## Tested application captures: desktop

| Monitor: start with intentional source choices | Facility Studio: design the site on a map |
| --- | --- |
| ![Desktop Monitor in Chromium shows a no-camera start screen with source buttons for webcam, LAN DVR and approved public webcam.](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/current/monitor-desktop.jpg) | ![Desktop Facility Studio shows a map-first workspace, local facility inventory, current-task selector, and properties panel.](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/current/facility-desktop.jpg) |
| **Connect a real source only on request.** Live previews do not run AI. [Camera setup](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Camera-sources) | **Plan before measuring.** Buildings and camera footprints are models until validated in the field. [Facility editor](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-planning) |

## Tested application captures: mobile

| Monitor | Facility Studio | System planner |
| --- | --- | --- |
| ![390 pixel Monitor layout with source selector and an empty camera wall.](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/current/monitor-mobile.jpg) | ![390 pixel Facility Studio layout with explicit current-task selector and local plan inventory.](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/current/facility-mobile.jpg) | ![390 pixel System planner with operating-system and storage settings.](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/current/system-mobile.jpg) |
| Choose a source, grant permission explicitly. | Navigate, map, then save or discard. | Plan disk/RAM/CPU; export policies separately. |

**Capture details:** 1440 × 1000 desktop and 390 × 844 mobile browser, successful [PR #61 software CI run](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/41263964836) at `9719eda`. The complete run passed 92 controlled browser scenarios across Facility/general navigation, local analysis, feed and one-channel recorder checks. No real camera, GPS or physical mobile device was connected. [Source manifest](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/media/current/manifest.json).

## The journey: five steps, not one mystery button

![Operator-controlled steps: explicit connection, capture, local analysis, human review, and export. This is a schematic rather than a product capture.](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/current/workflow.svg)

| Stage | What the operator actually does | What is not implied |
| --- | --- | --- |
| Monitor | Connect a webcam or approved local/public source | Camera access is never automatic |
| Capture | Start an opt-in webcam clip or a separately configured single-channel recorder | No gapless, continuous multi-camera archive |
| Recognition | Import or select a recording and analyze it with compatible local model/rules | No continuous inference from Monitor |
| Events | Review source-matched observations, add notes, confirm or dismiss | A model score is not risk, identity or intent |
| Export | Save reports, rules, reviews and recordings explicitly | Browser exports are unsigned/editable by default |

[Recording-to-review guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recording-workflow) · [Recognition guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/recording-recognition.md) · [Review provenance](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/recording-coverage.md).

## Added after these captures: Train and possible matches

| Choose this task | Follow the guide | What the result means |
| --- | --- | --- |
| Tune detection for one camera | [Train: guided recording, analysis and threshold choice](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guided-training) | A session-specific rule setting, not retrained model weights or a quality benchmark |
| Set a baseline for a consenting person | [Enrollment: consent, local capture and baseline check](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Person-enrollment) | A deletable local face template, not proof of identity |
| Review an enrolled-person suggestion | [Recognition: Check for enrolled people](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Person-enrollment#possible-matches-in-recognition) | **Possible: name** needs human review; Confirm can update the template, while Not this person hides the suggestion |

These features are documented from merged source through PR #68. No screenshot in this collection depicts their operation. Suggestions never go to Events or exports automatically; person templates and clips have separate deletion steps in the enrollment guide.

## The science: image diagnostics and ground-plane estimation

![Schematic showing four fitting markers and an independent check marker linked from an image to a single measured ground plane.](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/current/facility-science.svg)

**What exists:** local-image/video frame freezing, region-of-interest histograms, clipping and edge-detail proxies, A/B difference, sampled-pixel ruler, and a planar calibration method with explicit reference markers and withheld checks. A permitted ground-plane distance is available only inside the supported reference region after operator verification. **What does not follow:** field-verified measurement accuracy, arbitrary depth, identity recognition, optical lens calibration, or physical site certification.

[Image diagnostics](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Image-diagnostics) · [Calibrate a measured plane](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Planar-calibration) · [Map/shape guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Maps-and-shapes).

## The trust boundary: where footage and evidence live

![Schematic of four distinct stages: browser preview, local PC service, review workspace and explicit export.](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/current/data-boundary.svg)

The preview wall may access media after the user initiates a connection. The local service handles configured recordings/model inference when separately enabled. Review decisions and rules are saved in browser storage, while recordings and models remain separately configured. Exports are deliberate and editable. A matching SHA-256 identifies corresponding bytes; **it does not authenticate the source or prove recognition accuracy**.

[Architecture](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Architecture-and-data) · [Local camera security](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Camera-sources) · [Field acceptance](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Field-acceptance).

## The machine: hardware budgets and scale gates

![Illustrated CPU, storage, ingest and qualification responsibilities for PC planning.](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/current/system-planning.svg)

![Schematic engineering progression from one source to 100-plus sources; not a throughput result.](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/current/scale-gates.svg)

The product includes local hardware/resource planning, synthetic scheduler exercises and one-camera LAN recording. Multi-camera operational capacity, independent accuracy and the 100-plus source requirement remain **unqualified**. Plan, measure and advance one gate at a time.

[System and control scopes](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Resource-controls) · [Hardware guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Hardware-guide) · [100-camera plan](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/performance-100-cameras.md).

## The historic visual exhibit

The [October 27 gallery and motion loops](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-tour#historical-prototype-captures) still document an earlier UI with fictional/generated scenes clearly marked as demonstrations. They are **not current Monitor screenshots**. Both versions remain valuable when dated and labeled correctly.

All images have meaningful alternate descriptions; the full procedure, safety boundaries and evidence remain available in text as well. See the [asset provenance](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/media/current/README.md) and the [verification index](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Evidence-and-validation).

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/visual-atlas.md) · Generated from the checked documentation source; historical and schematic images are labeled.
