# Operational assessment — October 30, 2026

> **Dated record.** Findings and evidence below retain their stated revision and date. Use the [visual handbook](how-to.md), [current capability register](product-status.md) and [guide index](README.md) for today’s operator path.

Source baseline: merged PR #37, commit `7bad7329285853be8d71add1d91805dae407d4b2`.
The new recording-workflow branch starts from the identical Git tree
`1a52aa2bd3c7d2c38ae200807440c6c3b169d856`. Earlier local workspaces are preserved.

## Finding and implemented response

The project contains substantial working components: native CPU detection,
optional CUDA experiments, bounded schedulers, restart recovery, webcam/RTSP/
public previews, human review and a capable facility editor. The most immediate
deployment gap was the handoff from a camera to a recording that the analyzer
could actually consume, followed by useful reporting and portable evidence.

The current change implements that path for one explicitly connected browser
webcam or an existing selected local file. It adds verified model preparation,
bounded clip capture/import, detection inventories, sampled activity, matching
review decisions/notes, printable reports, CSV/JSON, and original review-bundle/
recording exports. Invalid replacement bundles now preserve the loaded review.
See [the complete workflow](recording-workflow.md).

## Capability and priority register

| Area | Working foundation | Remaining operational requirement |
| --- | --- | --- |
| Capture | Explicit webcam clip; bounded RTSP/public previews | Native LAN-camera segment recorder, retention, disk-pressure and restart handling; no continuous recording claim |
| Intelligence | Hash-bound YOLOX-S class detection and configured presence/dwell rules; optional CUDA CLI | Representative labeled video/event evaluation, threshold calibration and per-camera image zones; no identity or behavior inference |
| Review and reporting | Source-matched frames, human decisions, notes, HTML/JSON/CSV exports | Durable versioned review database with backup/restore and retention; current localStorage is not an audit log |
| Performance | Bounded worker/scheduler and offline GPU evidence | Integrate live ingest/recording/analysis and measure the same workload at 1/5/25/50/100 cameras |
| Installation | Linux/Windows kit, checks and launchers; verified local model preparation | Physical-PC/device acceptance, failure diagnostics and unattended-service lifecycle |
| Facility | Editable saved plans, dimensions, floors/openings/stairs and estimated camera coverage | Real-site geometry/optical calibration and novice acceptance; cross-camera route rehearsal remains simulated |
| Security and data | Loopback token/origin/Host boundary, explicit starts, bounded local files | Multi-user auth/audit and encrypted remote access require a distinct design; never expose the current server remotely |

## Next concrete acceptance

Use one owner-approved physical webcam clip with independent labels. Confirm
video-only capture, stop/navigation behavior, exact file matching, event review,
report export/reopen and Linux restart recovery. Measure person/object precision,
recall, missed events and processing time. Keep the footage on the owner PC.

Then implement a single LAN-camera segment recorder with a storage budget and
failure recovery, feed completed segments into the existing worker contract, and
display actual lag/drops. Expand only after a sustained one-camera run establishes
the complete recording/analytics/review workload. Hardware estimates and virtual
camera tests cannot replace that acceptance.
