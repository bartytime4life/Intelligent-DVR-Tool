# Explore Intelligent DVR visually

[Guide index](README.md) · [Step-by-step handbook](how-to.md) · [Product status](product-status.md) · [Image provenance](media/guide/README.md)

![Concept illustration connecting a camera, a saved video, a local review computer and a floor plan.](media/guide/overview.jpg)

**Choose a goal, then follow its task.** Monitor and System below use the
[November 11 guided-experience collection](media/guided-experience-2026-11-11/README.md).
The remaining application captures are dated November 1, 2026, from merged PR #71
source `2566d845`; they remain useful control references, not an exact picture of
every current screen. No real camera, person, private recording or actual site
was used. Example detections come from a constant-output test model on generated
flat-color video. These images explain controls; they do not measure recognition
quality or operating capacity.

## Monitor · connect deliberately

![November 11 Monitor: four goal shortcuts above the existing camera-source chooser and review queue.](media/guided-experience-2026-11-11/04-monitor-after.jpg)

**What’s next?** opens **Watch cameras**, **Analyze saved video**, **Keep DVR
copies** or **Plan coverage**. These shortcuts navigate only. Watch cameras
focuses **Connect source**, including when Monitor first loads; a later operator
choice cancels that pending focus handoff.

![November 11 Monitor in a narrow viewport: four contained goal buttons above explicit connection controls.](media/guided-experience-2026-11-11/05-monitor-mobile-after.jpg)

Choose a webcam, configured private DVR channel or permitted public source when
you need a preview. **Add camera or DVR source** leads to the existing guided
local setup when a DVR channel is missing. That form requires the PC DVR Companion
or an analysis-enabled service with camera setup enabled; an ordinary preview-only
Start does not expose it. Copy-only companion setup needs no detector model.
Check status, then disconnect when
done. Preview alone runs no AI.
[Connect one source](how-to.md#2-connect-one-source) · [Connection details](local-camera-feeds.md).

## Recognition · inspect the exact clip

![Actual local analysis configuration with the generated example recording and synthetic test model.](media/guide/recognition-setup.jpg)

*November 1 control reference from PR #71; current Recognition also offers its
task chooser and interrupted-opening recovery.*

Choose recording, model and rules; start analysis explicitly. Read progress and
coverage status before using the result. [Recording workflow](recording-workflow.md).

![Actual matched-source result with the generated green frame, synthetic box and display score filter.](media/guide/recognition-review.jpg)

The box is deliberately produced by a fixture model. It is not recognition of a
person in the image. Display filtering does not change recorded rules.

![Actual report with sampled counts, activity bars and report/result download controls.](media/guide/recognition-report.jpg)

The six detections are six repeated fixture samples, not six real people. Save
both **recognition results** and the **analyzed recording** to reopen overlays.
[Review and export](how-to.md#4-review-and-export).

## Train · tune a view or enroll with consent

![Actual Train landing page with readiness, detection tuning and person enrollment choices.](media/guide/train.jpg)

**Start session** tunes a rule threshold for this view. **Enroll a person** starts
a different consent-based baseline task. [Guided training](training.md).

| Camera check before detection tuning | Consent before enrollment capture |
| --- | --- |
| ![Actual training camera-check step before a camera is connected.](media/guide/training-camera-check.jpg) | ![Actual enrollment page with empty name, unchecked consent and disabled continuation.](media/guide/enrollment-consent.jpg) |
| Connect explicitly; follow visible prompts. | Obtain agreement before capture. Templates remain local and deletable. |

[Enrollment and possible matches](person-enrollment.md). A possible match is a
human-review suggestion, never an identity or access decision.

## Events · decisions and notes

![Actual Events queue with one generated-example observation, filters and export controls.](media/guide/events.jpg)

![Actual human-review dialog with source hashes, a note field and explicit confirm/dismiss actions.](media/guide/review-dialog.jpg)

The observation and still are synthetic examples. Review the original recording
before deciding; an export is deliberate. [Review desk](review-and-events.md).

## Zones · a rule belongs to an image

![Actual Zones editor with a generated flat-color still and an illustrative normalized rectangle.](media/guide/zones.jpg)

Assign the incoming still to the intended plan, draw the region, then export
analyzer rules. Image coordinates and Facility plan geometry are different.
[Zone guide](zones.md).

## Facility · build the space in layers

![Diagram of site shell, interior/openings, and camera planning with backup.](media/guide/facility.svg)

![Actual building-editing tools on an explicitly loaded fictional sample facility, with external tiles off.](media/guide/facility.jpg)

Fresh installs start blank. Use a shape or reviewed draft, then edit floors,
rooms, shared walls, doors, windows and stairs. Place planned cameras, inspect
estimated coverage, and export. [Facility handbook](facility-builder.md)
· [Saved sites](saved-facilities.md).

## System · budget, apply, measure

![November 11 System: recording and retention beside camera-wall settings, before the optional advanced section.](media/guided-experience-2026-11-11/06-system-after.jpg)

The values are entered assumptions, not detected hardware or throughput.
Storage and camera-wall controls come first. **Advanced planning details** holds
processing, GPU, memory, power and host comparison; closing it retains the draft.
Its summary flags **Unapplied advanced changes**, while errors and warnings stay
visible outside the disclosure. Apply browser limits and export supported
analyzer controls separately.

![November 11 narrow System viewport with Advanced planning details expanded to show processing inputs.](media/guided-experience-2026-11-11/07-system-mobile-advanced-after.jpg)

[Control scopes](resource-controls.md) · [Hardware plan](hardware-guide.md).

## Image science · explicit reference, explicit limits

![Illustration of local image inspection, A/B comparison and measured-plane calibration.](media/guide/science.svg)

[Image diagnostics](facility-image-diagnostics.md) inspect pixels and exposure/detail
proxies. [Ground-plane calibration](facility-calibration.md) requires measured
references and independent checks. Neither recovers general depth or establishes
survey accuracy.

## Keep the work

![Separate browser exports, private local folders and an outside verified backup.](media/guide/preserve.svg)

[Mac updates](setup-macos.md#preserve-data-when-updating) · [Troubleshooting](troubleshooting.md)
· [Architecture and data](architecture.md).

## Dated collections and reproduction

- [November 11 guided-experience collection](media/guided-experience-2026-11-11/README.md):
  four unchanged controlled Monitor/System captures, with separate provenance.
- [PR #61 collection](media/current/README.md): five controlled desktop/mobile
  screenshots and six schematics, with unchanged original hashes and CI provenance.
- [October 27 tour](visual-tour.md#historical-prototype-captures): generated camera
  artwork and fictional plan demonstrations, preserved as historical material.
- [November 1 collection manifest and procedure](media/guide/README.md): twelve actual
  browser screenshots from PR #71, ten editable diagrams and one conceptual ImageGen hero.
- [Verification index](verification/README.md): revision-bound software checks,
  including their separate physical-device, quality and capacity limits.

All procedures also have text instructions and descriptive alternate text.
