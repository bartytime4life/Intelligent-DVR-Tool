# Recording recognition integration — October 29, 2026

Base: upstream main `d0ff007472a2f3c03f4dcaf4044fc260c0dbc270` (merged PR #23).
The separate local implementation checkout started with a byte-matched snapshot
of that tree. Existing facility/unpublished work was preserved.

[Workflow and bounds](../../recording-recognition.md) · [Sanitized native results](results.json)
· [Implementation hashes](source-hashes.json)

## Actual native execution

Two previously used public-reference recordings remained in place on the owner
computer. The existing isolated CPU interpreter (Python 3.12, OpenCV 4.13.0,
NumPy 2.5.4) ran the pinned OpenCV Zoo YOLOX-S model with exact COCO80 labels,
four OpenCV threads, stride 5 and a 250-decoded-frame cap per recording. The
existing process-local seccomp guard denied IPv4/IPv6 sockets for these runs.
No recording was copied/transmitted; no camera, driver, package or GPU setting
was changed. CPU selection was explicit, not a CUDA fallback.

Rules were full-frame `person` and `car` presence, threshold 0.5, zero dwell and
maximum sampling gap 2 seconds. The display summary also used score ≥0.5.

| Input role | Decoded / sampled | Rule observations | Model detection instances across sampled frames | Inference + postprocessing p50 / p95 |
| --- | ---: | ---: | --- | --- |
| Person reference | 250 / 50 | 2 | person 36 | 104.67 / 122.56 ms |
| Vehicle reference | 250 / 50 | 1 | car 200; truck 99 | 102.81 / 121.00 ms |

These are repeated per-frame model detections, **not unique people/objects,
independent ground truth or measured precision/recall**. Both runs are `partial`
because the configured frame cap was reached. Actual review JSON from both runs
was accepted by `parseRecognition`, with class summaries/event-frame association
checked. That is parser integration, not visual browser acceptance on real video.
Timings exclude capture, most decoding/preprocessing, display and human review.

Private receipts/review bundles remain under the checkout's ignored
`qa-local/recognition-20261029/`. Published JSON contains only hashes, counts,
runtime/timing metadata and stated scope; no recording paths, footage or boxes.

## Local checks

- Python: 142 passes, no skips, including actual synthetic ONNX/video integration.
  The native integration now covers receipt+trace+review, review without a separate
  trace, partial caps, destination collision, source/configuration changes before
  publication, and receipt-only compatibility.
- Frontend: 70 passes, one existing real-socket test skipped because this session
  denies loopback listen. Eight recognition cases cover mixed provenance/settings,
  invalid boxes/times/limits, exact-file hashing, stale-overlay suppression,
  partial coverage, display-only filtering and repeat-import review preservation.
- Packaging: all four Sites checks pass; the production build passes with the
  pre-existing large facility chunk warning. Hosting files are unchanged.
- Three new Chromium scenarios cover mismatched sources/Events handoff, malformed
  and partial results/mobile width, and matched generated video with paused-frame
  overlays and playback/reload suppression. They are included in the existing
  hosted browser workflow, which uses generated test pixels only.

The local Vite start attempt returned `listen EPERM` at `127.0.0.1:4187`.
The selected local node_modules also lacks `@playwright/test`. No local browser
pass or screenshot is claimed. Hosted browser results belong to the pull request's
exact revision; this local record does not substitute a planned CI run for a pass.

## Remaining acceptance

This implements the recording-to-review milestone, not a production monitoring
service. Independently labeled field video, operator walkthrough, codec/timestamp
qualification, live ingest/continuous recording, tracking, durable authenticated
review, restored CUDA visibility and sustained 100-camera workload acceptance
remain open. A SHA-256 match checks source correspondence, not signed custody or
truth of model observations. Existing GPU evidence is historical; this run makes
no new CUDA performance claim.

Reproduce from a fresh output directory using the [guide](../../recording-recognition.md),
then run the Python suite, `npm test`, `npm run test:sites`, `npm run build`,
`python3 scripts/check-docs.py` and `python3 scripts/build-wiki.py --check`.
