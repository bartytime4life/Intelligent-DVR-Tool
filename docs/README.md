# Your guide to Intelligent DVR

[Home](../README.md) · [Visual handbook](how-to.md) · [First session](getting-started.md) · [Troubleshooting](troubleshooting.md) · [Product status](product-status.md)

![Conceptual overview of the camera, local recording, human-review computer and facility plan.](media/guide/overview.jpg)

*Concept illustration. Use the [current screenshot atlas](visual-atlas.md) for actual interface captures and their provenance.*

## Pick the outcome

| I want to… | Start here | Continue with |
| --- | --- | --- |
| Understand the whole tool | [Visual operator handbook](how-to.md) | [First session](getting-started.md), [screenshots](visual-atlas.md) |
| Install or update a Mac | [Mac Install / Check / Start](setup-macos.md) | [Local analysis setup](local-analysis-service.md), [troubleshooting](troubleshooting.md) |
| Install or test a PC | [PC kit](pc-testing.md) | [Linux](setup-linux.md), [Windows](setup-windows.md), [field runbook](field-acceptance.md) |
| Connect one source | [Webcam and local DVR](local-camera-feeds.md) | [Approved public webcams](public-webcams.md) |
| See people and objects live | [Live AI and tracking](live-detection.md) | [Review and Events](review-and-events.md), [zones](zones.md) |
| Analyze a recording | [Clip-to-report workflow](recording-workflow.md) | [Service configuration](local-analysis-service.md), [Recognition](recording-recognition.md), [coverage](recording-coverage.md) |
| Make and export review decisions | [Review desk and Events](review-and-events.md) | [Recognition reports](recording-workflow.md), [optional sharpening comparison](enhancement-comparison.md) |
| Record one LAN camera | [LAN recording](lan-recording.md) | [Field runbook](field-acceptance.md), [coverage](recording-coverage.md) |
| Tune detection | [Guided training](training.md) | [Source/model setup](local-analysis-service.md) |
| Enroll a consenting person | [Person enrollment and deletion](person-enrollment.md) | [Storage boundaries](architecture.md), [security](../SECURITY.md) |
| Define image rules | [Zones on a still](zones.md) | [Recognition details](recording-recognition.md) |
| Plan buildings and cameras | [Facility builder](facility-builder.md) | [Maps/shapes](map-measurements-and-shapes.md), [saved facilities](saved-facilities.md) |
| Inspect image science | [Diagnostics](facility-image-diagnostics.md) | [Ground-plane calibration](facility-calibration.md) |
| Plan hardware and limits | [System control scopes](resource-controls.md) | [Hardware](hardware-guide.md), [GPUs](gpu-planning.md), [100-camera preparation](performance-100-cameras.md) |
| Validate an operating claim | [Product status](product-status.md) | [Field acceptance](field-acceptance.md), [evaluation](offline-evaluation.md), [evidence checklist](offline-qualification.md) |

## Set up a facility

![Site and shell, interior rooms/openings, then planned cameras and an exported backup.](media/guide/facility.svg)

[Facility builder](facility-builder.md) covers shapes, placement, floors, room sketching, shared-wall edits, doorways, windows, stairs, camera aim and Undo. [Dependable setup](facility-setup-reliability.md) covers submitted search, reviewed footprints and offline recovery. [Native local map delivery](facility-local-delivery.md) covers operator-hosted map services; [saved facilities](saved-facilities.md) covers named plans and portable backups.

The [novice-study kit](facility-novice-study.md) and [easy-setup research](easy-facility-setup.md) describe study/proposal boundaries; they do not report invented participants, site measurements or user-success rates.

## Engineering and acceptance library

| Area | Guides |
| --- | --- |
| Data and implementation | [Architecture](architecture.md), [edge CLI](../edge/README.md), [third-party notices](third-party-notices.md), [security](../SECURITY.md) |
| Evaluation | [Offline evaluation](offline-evaluation.md), [qualification checklist](offline-qualification.md), [dated model qualification](model-qualification-20261026.md), [coverage](recording-coverage.md) |
| Capacity and rollout | [Pilot scope](pilot-scope.md), [100-camera preparation](performance-100-cameras.md), [roadmap](roadmap.md), [field acceptance](field-acceptance.md) |
| Evidence | [Verification index](verification/README.md), [product status](product-status.md), [current image provenance](media/guide/README.md), [older image provenance](media/current/README.md) |

## Historical decisions and reviews

These keep their original dates, claims and evidence: [October 29 experience review](experience-review-2026-10-29.md), [facility upgrades](facility-workspace-upgrades.md), [October 30 full review](review-2026-10-30.md), [operational assessment](project-assessment-2026-10-30.md), [October 31 UX audit](workspace-ux-audit-2026-10-31.md), and the [historical visual tour](visual-tour.md). Use current task guides for operating instructions.

## Read images and claims correctly

- **Application screenshot:** actual UI from a named source revision and controlled fixture session. It is not a real-camera accuracy or endurance test.
- **Workflow diagram:** an authored explanation of steps or storage boundaries.
- **Concept illustration:** visual orientation, with no implied deployed system or captured interface.
- **Planning estimate:** geometry or arithmetic that still needs physical measurements.
- **Field evidence:** a separately recorded source, environment, workload and result; green CI is not a substitute.

The published [GitHub Wiki](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki) is generated from these canonical guides. [Wiki publication instructions](wiki/README.md) explain its separate Git history and bundled image assets.
