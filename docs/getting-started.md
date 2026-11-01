# Your first five minutes

[Home](../README.md) · [Visual walkthrough](visual-atlas.md) · [Install for PC testing](pc-testing.md) · [Field acceptance](field-acceptance.md) · [Product status](product-status.md)

![Schematic of five user-controlled steps from approved source to an exported human review.](media/current/workflow.svg)

**Start with one task, not every control.** A fresh Monitor looks like the tested screenshot below: no video is connected until you explicitly choose a source and complete its permission/setup step.

![Current Monitor's source chooser in a controlled desktop Chromium run, with no connected camera or synthetic footage.](media/current/monitor-desktop.jpg)

*Captured at PR #61 source `9719eda`, before Train and enrolled-person suggestions. This is real software in an offline test, not a surveillance installation. [Source provenance](media/current/README.md).*

## Install, check and start

Use the [PC test kit](pc-testing.md) for a prebuilt Linux/Windows installation,
or use the same launch scripts from a source checkout. Install finishes without
starting a service. Check validates the software setup. Start opens the local
application at http://127.0.0.1:4173 with all cameras disconnected.

For an Apple silicon Mac source checkout, follow the [macOS setup](local-analysis-service.md#start-the-local-application). That launcher uses http://127.0.0.1:4180 by default; its prerequisites and worker limits differ from the Linux/Windows kit.

Running `npm run dev` alone only serves the browser preview. It does **not** start the local DVR preview, recorder or analysis service; use the PC launcher for those features.

A fresh Monitor has no stock photos or fake events. Existing historical review
records remain available without invented imagery.

## Try the workflows

| Workspace | First action | Expected result |
| --- | --- | --- |
| Monitor | Use the **Computer webcam** first-run card (or **Connect source**), then **Connect webcam** and allow browser permission | Live preview without automatic inference, visible status and explicit disconnect |
| Webcam clip | Record webcam clip → Stop recording → Open clip in Recognition | Opt-in bounded clip ready for a separately authorized local import and analysis job |
| Local DVR | Configure local-feeds.json, restart, load/select a channel and connect | Bounded RTSP/TCP preview; actionable connection errors |
| Recognition | Configure an approved recordings folder/model/rules; connect and explicitly analyze | Progress, cancellation and source-matched results using the existing analyzer |
| Train: detection tuning | Follow the [guided session](training.md) and compare thresholds | Saves a new rule set only when training writes are enabled and you apply it; does not retrain the detector |
| Train: person enrollment | Enable [enrollment](person-enrollment.md), obtain consent and capture the guided baseline | A deletable face template stays in the local service; Recognition can explicitly request possible matches for local jobs |
| Events | Send a verified observation for review; add a note, confirm/dismiss and export | Decisions remain through workspace switches; no new simulated events |
| Zones | Use a still from a Monitor preview, a Recognition frame or an image file, draw the zone and **Export analyzer rules** | A rule file the local analyzer accepts, in full-frame coordinates of that camera's image; no live inference implied |
| Facility | Choose a task from **Current task** or the left guided steps; add a shape or import reviewed footprints, edit cameras and Undo | Estimated coverage and explicitly simulated route rehearsal |
| System | Review the machine plan and apply 1/2/4 visible-tile limits | Selected live feed stays visible within the chosen limit |

See [camera setup](local-camera-feeds.md), [recording analysis](local-analysis-service.md),
[Linux](setup-linux.md) and [Windows](setup-windows.md). Previews do not record or
run live AI/tracking. Actual device compatibility and detection quality require
separate testing.

![Schematic of data boundaries: temporary browser preview, local analysis service, human review and explicit export.](media/current/data-boundary.svg)

## Preserve your work

Use Export reviews, Back up browser rules and Export plan. Browser localStorage
belongs to the exact origin and browser profile; it is not a backup or shared
audit system. Keep your chosen origin stable across updates (PC kit default http://127.0.0.1:4173; Mac source launcher http://127.0.0.1:4180). Export before
changing the browser profile, port or installation. Keep credentials and footage
out of exported planning/review metadata.

Training rules and person templates live beside the local service catalog, while session clips remain in the recordings folder. Deleting a person template does not delete those clips. See [training storage](training.md#what-is-saved-where) and [enrollment deletion](person-enrollment.md#storage-and-deletion).

Facility import validates before replacement, and Undo restores the previous
edit. The [facility guide](facility-builder.md) documents bounds and source fields.

## Maps and location

Facility opens with a local grid. Address search, one-shot GPS, online street
tiles and building retrieval are explicit separate actions. Choose a provider,
submit an address or coordinates, review the bounded area and loaded footprints,
then apply selected drafts. Public services receive the submitted query/bounds;
offline OSM files and numeric coordinates avoid those requests.

Add to existing plan preserves cameras/rooms. Replace with a clean site explicitly
clears them; Undo restores the prior plan. Unknown heights/interiors remain
assumptions. See [map drafting](map-measurements-and-shapes.md) and
[recovery limits](facility-setup-reliability.md).

## Troubleshooting

Run the [readiness check](pc-testing.md) first. Use the [field-acceptance runbook](field-acceptance.md) when recording physical webcam, DVR and recovery results. It reports missing dependencies,
config problems, native codec failures and occupied ports without probing devices.
Browser camera permissions, DVR credentials/channel paths and physical network
access still need testing on the actual PC. Facility requires working WebGL.
Export work before reset or reinstall. Historical [visual-tour screenshots](visual-tour.md)
show earlier generated scenes and are not the current startup experience.
