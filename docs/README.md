# Explore Intelligent DVR

[Whole-workspace UI/navigation audit](workspace-ux-audit-2026-10-31.md) examines all seven workspaces, confirmed unsaved-draft and deep-link defects, desktop/mobile regressions and follow-up usability gates. The subsequent Monitor/Facility refinement reduces duplicated controls while keeping explicit camera authorization, the detailed editor and map shortcuts intact.

The [October 30 full review](review-2026-10-30.md) lists the defects fixed on
`main` and the four follow-up pull requests merged on October 31.

[Recording coverage](recording-coverage.md) explains strict decode/inventory
checks, incomplete-media errors and legacy/unverified result labels.

For experimental paired original/sharpened detection checks, see
[saved-recording sharpening comparison](enhancement-comparison.md).

Start with [PC installation and live-device testing](pc-testing.md), then follow the [field-acceptance runbook](field-acceptance.md) to collect physical-device evidence without confusing CI checks with real camera qualification.

[Facility Studio image diagnostics](facility-image-diagnostics.md) covers opt-in frame capture, ROI histograms, edge/detail proxies, pixel measurement and A/B comparisons.

[Ground-plane camera calibration](facility-calibration.md) adds explicit image-to-map reference markers, independent check residuals and a restricted plane-only ruler. It remains unqualified on actual cameras. Values are local, downsampled image diagnostics—not optical calibration or recognition accuracy.

[One-camera LAN recording](lan-recording.md) connects finalized RTSP segments to
the existing local recognition and review workflow.

[Repository home](../README.md) · [Wiki](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki)


| Journey | Guides |
| --- | --- |
| See it | [Visual tour](visual-tour.md), [animation provenance and stills](media/README.md) |
| Set up a machine | [Hardware / disks / RAM / CPU / PSU](hardware-guide.md), [GPUs](gpu-planning.md), [Linux](setup-linux.md), [Windows](setup-windows.md), [resource controls](resource-controls.md) |
| Try it | [Getting started](getting-started.md), [field acceptance](field-acceptance.md), [facility builder](facility-builder.md), [saved facilities and backups](saved-facilities.md), [maps and shapes](map-measurements-and-shapes.md), [address search and offline recovery](facility-setup-reliability.md) |
| Understand it | [Product status](product-status.md), [architecture and data](architecture.md), [pilot scope](pilot-scope.md), [security boundary](../SECURITY.md) |
| Measure it | [Owner-PC GPU/load/person report](verification/host-2026-10-28/README.md), [Verification index](verification/README.md), [local evidence and qualification checklist](offline-qualification.md), [offline evaluation](offline-evaluation.md), [historical model qualification](model-qualification-20261026.md) |
| Extend it | [Roadmap](roadmap.md), [100-camera preparation](performance-100-cameras.md), [map-setup research](easy-facility-setup.md) |
| Check terms | [Third-party notices](third-party-notices.md), [model license text](model-qualification/Apache-2.0-YOLOX.txt) |

The current source and tested behavior take precedence over future-work research. For every capacity or quality number, check whether the evidence describes a browser fixture, synthetic arithmetic, a compatibility probe or an actual deployment measurement.

