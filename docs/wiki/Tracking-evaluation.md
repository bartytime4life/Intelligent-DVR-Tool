# Offline tracking evaluation

[Guide index](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guide-index) · [Detection evaluation](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Offline-evaluation) · [Live AI and tracking](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Live-AI-and-tracking)

Measure saved recording traces against independently labeled anonymous object
tracks. This is a local CLI workflow, using the existing analyzer, trace format,
source hashes and recognition contracts. It opens no camera, loads no model,
collects no footage and changes no review decision. Reports require human review
and never qualify physical cameras, identity or installation capacity automatically.

## Reproduce synthetic validation

Use the installed DVR Python environment (Python 3.11+ with NumPy). The application
already supplies NumPy; the evaluator adds no native dependency or model download.
The optional [pinned runtime](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/edge/requirements-qualification.txt) provides the
project's reproducible Linux/Windows dependency environment. Run from the repository
root, choosing new output paths:

```bash
PYTHONPATH=. python3 tests/tracking_evaluation_fixtures.py /tmp/dvr-track-fixtures
python3 -m edge.evaluate_tracking \
  --manifest /tmp/dvr-track-fixtures/crossing/manifest.json \
  --output /tmp/dvr-track-crossing.json
python3 -m unittest discover -s tests -p 'test_tracking_evaluation.py'
python3 -m unittest discover -s tests -p 'test_tracking.py'
python3 -m unittest discover -s tests -p 'test_evaluation.py'
```

On Windows, replace the first command with PowerShell
`$env:PYTHONPATH='.'; python tests/tracking_evaluation_fixtures.py "$env:TEMP/dvr-track-fixtures"`
and use paths in that folder for the evaluator. No shell environment assignment
is needed for `python -m edge.evaluate_tracking` itself.

The generator prescribes truth paths independently, then feeds synthetic detector
boxes to the application's actual `edge.tracking.Tracker`. Labels are never copied
from its output. An exact crossing, three-frame temporary occlusion, long departure
and reentry, and scores changing down to 0.1 exercise the recording contract.

| Synthetic scenario | Sampled frames | FN | ID switches | MOTA | IDF1 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Crossing paths | 21 | 0 | 0 | 1 | 1 |
| Temporary occlusion | 10 | 3 | 0 | 0.7 | 14/17 |
| Disappearance/reappearance | 22 | 1 | 1 | 5/7 | 6/13 |
| Confidence changes | 10 | 0 | 0 | 1 | 1 |

These are deterministic **synthetic evaluator/tracker results**, not recognition
measurements on physical cameras. Another independent known-answer test supplies
two objects whose predicted IDs swap halfway through four frames: TP=8, FP=0,
FN=0, IDSW=2, MOTA=0.75, IDF1=0.5 and HOTA=sqrt(1/3). Tests also cover false tracks,
never-matched truth tracks, negative MOTA, absent predictions, empty scenes,
low-confidence filtering, fractional FPS, rejected timestamps, missing labels,
class changes, invalid track references, input hashes and exclusive report writes.

## Label an owner-approved recording

1. Select a recording you have explicit authorization and source rights to use.
   Keep footage, labels, traces and reports in a private local folder outside Git.
   Record authorized reviewers, retention and deletion requirements. Use anonymous
   object IDs such as `object-A`, never names, face templates or enrollment data.
2. Independently verify constant frame rate, frame count, source SHA-256 and
   camera pseudonym. Variable-frame-rate timing is unsupported; do not relabel
   an unverified recording as CFR. Choose stride, evaluated classes and thresholds
   before final evaluation. Keep tuning scenes separate from held-out scenes.
3. Use the [existing analyzer command](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Offline-evaluation#prepare-approved-local-recordings)
   with `--trace-output` to create a completed trace, or retain its existing trace.
   Analyzer traces include per-frame track IDs and hash-bound tracking parameters.
   Old results lacking tracks require explicit re-analysis. Traces from a different
   tracker version require explicit re-analysis with this revision. Partial traces
   cannot establish evaluation coverage. No live camera is needed for this step.
4. Independently label every instance of every selected class on **every sampled
   frame**, including an explicit empty list when no evaluated object is present.
   Retain an object's truth ID through a short occlusion or reentry when the
   independent reviewer can establish continuity. Record that ID policy. If a
   reviewer cannot establish it, choose a separately labeled unambiguous clip;
   this format has no ignore/crowd/uncertain-identity masks. Do not silently omit
   difficult frames or count tracker-generated labels as independent truth.
5. Have a second reviewer check labels and continuity when practical. Record the
   labeler and split in `approval`; declaring independence is a human attestation,
   not authenticated proof. Evaluate the chosen files, inspect error locations
   against original footage, and confirm conclusions manually.

Extend an ordinary `intelligent-dvr.evaluation-manifest.v1` detection manifest.
Keep its existing `approval`, `labels`, `classes`, `clips`, source/FPS/frame-count
and trace fields. Set `data_kind` to `approved-local-recordings` only for approved
actual recordings; precomputed synthetic traces are rejected in that mode.
Add this top-level declaration:

```json
"tracking": {
  "schema": "intelligent-dvr.tracking-labels.v1",
  "independent_labels": true,
  "coverage": "all-sampled-frames",
  "timebase": "constant-frame-rate",
  "id_policy": "Anonymous IDs persist across reviewer-confirmed occlusion and reentry within this clip."
}
```

Add `seconds` and independent `track_id` values to each clip's existing frame labels:

```json
"frames": [
  {"frame_index": 0, "seconds": 0, "objects": [
    {"track_id": "object-A", "label": "person", "box": [0.1, 0.2, 0.18, 0.3]}
  ]},
  {"frame_index": 5, "seconds": 0.2, "objects": []}
]
```

This example assumes 25 FPS and stride 5. Include the remainder of the trace's
sampled frames in order. Times must equal `frame_index / fps` exactly; compute
this value rather than rounding timestamps to milliseconds. Boxes are normalized
`[left, top, width, height]`. One truth ID occurs at most once per frame and keeps
the same class throughout the clip. Clip and camera ID namespaces remain separate.
The evaluator rejects missing, reordered, duplicated and unsampled frame labels.

Source, trace and labels paths must be regular local files within the manifest
folder. Hash/source/model/rule/sampling checks reuse detection evaluation. Use one
clip per camera per manifest, with no repeated source hashes, as in that workflow.
To evaluate another interval, prepare a separate bounded clip/trace with its own
source hash and matching label timebase; do not delete frames from a trace.

```bash
python3 -m edge.evaluate_tracking \
  --manifest /private/pilot/tracking-manifest.json \
  --score-threshold 0.1 --iou-threshold 0.5 \
  --output /private/pilot/tracking-report.json
```

The destination must be new. The evaluator writes metadata only, never overwrites
inputs or imports observations into Events. Reports are separate from recognition
receipts and do not modify human confirmations, rejections or face suggestions.

## Read measurements correctly

| Output | Meaning |
| --- | --- |
| TP / FP / FN | Matched / unmatched predicted / missed labeled track boxes under same-class CLEAR matching |
| IDSW | A labeled object matches a different predicted ID from its last match, including across a gap |
| MOTA | `1 - (FN + FP + IDSW) / labeled boxes`; may be negative |
| IDF1 | Global one-to-one identity assignment: `2*IDTP / (2*IDTP + IDFP + IDFN)` |
| HOTA / DetA / AssA | Reference detection/association accuracy across 19 IoU thresholds, 0.05 through 0.95 |
| Never-matched truth tracks | Anonymous labeled objects with no CLEAR match anywhere in the scored sequence |
| Untracked detections | Above-threshold boxes without a confirmed track ID, listed by frame and detection index |
| Error rows | Timestamped FN, FP and IDSW entries for manual inspection against original footage |

Scores are ratios, not percentages. Quality ratios are null when there are no
truth boxes; raw false-positive counts remain available. A detection without a
track ID is excluded from predicted tracks and visibly reported. The corresponding
labeled object is an FN unless another tracked prediction matches it. Tentative
tracks and the existing summary cap can cause these misses. `tracks_dropped`
remains visible. The default 0.1 score threshold retains the tracker's low-score
second-stage matches; raising it changes the measurement and can break continuity.

MOTA/CLEAR and Identity use `--iou-threshold` (default 0.5). HOTA always uses its
reference alpha sweep; that CLI option does not change the sweep. Aggregate scores
use the reference `combine_sequences`, including association/count weighting;
they are not simple averages of clip percentages. Matching stays within a class
and camera/clip. No cross-camera reidentification or face accuracy is measured.

The inherited trace bounds are 10,000 sampled frames and 100,000 detections per
clip. Tracking evaluation additionally allows 500 combined truth/prediction IDs
per clip/class and two million frame-level same-class pairs per clip, bounding
the reference's dense assignment arrays. Split larger recordings deliberately and
report the split policy; sequential evaluation does not qualify camera capacity.

## Metric provenance and reproducibility

The MIT-licensed [TrackEval reference](https://github.com/JonathonLuiten/TrackEval/tree/12c8791b303e0a0b50f753af204249e622d0281a)
supplies CLEAR, Identity and HOTA, including HOTA's association-aware matching.
The source subset, upstream hashes, license and explicit compatibility changes
are preserved [beside the vendored code](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/edge/_vendor/trackeval/README.md).
No tracking metric is approximated by detector precision/recall.

The compatibility adapter reuses the application's original dense Hungarian solver;
the tracker's v3 sparse component dispatcher does not change the reference metric
adapter. Exhaustive
small-matrix tests verify its optimal assignment costs, including rectangular,
negative, tied and large-cost matrices. Equal-optimum ties use deterministic input
order and can select a different valid assignment from SciPy; this is not a claim
of bit-for-bit parity with every external benchmark configuration. Known-answer
metric tests verify swaps, misses, false tracks and the HOTA threshold sweep.

Each report binds manifest, source, trace, model/labels, tracker parameters,
upstream commit, local implementation SHA-256 values and Python/NumPy versions.
JSON hashes identify the bounded UTF-8 bytes actually parsed, rather than a later
read of the live path. Tracking captures its manifest and traces again after the
shared detection-validation stage and requires those captured hashes to match
the first stage; changes between stages fail evaluation. Once a second-stage
capture succeeds, later path changes do not alter that captured input or its
reported hash. The report records this policy in `input_binding`. The
[generated race regressions](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/evaluation-binding-2026-11-11/README.md)
exercise both stage changes and replacements after capture. Source media is
hash-checked as a stream, without copying or decoding it.
Repeat with the same files, code and environment; reports contain no generated
timestamp. Retain those exact inputs privately for reproducibility. The records
are unsigned evidence, not proof of authentic independent labels or recording
capture completeness. Physical-camera accuracy still needs owner-approved,
independently labeled representative recordings and human confirmation.

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/tracking-evaluation.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
