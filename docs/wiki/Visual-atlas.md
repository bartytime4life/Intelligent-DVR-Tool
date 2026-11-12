# Explore Intelligent DVR visually

[Guide index](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guide-index) · [Step-by-step handbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-handbook) · [Product status](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Product-status) · [Image provenance](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-provenance)

![Concept illustration connecting a camera, a saved video, a local review computer and a floor plan.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/overview.jpg)

**Choose a goal, then follow its task.** Monitor and System below use the
[November 11 guided-experience collection](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guided-experience-visual-provenance).
The remaining application captures are dated November 1, 2026, from merged PR #71
source `2566d845`; they remain useful control references, not an exact picture of
every current screen. No real camera, person, private recording or actual site
was used. Example detections come from a constant-output test model on generated
flat-color video. These images explain controls; they do not measure recognition
quality or operating capacity.

## Monitor · connect deliberately

![November 11 Monitor: four goal shortcuts above the existing camera-source chooser and review queue.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guided-experience-2026-11-11/04-monitor-after.jpg)

**What’s next?** opens **Watch cameras**, **Analyze saved video**, **Keep DVR
copies** or **Plan coverage**. These shortcuts navigate only. Watch cameras
focuses **Connect source**, including when Monitor first loads; a later operator
choice cancels that pending focus handoff.

![November 11 Monitor in a narrow viewport: four contained goal buttons above explicit connection controls.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guided-experience-2026-11-11/05-monitor-mobile-after.jpg)

Choose a webcam, configured private DVR channel or permitted public source when
you need a preview. **Add camera or DVR source** leads to the existing guided
local setup when a DVR channel is missing. That form requires the PC DVR Companion
or an analysis-enabled service with camera setup enabled; an ordinary preview-only
Start does not expose it. Copy-only companion setup needs no detector model.
Check status, then disconnect when
done. Preview alone runs no AI.
[Connect one source](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-handbook#2-connect-one-source) · [Connection details](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Camera-sources).

## Recognition · inspect the exact clip

![Actual local analysis configuration with the generated example recording and synthetic test model.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/recognition-setup.jpg)

*November 1 control reference from PR #71; current Recognition also offers its
task chooser and interrupted-opening recovery.*

Choose recording, model and rules; start analysis explicitly. Read progress and
coverage status before using the result. [Recording workflow](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recording-workflow).

![Actual matched-source result with the generated green frame, synthetic box and display score filter.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/recognition-review.jpg)

The box is deliberately produced by a fixture model. It is not recognition of a
person in the image. Display filtering does not change recorded rules.

![Actual report with sampled counts, activity bars and report/result download controls.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/recognition-report.jpg)

The six detections are six repeated fixture samples, not six real people. Save
both **recognition results** and the **analyzed recording** to reopen overlays.
[Review and export](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-handbook#4-review-and-export).

## Train · tune a view or enroll with consent

![Actual Train landing page with readiness, detection tuning and person enrollment choices.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/train.jpg)

**Start session** tunes a rule threshold for this view. **Enroll a person** starts
a different consent-based baseline task. [Guided training](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guided-training).

| Camera check before detection tuning | Consent before enrollment capture |
| --- | --- |
| ![Actual training camera-check step before a camera is connected.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/training-camera-check.jpg) | ![Actual enrollment page with empty name, unchecked consent and disabled continuation.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/enrollment-consent.jpg) |
| Connect explicitly; follow visible prompts. | Obtain agreement before capture. Templates remain local and deletable. |

[Enrollment and possible matches](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Person-enrollment). A possible match is a
human-review suggestion, never an identity or access decision.

## Events · decisions and notes

![Actual Events queue with one generated-example observation, filters and export controls.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/events.jpg)

![Actual human-review dialog with source hashes, a note field and explicit confirm/dismiss actions.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/review-dialog.jpg)

The observation and still are synthetic examples. Review the original recording
before deciding; an export is deliberate. [Review desk](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Review-and-events).

## Zones · a rule belongs to an image

![Actual Zones editor with a generated flat-color still and an illustrative normalized rectangle.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/zones.jpg)

Assign the incoming still to the intended plan, draw the region, then export
analyzer rules. Image coordinates and Facility plan geometry are different.
[Zone guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Zones).

## Facility · build the space in layers

![Diagram of site shell, interior/openings, and camera planning with backup.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/facility.svg)

![Actual building-editing tools on an explicitly loaded fictional sample facility, with external tiles off.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/facility.jpg)

Fresh installs start blank. Use a shape or reviewed draft, then edit floors,
rooms, shared walls, doors, windows and stairs. Place planned cameras, inspect
estimated coverage, and export. [Facility handbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-planning)
· [Saved sites](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Saved-facilities).

## System · budget, apply, measure

![November 11 System: recording and retention beside camera-wall settings, before the optional advanced section.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guided-experience-2026-11-11/06-system-after.jpg)

The values are entered assumptions, not detected hardware or throughput.
Storage and camera-wall controls come first. **Advanced planning details** holds
processing, GPU, memory, power and host comparison; closing it retains the draft.
Its summary flags **Unapplied advanced changes**, while errors and warnings stay
visible outside the disclosure. Apply browser limits and export supported
analyzer controls separately.

![November 11 narrow System viewport with Advanced planning details expanded to show processing inputs.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guided-experience-2026-11-11/07-system-mobile-advanced-after.jpg)

[Control scopes](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Resource-controls) · [Hardware plan](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Hardware-guide).

## Image science · explicit reference, explicit limits

![Illustration of local image inspection, A/B comparison and measured-plane calibration.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/science.svg)

[Image diagnostics](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Image-diagnostics) inspect pixels and exposure/detail
proxies. [Ground-plane calibration](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Planar-calibration) requires measured
references and independent checks. Neither recovers general depth or establishes
survey accuracy.

## November 12 · coordinate recovery

These captures show generated fixture plans and marker coordinates in the
source later merged in PR #122, with exact hashes in the [coordinate-integrity record](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/coordinate-integrity-math-2026-11-12/README.md).
They are software checks, not photographs or measured site calibration.

![Controlled phone-width calibration panel refusing a point outside the fitting-marker boundary.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/coordinate-integrity-2026-11-12/calibration-outside-phone.png)

The ruler withholds the outside distance and exports no ruler result; a corrected
inside endpoint recovers. A withheld check outside the boundary keeps it locked.
[Plane-reference workflow](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Planar-calibration).

![Controlled desktop Save site form after keeping a generated rotated building and rooms at their map positions.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/coordinate-integrity-2026-11-12/saved-site-desktop.png)

The explicit site correction preserves shared room boundaries, supports Undo and
survives reload. [Site-origin choices](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-planning).

## November 12 · small planning values

[Reviewed phone and desktop captures](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/planning-readouts-2026-11-12/README.md#checks-and-actual-exports)
show a 0.01 Mbit/s System plan, a 4 cm route gap and an incomplete zone with a
positive blind polygon. The record binds actual before/after downloads and
unchanged numeric plans. Additional digits and endpoint bounds describe the
planning calculation; they do not establish hardware or site accuracy.

## Keep the work

![Separate browser exports, private local folders and an outside verified backup.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/preserve.svg)

[Mac updates](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Mac-setup#preserve-data-when-updating) · [Troubleshooting](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Troubleshooting)
· [Architecture and data](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Architecture-and-data).

## Dated collections and reproduction

- [November 12 coordinate-integrity collection](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/media/coordinate-integrity-2026-11-12/README.md):
  two reviewed captures with generated references/plans and unchanged source bytes.

- [November 11 guided-experience collection](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guided-experience-visual-provenance):
  four unchanged controlled Monitor/System captures, with separate provenance.
- [PR #61 collection](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/PR61-visual-provenance): five controlled desktop/mobile
  screenshots and six schematics, with unchanged original hashes and CI provenance.
- [October 27 tour](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-tour#historical-prototype-captures): generated camera
  artwork and fictional plan demonstrations, preserved as historical material.
- [November 1 collection manifest and procedure](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-provenance): twelve actual
  browser screenshots from PR #71, ten editable diagrams and one conceptual ImageGen hero.
- [Verification index](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Evidence-and-validation): revision-bound software checks,
  including their separate physical-device, quality and capacity limits.

All procedures also have text instructions and descriptive alternate text.

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/visual-atlas.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
