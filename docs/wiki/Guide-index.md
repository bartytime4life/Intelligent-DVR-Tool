# Your guide to Intelligent DVR

[Home](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Home) · [Visual handbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-handbook) · [First session](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Getting-started) · [Troubleshooting](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Troubleshooting) · [Product status](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Product-status)

![Conceptual overview of the camera, local recording, human-review computer and facility plan.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/overview.jpg)

*Concept illustration. Use the [current screenshot atlas](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-atlas) for actual interface captures and their provenance.*

## Pick the outcome

| I want to… | Start here | Continue with |
| --- | --- | --- |
| Understand the whole tool | [Visual operator handbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-handbook) | [First session](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Getting-started), [screenshots](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-atlas) |
| Install or update a Mac | [Mac Install / Check / Start](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Mac-setup) | [Local analysis setup](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Local-analysis-service), [troubleshooting](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Troubleshooting) |
| Install or test a PC | [PC kit](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/PC-testing) | [Linux](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Linux-setup), [Windows](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Windows-setup), [field runbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Field-acceptance) |
| Connect one source | [Webcam and local DVR](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Camera-sources) | [Approved public webcams](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Public-webcams) |
| See people and objects live | [Live AI and tracking](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Live-AI-and-tracking) | [Review and Events](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Review-and-events), [zones](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Zones) |
| Analyze a recording | [Clip-to-report workflow](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recording-workflow) | [Service configuration](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Local-analysis-service), [Recognition](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recognition-details), [coverage](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recording-coverage) |
| Make and export review decisions | [Review desk and Events](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Review-and-events) | [Recognition reports](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recording-workflow), [optional sharpening comparison](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Enhancement-comparison) |
| Record one LAN camera | [LAN recording](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/LAN-recording) | [Field runbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Field-acceptance), [coverage](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recording-coverage) |
| Tune detection | [Guided training](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guided-training) | [Source/model setup](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Local-analysis-service) |
| Enroll a consenting person | [Person enrollment and deletion](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Person-enrollment) | [Storage boundaries](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Architecture-and-data), [security](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Security-boundary) |
| Define image rules | [Zones on a still](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Zones) | [Recognition details](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recognition-details) |
| Plan buildings and cameras | [Facility builder](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-planning) | [Maps/shapes](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Maps-and-shapes), [saved facilities](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Saved-facilities) |
| Inspect image science | [Diagnostics](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Image-diagnostics) | [Ground-plane calibration](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Planar-calibration) |
| Plan hardware and limits | [System control scopes](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Resource-controls) | [Hardware](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Hardware-guide), [GPUs](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/GPU-planning), [100-camera preparation](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/100-camera-plan) |
| Validate an operating claim | [Product status](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Product-status) | [Field acceptance](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Field-acceptance), [evaluation](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Offline-evaluation), [evidence checklist](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Offline-qualification) |

## Set up a facility

![Site and shell, interior rooms/openings, then planned cameras and an exported backup.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/facility.svg)

[Facility builder](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-planning) covers shapes, placement, floors, room sketching, shared-wall edits, doorways, windows, stairs, camera aim and Undo. [Dependable setup](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-setup-reliability) covers submitted search, reviewed footprints and offline recovery. [Native local map delivery](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Local-map-services) covers operator-hosted map services; [saved facilities](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Saved-facilities) covers named plans and portable backups.

The [novice-study kit](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-study-kit) and [easy-setup research](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-setup-research) describe study/proposal boundaries; they do not report invented participants, site measurements or user-success rates.

## Engineering and acceptance library

| Area | Guides |
| --- | --- |
| Data and implementation | [Architecture](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Architecture-and-data), [edge CLI](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Edge-CLI), [third-party notices](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Third-party-notices), [security](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Security-boundary) |
| Evaluation | [Offline evaluation](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Offline-evaluation), [qualification checklist](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Offline-qualification), [dated model qualification](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Model-qualification-2026-10-26), [coverage](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recording-coverage) |
| Capacity and rollout | [Pilot scope](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Pilot-scope), [100-camera preparation](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/100-camera-plan), [roadmap](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Roadmap), [field acceptance](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Field-acceptance) |
| Evidence | [Verification index](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Evidence-and-validation), [product status](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Product-status), [current image provenance](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-provenance), [older image provenance](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/PR61-visual-provenance) |

## Historical decisions and reviews

These keep their original dates, claims and evidence: [October 29 experience review](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Experience-review-2026-10-29), [facility upgrades](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Facility-upgrades-2026-10-29), [October 30 full review](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Review-2026-10-30), [operational assessment](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Assessment-2026-10-30), [October 31 UX audit](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Workspace-audit-2026-10-31), and the [historical visual tour](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-tour). Use current task guides for operating instructions.

## Read images and claims correctly

- **Application screenshot:** actual UI from a named source revision and controlled fixture session. It is not a real-camera accuracy or endurance test.
- **Workflow diagram:** an authored explanation of steps or storage boundaries.
- **Concept illustration:** visual orientation, with no implied deployed system or captured interface.
- **Planning estimate:** geometry or arithmetic that still needs physical measurements.
- **Field evidence:** a separately recorded source, environment, workload and result; green CI is not a substitute.

The published [GitHub Wiki](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki) is generated from these canonical guides. [Wiki publication instructions](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Wiki-publication) explain its separate Git history and bundled image assets.

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/README.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
