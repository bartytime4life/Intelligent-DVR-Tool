# Reproducible offline detection pilot

This infrastructure evaluates explicitly selected local files. It does not open
cameras, capture video, start services, download weights, transmit footage or
use a paid service. The current committed corpus contains **supplied synthetic
detections, labels, timings and review decisions**. Its text source is not a
recording. These fixtures establish arithmetic and evidence plumbing only.

Representative-scene accuracy, target-workstation performance, physical camera
compatibility and the required 100-camera capacity remain **unqualified**. An evaluation
report never automatically promotes those states, including on real recordings.

## Reproduce the deterministic evaluation

From the repository root, using Python 3.11+ (the evaluator uses only the standard
library; native inference requirements are separate):

```bash
python3 -m edge.evaluate \
  --manifest tests/fixtures/evaluation/manifest.json \
  --reviews tests/fixtures/evaluation/reviews.json \
  --output /tmp/dvr-synthetic-evaluation.json
python3 -m unittest discover -s tests -p 'test_*.py'
```

Use a new output filename each time. Evaluation reports use
`intelligent-dvr.evaluation.v1`; they are deliberately separate from the browser's
`intelligent-dvr.receipt.v1` event import. They contain metadata, never source
pixels, thumbnails or executable media links. The unchanged browser receipt
workflow still requires checking original footage and hashes.

The supplied fixture must produce these **synthetic arithmetic results**:

| Class | TP | FP | FN | Precision | Recall |
| --- | ---: | ---: | ---: | ---: | ---: |
| person | 2 | 2 | 1 | 0.5 | 2/3 |
| car | 1 | 1 | 0 | 0.5 | 1 |
| bicycle | 0 | 0 | 0 | null | null |

Four supplied timing values `[10,20,30,40]` give nearest-rank p50=20ms and p95=40ms.
These are **not measurements**. One supplied false-alert decision in four seconds
of synthetic coverage gives 900 false alerts/camera-hour, demonstrating the
formula rather than predicting an operating rate. Omit `--reviews` and that rate
becomes null because both emitted alerts need adjudication.

Regenerate identical fixture inputs in a new directory with:

```bash
PYTHONPATH=. python3 tests/evaluation_fixtures.py /tmp/new-dvr-fixture
```

## Prepare approved local recordings

1. Obtain permission to process the recordings and document source rights,
   retention, allowed reviewers and model/label provenance. Keep recordings,
   real annotations, traces, decisions and reports outside Git and hosted apps.
2. Select held-out scenes covering normal operation, empty views, difficult
   lighting, occlusion, camera motion and target distances. Split by recording
   or scene to reduce leakage. Record source SHA-256, independently checked
   frame count, constant frame rate, resolution, camera pseudonym and scene
   conditions. Variable-rate timing is unsupported until separately verified.
3. Label all instances of the selected classes on each chosen sampled frame.
   An empty `objects` array explicitly means an exhaustive negative frame.
   Omitted frames are unannotated and contribute no detection counts. This
   format has no crowd, ignore-region or partially labeled-class semantics;
   do not treat partially labeled frames as exhaustive.
4. Fix classes, score/IoU thresholds, sampling, zone, dwell and max-gap rules
   before comparing models. Keep tuning and final evaluation scenes separate.
5. Run the existing analyzer once per approved recording with optional trace
   output, then evaluate the local trace against the labels. Report sampled
   detection quality separately from event review and timing.

The selected OpenCV Zoo FP32 YOLOX-S remains hash-bound to
`c5c2d13e59ae883e6af3b45daea64af4833a4951c92d116ec270d9ddbe998063`,
the verified COCO80 ordering, preprocessing and decoder. The candidate record,
upstream revision, source URLs and preserved Apache-2.0 text remain unchanged.
Review footage/dataset rights separately. Retain applicable license, attribution
and notices if redistributing weights; no weights are bundled or fetched here.
See [model qualification](model-qualification-20261026.md) and
[third-party notices](third-party-notices.md).

After deliberately obtaining and verifying that artifact, example local analysis:

```bash
python3 -m edge.analyze \
  --video /private/pilot/dock.avi \
  --model /private/models/object_detection_yolox_2022nov.onnx \
  --labels edge/labels/coco80.json \
  --profile opencv-zoo-yolox-s-2022nov \
  --rules /private/pilot/rules.json --camera dock-01 \
  --stride 5 --max-frames 6000 --threads 1 \
  --output /private/pilot/receipt.json \
  --trace-output /private/pilot/trace.json
```

Directories must already exist. Both destinations must be new and distinct;
reserving either destination cannot overwrite previous evidence. Trace mode is
bounded to 10,000 sampled frames and 100,000 detections; split longer recordings.
The analyzer retains its 100,000 decoded-frame maximum, 4K sampled-image bound
and 1,000-event ceiling. Exhausting a frame/event bound produces a partial trace
that evaluation rejects. Set `max-frames` **above** the independently verified
source frame count so the decoder can reach EOF. OpenCV read failure still
cannot distinguish clean EOF from damaged media; count agreement is a necessary
coverage check, not proof of file integrity. No hard inference deadline or
native-code sandbox was added to the recording analyzer.

## Manifest contract

Use `intelligent-dvr.evaluation-manifest.v1`, matching the committed synthetic
example. Each manifest has a single labels file and evaluated class subset.
All clips must use the same model hash and profile. A representative manifest
uses `data_kind: approved-local-recordings`, with declarations under `approval`:
`approved_by`, `source_rights`, `annotated_by`, `annotation_policy`, and `split`.
These are human declarations, not authentication or automated license clearance.

| Clip field | Meaning |
| --- | --- |
| `camera` | Unique pseudonym; one source per camera per manifest prevents overlapping hours without absolute clocks |
| `source`, `source_sha256` | Local source file and exact expected hash, checked before evaluation |
| `trace` | Frame-level `intelligent-dvr.detection-trace.v1` emitted by the analyzer |
| `fps`, `frame_count` | Independently verified CFR timing/coverage; must match the complete trace |
| `frames` | Chosen `{frame_index, objects:[{label,box}]}` annotations; indices must have been analyzed |
| `alert_review_intervals` | Sorted, disjoint `[start,end)` seconds of explicitly reviewed alert coverage; optional |

Source, labels and trace paths are relative to the manifest directory, without
`..`, URLs, absolute paths, symlinks or linked parent directories. Place the
reviewed labels file under the same directory; its byte hash must match the
analyzer trace. Do not replace COCO80 with the three-class synthetic fixture.
Duplicate source hashes/cameras, malformed or nonfinite values, duplicate JSON
keys, mismatched labels/rules, incomplete sampled-frame grids, partial traces,
and stale/unknown review references fail evaluation. Inputs are bounded JSON
metadata (manifest/reviews 8 MiB each, labels 64 KiB, trace 32 MiB).

Trace frames retain normalized `[left,top,width,height]` boxes, exact model
labels, scores, frame index/index-derived time and inference/decode milliseconds.
Trace provenance includes source/model/label hashes, original rule-file hash,
canonical rule configuration hash, rule-engine hash, runtime versions, CPU
backend and thread count. Events are replayed with the existing rule engine;
changed events or rule-engine versions are rejected. Continuous class presence
still does not establish persistence of the same person or object.

## What the report measures

- **Detection quality:** score-descending, same-class, one-to-one greedy IoU
  matching on annotated frames, with stable input-order ties. Defaults are score
  0.5 and IoU 0.5; override with `--score-threshold`/`--iou-threshold`. The adapter
  already drops scores below 0.1 and applies class-aware NMS at IoU 0.45, so a
  lower evaluation score threshold is rejected. TP/FP/FN, per-class precision
  `TP/(TP+FP)`, recall `TP/(TP+FN)` and micro counts are reported. Undefined
  denominators are null, never zero or perfect. This is not COCO AP/mAP.
- **Timing:** count, minimum, mean, nearest-rank p50/p90/p95/p99 and maximum,
  per clip and pooled across measured samples. `--warmup-frames N` removes the
  first N analyzed frames per clip from timing only, with that choice recorded.
  These times cover `setInput`, inference and decoding/NMS, excluding media
  reads, preprocessing, rendering and human review. A latency distribution is
  neither sustained throughput nor end-to-end delay. Pooled sequential clips
  never establish concurrent 100-camera capacity or target-host performance.
- **Alert review:** existing class/zone/dwell events, source hash, trace hash,
  event ID, originating frame/time and explicit human decision metadata. A
  detector FP box is not automatically a false rule alert. Pending decisions
  stay pending and every event retains `review_required: true`.
- **False alerts per camera-hour:** explicitly adjudicated false alerts inside
  reviewed intervals divided by their summed duration in hours. Every emitted
  alert within that coverage must have a decision; otherwise the rate is null.
  No coverage also yields null. A reviewed interval with no emitted alerts may
  yield zero, scoped to that interval and this sampling/rule configuration.
  The report records reviewed hours, covered/pending alert counts, and excludes
  alerts outside coverage from the numerator. No event recall or missed-alert
  claim is made: that needs independently labeled expected event windows.

Each TP/FP/FN links to the source hash, trace hash, frame/time, prediction index
and annotation index. Retrieve boxes from the exact trace and manifest whose
hashes are in the report. No screenshots are needed or transmitted. Reports
also bind evaluator/rule-engine/profile code hashes and optional review-file
hash. Identical inputs and options produce identical JSON in the same code
version; new real inference runs have their own measured times and trace hashes.

## Human alert decisions

Keep a separate `intelligent-dvr.alert-reviews.v1` JSON file with:

```json
{
  "schema": "intelligent-dvr.alert-reviews.v1",
  "manifest_sha256": "<exact manifest SHA-256>",
  "decisions": [{
    "trace_sha256": "<exact trace SHA-256>",
    "event_id": "<existing rule event ID>",
    "verdict": "false_alert",
    "reviewer": "<reviewer pseudonym>",
    "reviewed_at": "<review time>",
    "rationale": "<decision supported by original footage>"
  }]
}
```

Allowed verdicts are `confirmed` and `false_alert`. Copy IDs/hashes from local
evidence, inspect the original footage and provide a reason. Changing manifest
coverage or trace bytes invalidates stale review bindings. Supply `--reviews`
when evaluating; omit it to keep alerts pending. Synthetic fixture decisions
are explicitly invented test inputs and must never be reused as real reviews.
Traces and decisions are unsigned, locally editable files. Hash links detect
accidental mismatches; they are not an authenticated audit trail, model parity
proof or proof that declared rights/labels/reviews are correct.

## Remaining pilot acceptance

Collect the approved held-out recordings and labels, review errors and alert
decisions, agree quality/error budgets, and execute the pinned runtime on the
owner's hardware. Record sample sizes, coverage, scene conditions and sampling
choices alongside results. Qualify sustained performance, at least 100-camera load and
physical camera compatibility separately before operational reliance. No
quality threshold is silently selected and no automatic enforcement is added.

The current capacity requirement and staged optimization plan are in
[100-camera performance preparation](performance-100-cameras.md). Reports add
`capacity_target_cameras: 100` and `qualification.concurrent_camera_capacity`.
The legacy `five_camera_capacity` field remains unqualified for compatibility
with existing report readers; it no longer describes the product target.
