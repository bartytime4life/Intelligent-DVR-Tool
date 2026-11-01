# Camera clip → recognition → reviewed report

[Current visual atlas](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-atlas) · [Product status](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Product-status) · [Visual provenance](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/media/current/README.md)

![Operator-controlled connection, capture, local analysis, review and export.](https://raw.githubusercontent.com/bartytime4life/Intelligent-DVR-Tool/main/docs/media/current/workflow.svg)

*The schematic is not a recorded sequence or deployed real-time inference.*

This workflow joins explicit browser-webcam capture, bounded local file import,
the existing native CPU analyzer, source-matched inspection, human decisions and
portable reporting. The separate [one-camera LAN recorder](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/lan-recording.md) now
feeds finalized RTSP segments into the same workflow with explicit Start/Stop and
bounded retention. Gapless recording, identity tracking and sustained 100-camera
operation remain separate work.

## Prepare once

Use the [PC installer and model preparation](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/PC-testing). The prepared model
must match the pinned OpenCV Zoo YOLOX-S artifact: 35,858,002 bytes, SHA-256
`c5c2d13e59ae883e6af3b45daea64af4833a4951c92d116ec270d9ddbe998063`.
Setup uses existing local weights; it never downloads or silently substitutes a
model. The labels cover 80 classes, but the starter rule emits whole-frame person
presence observations only. Review or replace those rules for your use case.

Start with `--analysis --allow-recording-import` on Linux, or
`-Analysis -AllowRecordingImport` on Windows. Custom catalogs remain supported.
Models and configured rules stay off the browser write API; the one exception is
[guided training](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guided-training), which with `--allow-training` may add new tuned
rule sets and never overwrites a file. The original CPU limits and explicit
separate CUDA CLI path remain in force.

## Use the complete path

1. Monitor → Connect source → This computer's webcam → Connect webcam.
2. Press **Record webcam clip**, then **Stop recording**. A stop is requested at
   60 seconds; the completed clip must fit within 64 MiB. The microphone stays off.
3. **Open clip in Recognition**, **Connect local analysis**, then **Import webcam
   clip**. Alternatively select an existing WebM, MP4/MOV, AVI or MKV file with
   **Import recording from this computer**. Import does not start inference.
4. Review the selected model/rules and press **Analyze recording**. Progress,
   cancellation, partial-result labels and exact-source matching remain visible.
5. Inspect sampled boxes, scores and the report activity bars. **Send observations
   to Events**, make decisions/add notes, then return to Recognition.
6. Download the printable report, report JSON or observation CSV. **Save recognition
   results** and **Save analyzed recording** retain the exact pair for later
   reopening. The printable HTML works offline and can be printed to PDF.

## What the report means

Counts aggregate detections across sampled frames. Repeated sightings are counted
repeatedly; they are not unique people or tracked objects. Peak counts are per
sample. First/last sightings are sampled timestamps, not entry/exit events.
The activity bars use at most 100 groups and select each group's busiest sample.
No continuous occupancy or movement is inferred between samples.

Changing the score filter affects inventory/activity summaries only. It does not
rewrite rule observations. Scores are not calibrated probabilities. Variable-rate
recordings need separate time-alignment verification because the existing
analyzer uses container FPS. A missing detection does not establish absence.

Reports include source, model, labels and both rules fingerprints, sampling
settings, completion/partial status and current matching browser decisions/notes.
They are unsigned, editable exports. SHA-256 proves byte correspondence, not
authenticity or recognition quality. Report JSON is a summary format; the separate
recognition-bundle export is what reopens frame overlays.

## Storage and failure behavior

| Item | Lifetime and bounds |
| --- | --- |
| Webcam clip in browser | One clip up to 64 MiB; save/import before reload or closing. Unsaved clips block another capture until discarded or imported. |
| Imported files | Same configured recording folder; content-derived filename; 64 MiB each, at most 20 managed files/512 MiB; never overwrite originals or automatically delete older imports. |
| Incomplete import | Removed on handled failure. Crash leftovers count toward the quota. A retained `.dvr-import.lock` refuses further imports until all services are stopped and the lock is inspected/removed locally. |
| Active analysis | Existing one-job CPU limits; imports are refused while the job runs. |
| Last completed result | Temporary by default; optional Linux last-job recovery remains separate. New jobs replace the last result, not the imported recording library. |
| Human decisions | Browser storage and explicit review/report exports; no durable authenticated review database yet. |

The endpoint checks exact loopback Host, origin and token before reading media.
One bounded binary request carries a SHA-256 fingerprint. Content length, MIME and
container header must agree; playlists/text are refused. Files are hash-checked
and synced before exclusive publication. Retrying the same file reuses its saved
copy. A lock serializes imports from multiple service processes using the same
folder. Keep 64 MiB free after each import. Local filesystem/OS ownership remains
trusted; this is not a hostile-OS boundary or a power-loss durability claim.

Browser recording timers are not exact. Hiding/leaving Monitor or disconnecting
requests capture stop. Runtime/codec failures discard the failed recording and
show an error. Raw RTSP/public preview images are not recorded by this browser feature. The
optional native LAN recorder uses a separately configured RTSP capture worker.

Browser API references: [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder),
[final data and timeslice behavior](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/dataavailable_event).

## Remaining operational work

The next acceptance step is an owner-approved physical webcam recording with
independently labeled people/objects, followed by one configured LAN camera with
bounded segment recording, retention, restart recovery and explicit live-analysis
start/stop. Only then expand the same workload through 5/25/50/100 simultaneous
cameras with measured resource use, stale/drop rates and event precision/recall.
GPU scheduling already has offline foundations; full live ingest/recording and
durable review history need integration before a capacity claim.

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/recording-workflow.md) · Generated from the checked documentation source; historical and schematic images are labeled.
