# The visual operator handbook

[Guide index](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guide-index) · [First five minutes](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Getting-started) · [Screenshot atlas](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-atlas) · [Product status](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Product-status)

![Conceptual isometric illustration of a camera, a saved clip, a local review computer and a floor plan.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/overview.jpg)

*Illustrated overview, created with ImageGen. The instruction screenshots below
show the actual application in a clean local test session; no private recordings,
people, camera credentials or real site are pictured. [Visual provenance](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-provenance).*

Choose the job you want to finish:

| Your job | Go here | What you will have |
| --- | --- | --- |
| Open the app | [1. Get ready](#1-get-ready) | A checked local installation |
| See a camera | [2. Connect one source](#2-connect-one-source) | A deliberate preview |
| Review a recording | [3. Analyze a clip](#3-analyze-a-clip) | Results matched to their source |
| Make review decisions | [4. Review and export](#4-review-and-export) | Decisions, notes and an exported result pair |
| Tune detection | [5. Improve detection](#5-improve-detection) | A new threshold rule for this view |
| Set a person's baseline | [6. Enroll with consent](#6-enroll-with-consent) | A local, deletable template |
| Define an image region | [7. Draw zones](#7-draw-zones) | An analyzer-ready rules file |
| Plan a site | [8. Build a facility](#8-build-a-facility) | A named, exportable plan |
| Inspect pixels or ground geometry | [9. Inspect and calibrate](#9-inspect-and-calibrate) | Diagnostics and explicit calibration checks |
| Budget the machine | [10. Plan resources](#10-plan-resources) | A resource plan and supported limits |
| Update or move computers | [11. Preserve and update](#11-preserve-and-update) | Separate backups of browser and service data |

## 1. Get ready

![Three illustrated steps: Install dependencies, Check software readiness, then Start the local app.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/start.svg)

Use [Mac Install / Check / Start](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Mac-setup), or the
[Linux/Windows PC kit](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/PC-testing). Run **Install**, then **Check**, then **Start**.
Keep the Start terminal open. Use the address it prints: the Mac default is
**http://127.0.0.1:4180/**; the PC kit default is **http://127.0.0.1:4173/**.

For recognition and training, prepare the verified local models and catalog
first. A browser-only preview can display the interface while the local analysis
service is unavailable. [Troubleshooting](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Troubleshooting) explains how to
tell the difference. A fresh install connects no source automatically.

## 2. Connect one source

![Three source choices: computer webcam, a configured private LAN DVR, or a permitted public HTTPS webcam.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/sources.svg)

![Actual Monitor start screen showing the three source cards and no receiving camera.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/monitor.jpg)

1. Open **Monitor** and choose **Computer webcam**, **Local DVR / IP camera** or
   **Approved public webcam**. **Connect source** opens the same choices.
2. Complete the chosen setup and press its explicit connection control. Approve
   browser camera permission only for the source you intend to use.
3. Check the receiving status and moving image. Use **Disconnect** when done.

For a first test, use the computer webcam. No microphone is requested. Local DVR
channels need a reviewed private source configuration; public sources need
provider permission and attribution. A preview does not run live AI.
[Webcam and DVR setup](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Camera-sources) · [Public webcams](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Public-webcams).

## 3. Analyze a clip

![Capture or import a clip, choose Analyze recording, then inspect and export the matched review.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/recording.svg)

1. In Monitor, explicitly **Record webcam clip**, then **Stop recording** and
   **Open clip in Recognition**. Or begin with an approved recording already on
   this computer.
2. In **Recognition**, **Connect local analysis**. Import the selected file if
   needed, then choose the recording, model and rule set.
3. Press **Analyze recording**. Read progress and any complete/partial label;
   **Cancel analysis** stops an unwanted job.
4. Successful results open with the matching analyzed recording. A decoding,
   model, source or coverage error needs resolution before a usable result exists.

![Actual Recognition configuration with a deliberately generated example recording and a synthetic test model selected.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/recognition-setup.jpg)

*The example above uses generated media and a constant-output test model to show
the controls. It demonstrates the workflow, not detector accuracy.*

Importing copies a recording locally; it does not start inference. Save both the
recognition JSON and its exact analyzed recording for later reopening.
[Complete recording workflow](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recording-workflow) · [Coverage labels](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recording-coverage)
· [Optional one-camera LAN recorder](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/LAN-recording).

## 4. Review and export

![Actual Recognition results for a generated, flat-color test clip, showing the matched-source status, synthetic boxes and display filter.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/recognition-review.jpg)

*Controlled example: the boxes come from a synthetic constant-output model, not
recognition of a person in this image.*

Inspect sampled frames and boxes before sending observations to **Events**.
Review the original source, make a confirm/dismiss decision and add a useful
note. Use the queue filters and review shortcuts when helpful; keep **Undo**
available when correcting a decision. Return to Recognition to export a printable
report, JSON or CSV with the current review state.

![Actual sampled-count report with explicit download and save controls for the generated example.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/recognition-report.jpg)

*The six detections are repeated constant-output fixture samples, not a count of real people.*

Detection counts can include the same person repeatedly across samples. Scores
are model outputs, not probabilities or proof of identity. Imported results must
match the exact source file before overlays attach. See the
[review desk guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Review-and-events) and [Recognition details](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recognition-details).

## 5. Improve detection

![Camera check, guided prompts, then threshold comparison and explicit application.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/training.svg)

![Actual Train landing page with detection tuning, person enrollment and readiness.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/train.jpg)

Open **Train → Start session**. Check the camera, connect it deliberately, and
follow the on-screen sequence: in view, away, far across the room, partly hidden,
then back in view. Keep the window in front so the recording and prompts stay
together. The page imports and analyzes this session locally.

Inspect found/missed moments and false alarms, compare the proposed threshold,
then choose **Use … from now on** or **Keep current setting**. Applying saves a
new rule set; the detector weights are not retrained. Results describe this
session and room. [Training instructions and storage](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guided-training).

![Actual camera-check step before connection, with microphone-off guidance and an explicit Connect camera control.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/training-camera-check.jpg)

## 6. Enroll with consent

![Consent before capture, an optional baseline check, and human review of possible-match suggestions.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/enrollment.svg)

![Actual enrollment consent page, with a blank name, unchecked agreement and disabled capture continuation.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/enrollment-consent.jpg)

In **Train → Enroll a person**, enter the consenting person's name and confirm
their agreement before capture. Follow the short guided face views. An optional
baseline check reports how many usable views matched and can refine the template.

After analyzing a local job, Recognition's **Check for enrolled people** can
suggest possible matches inside sampled person boxes. **Confirm** accepts that
view for the template; **Not this person** hides that suggestion. Neither is an
automatic identity or access decision. Delete a template from Train when needed;
delete its retained clips separately. See [enrollment, consent and deletion](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Person-enrollment).

## 7. Draw zones

![Choose a source still, draw and name a region, then export analyzer-ready rules.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/zones.svg)

Open **Zones** with a deliberate still from Monitor or a matched Recognition
frame, or choose an approved image file. For an incoming capture, select the target plan and **Use for Plan …**. Draw the region, choose the class and
review threshold/dwell settings. **Export analyzer rules** produces rules for
that camera image. Add them to a reviewed local catalog before analysis.

These rectangles are image coordinates. A room polygon or estimated camera
coverage on the Facility map is a different kind of geometry.
[Zone-by-zone instructions](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Zones).

## 8. Build a facility

![Build a site shell, add interior rooms and openings, then place cameras and export the plan.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/facility.svg)

![Actual Facility Studio showing a fictional built-in example for explaining editing controls.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/facility.jpg)

*This is a planning example. It is not a surveyed building or a real site's camera coverage.*

1. Start a **New facility**, give it a name, and use the local grid or explicitly
   choose a map origin. Review any imported footprints before applying them.
2. **Add first building**: choose a shape, adjust size, preview placement and save.
3. Select a floor and **Sketch rooms**. Use **Edit room walls** to refine shared
   divisions. Preview changes before saving; **Undo edit** reverses a saved edit.
4. Place a doorway on a shared wall, a window on an outside wall, or a stair
   reservation between levels. Openings, elevations and dimensions stay editable.
5. Place and aim planned cameras. Treat coverage, routes and planning measurements
   as estimates. Export the named plan and collection backup when finished.

[Full facility workflow](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-planning) · [Maps and shapes](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Maps-and-shapes)
· [Saved facilities](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Saved-facilities).

## 9. Inspect and calibrate

![Freeze a selected image, compare explicit captures, and calibrate only a measured ground plane.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/science.svg)

Facility's image diagnostics freeze a deliberately chosen local frame. Inspect
the histogram, exposure/detail proxies, A/B difference and sampled-pixel ruler.
For ground-plane calibration, enter measured reference markers, reserve
independent check markers and review the error against your chosen limits.

These tools do not recover a building interior, general 3D location, optical
quality or identity from an image. [Image diagnostics](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Image-diagnostics)
· [Planar calibration](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Planar-calibration).

## 10. Plan resources

![Budget camera and retention needs, apply supported limits, then measure on intended hardware in stages.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/system.svg)

![Actual System workspace with editable planning defaults, not measured hardware results.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/system.jpg)

Use **System** to enter recording, retention and processing needs. Review storage,
RAM/VRAM and power arithmetic. **Apply workspace limits** applies supported
browser limits; **Export analyzer policy** is a separate action for supported
offline analyzer controls. Save the setup plan for future review.

The page does not provision drives, start recording, activate a GPU or benchmark
your machine. Test one authorized source before advancing toward 5/25/50/100.
[Control scopes](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Resource-controls) · [Hardware](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Hardware-guide)
· [GPU planning](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/GPU-planning) · [Field acceptance](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Field-acceptance).

## 11. Preserve and update

![Browser exports, the private local analysis folder, and a verified backup outside the checkout are three separate preservation steps.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/preserve.svg)

Export reviews, rules and facility plans from the browser. Export any temporary
last-job result before stopping its service. Back up the complete private
analysis folder and camera settings separately, keeping a verified copy outside
the checkout. Continue using the same browser and exact local address.

Update the source deliberately, rerun Install and Check, then Start. Reinstalling
preserves an existing catalog; preparing a fresh catalog deliberately refuses an
existing analysis folder. See [updates and migration](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Mac-setup#preserve-data-when-updating),
[saved facilities](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Saved-facilities) and [troubleshooting](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Troubleshooting).

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/how-to.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
