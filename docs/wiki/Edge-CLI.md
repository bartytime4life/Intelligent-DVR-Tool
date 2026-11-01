# Offline analysis foundation

[Operator handbook](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-handbook) · [Mac setup](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Mac-setup) · [PC setup](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/PC-testing) · [Guide index](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Guide-index)

[Current visual atlas](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-atlas)

![The local analyzer is one explicit stage between selected recordings and human review.](https://raw.githubusercontent.com/wiki/bartytime4life/Intelligent-DVR-Tool/docs/media/guide/recording.svg)

*This diagram does not show real inference or claim live camera performance.*

New recording analysis checks [decoded source coverage](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recording-coverage)
before completion. Install the current optional requirements, including PyAV;
unknown completeness stays partial and early/corrupt decoding publishes no result.

Optional [saved-recording sharpening comparisons](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Enhancement-comparison)
use `--compare-enhancement mild-unsharp-v1` with trace/review output. They retain
original-only rules, separate candidate detections and unqualified accuracy.

For read-only source/log reconciliation and an explicit workload-plan preflight,
use the [offline qualification checklist](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Offline-qualification).
It runs separately from this analyzer and does not execute inference.

[Architecture and data](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Architecture-and-data) · [Evaluation](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Offline-evaluation) · [Fresh verification](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/2026-10-27/README.md)

This tool reads one explicitly supplied local recording. It does not connect to
cameras, start background services, download models, send footage, or call an API.
No trained model is supplied. Camera compatibility, recognition accuracy and
production latency are unqualified.

An [offline evaluation harness](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Offline-evaluation) now compares
frame-level traces with approved local labels, reports fixed-threshold per-class
precision/recall and timing distributions, and computes false alerts per reviewed
camera-hour only when all covered alerts have explicit decisions. Deterministic
synthetic fixtures validate the infrastructure, not recognition quality.

The product requirement is now at least 100 simultaneous cameras. The
[performance preparation guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/100-camera-plan) documents
the bounded scheduler and offline load model. `edge.capacity` is a virtual-time
diagnostic using an explicit assumed service cost; it never opens a source or
executes a detector. `edge.analyze` still processes one local recording per run.

## Run

For source-matched visual review, add `--review-output receipts/review.json`.
Open this metadata bundle in the browser's **Recognition** workspace, then select
the original recording. See the [recording recognition pilot](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Recognition-details).
All output paths must be new and distinct. Review mode uses the trace bounds,
retains per-frame dimensions, and rechecks source/model/labels/rules hashes before
writing. Receipt-only callers retain their existing output contract.

Python 3.11+ is recommended. From the repository root:

```bash
python3 -m venv .venv
.venv/bin/pip install -r edge/requirements.txt
.venv/bin/python -m edge.analyze \
  --video recordings/approved-clip.mp4 \
  --model models/reviewed-detector.onnx \
  --labels models/labels.json \
  --rules edge/rules.example.json \
  --camera dock-01 \
  --output receipts/dock-01.json
```

Create the `receipts` directory first. Output must be a new path; prior evidence
is never overwritten. Inputs are local regular files, not RTSP URLs or devices.
Keep model files, footage, receipts and credentials out of Git.

`labels.json` is a JSON array in the model's exact class order, for example
`["person", "car"]` only for a model actually trained with exactly those two
classes in that order. Do not substitute that example for a COCO model's labels.
Review the model and training-data licenses before any commercial use.

The default `--profile yolov8-raw-640` accepts raw outputs `[1,4+C,N]`: 640×640 letterboxed RGB
input, xywh boxes in input pixels, post-sigmoid scores, no objectness column,
no embedded NMS. YOLOv5, end-to-end NMS exports, segmentation, other input sizes,
normalized output coordinates and multiple output heads are unsupported.
The shape check cannot prove all those semantics: qualify your actual export.

An additional **explicit, hash-bound** profile, `opencv-zoo-yolox-s-2022nov`,
supports the pinned OpenCV Zoo FP32 YOLOX-S artifact. It uses RGB **0–255**,
top-left letterbox placement, floor resize dimensions, raw `[1,8400,85]` output,
stride/grid decoding and objectness × class scoring. This differs from the
upstream Megvii demo's default BGR input. Do not substitute another YOLOX export,
INT8 model or a legacy normalized model. Model hash and all 80 labels in exact
order must match. The existing YOLOv8 profile remains the default.

See [the model comparison and reproducible qualification path](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Model-qualification-2026-10-26)
for license evidence, the pinned download, a bounded synthetic-input check and
the remaining accuracy gates. No model download occurs inside either CLI.

After obtaining and checking that specific artifact, an approved local recording
can be analyzed with the existing command plus:

```bash
--profile opencv-zoo-yolox-s-2022nov --labels edge/labels/coco80.json
```

Replace the original `--labels` argument rather than supplying it twice. This
enables offline analysis only, not automatic capture or operational acceptance.

Add `--trace-output /private/pilot/trace.json` to retain sampled detections and
per-frame timing for evaluation. `--threads 1` (default; range 1–8) explicitly
selects OpenCV CPU thread count and, on the optional CUDA route, the ONNX Runtime
CPU thread-pool limit. It is not a GPU, codec or OS resource quota. Receipt import remains unchanged. Evaluation
traces are separate metadata files and are not browser receipts. See the
[evaluation guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Offline-evaluation) for coverage requirements,
new output paths, bounds, labels and review decisions.

## Optional explicit CUDA backend

`--backend opencv-cpu` remains the default and does not import ONNX Runtime.
An explicit `--backend onnxruntime-cuda` selects the optional local GPU path.
It accepts only the exact hash-bound `opencv-zoo-yolox-s-2022nov` profile and
COCO80 labels above. It does not download a model or runtime, start a camera,
change confidence/rule settings, or fall back to CPU after a CUDA error.

The separately pinned Linux/Python 3.12 environment was verified on the owner's
RTX 5080. Install it in a separate environment; it is optional and is not added
to the ordinary CPU requirements or CPU CI:

```bash
python3.12 -m venv .venv-cuda
.venv-cuda/bin/python -m pip install -r edge/requirements-gpu-qualification.txt
.venv-cuda/bin/python -m edge.analyze \
  --video recordings/approved-clip.mp4 \
  --model models/yolox-s.onnx --labels edge/labels/coco80.json \
  --profile opencv-zoo-yolox-s-2022nov --backend onnxruntime-cuda \
  --rules edge/rules.example.json --threads 4 \
  --output receipts/cuda-clip.json --trace-output receipts/cuda-clip-trace.json
```

Review the actual rules/recording before running; `receipts` must exist and
both output paths must be new. Vendor runtime libraries install inside the
environment; driver installation and host tuning are separate actions. Other
GPUs, operating systems and runtime versions remain unqualified.

Each CUDA run disables TF32 and CPU graph/runtime fallback, verifies retained
provider settings and the pinned model's input/output tensor contract, then
profiles one synthetic zero-input startup probe. A CPU node event or missing
CUDA execution aborts without a receipt. The private temporary profile is
removed; its hash, node-event counts and scope are retained in `runtime` in
both the receipt and optional trace. The startup probe is excluded from
per-frame timing. It verifies startup graph execution, not frame-by-frame
profiling, detection accuracy, end-to-end latency or camera capacity.

The CUDA arena limit is 1 GiB, with heuristic convolution search and restricted
workspace; total device use can exceed this arena. This is not a hard VRAM/RAM
cap or inference deadline. Retained CPU-provider registration is distinct
from graph execution; fallback is disabled and startup node execution must
show CUDA only. Missing libraries/providers, incompatible shapes/settings or
execution failures produce an error rather than silently rerouting.

Receipts retain schema `intelligent-dvr.receipt.v1` and add `runtime` metadata
for either backend. Existing event IDs/import behavior are preserved; the
browser imports events and does not execute or select this backend. See
[GPU guidance](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/GPU-planning) and the
[backend qualification record](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/cuda-2026-10-28/README.md).

The separate `edge.workers.LocalWorkers` adapter executes 1–4 explicitly
supplied processors against the existing bounded scheduler. It is a local
integration component, not a new analyzer flag, GPU default or camera service.
Its ownership, outcome/failure handling, native-call limits and measured replay
scope are in the [worker guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/100-camera-plan#bounded-local-execution-adapter).

For explicitly supervised Linux integration, `edge.supervision.ProcessWorkers`
constructs independent processors in one owned spawned child and adds polled
startup/task deadlines, bounded result IPC and an explicit restart budget
(default zero). It reports terminal sample failures instead of retrying them.
This is a separate application component, not an analyzer flag or camera service.
See the [supervision contract](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/100-camera-plan#optional-linux-process-supervision)
and [owner-PC recovery record](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/recovery-2026-10-28/README.md).

An explicit Linux `OutcomeJournal` can commit dispatch/outcome metadata on a
private local disk before IPC/delivery. Reopening fails unresolved dispatches
and retains unacknowledged terminal records; consumers acknowledge/prune
explicitly. Parent-death cleanup kills the owned worker child. See the
[journal contract and limits](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/100-camera-plan#optional-local-outcome-journal)
and [parent-crash qualification](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/journal-2026-10-28/README.md).
Available terminal responses can commit in atomic groups of up to four within a
bounded poll; an unread index avoids scanning acknowledged history. See the
[batching qualification](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/batching-2026-10-28/README.md) for
matched measurements and atomic crash windows. SQLite durability is unchanged.
This does not persist pending samples, recording continuity or per-camera rules.

Rule JSON is an array of named rules; browser rule exports have a separate
schema and are intentionally not silently accepted by this CLI. Map a browser
zone's normalized `rect` into an edge rule with an actual model label, and review
the result on the original recording. The browser's generic `object` sample
category is not a real detector class.

## What rules mean

An observation qualifies when its box center is inside a configured rectangle,
its exact label matches and its score meets the threshold. A run continues
while qualifying observations are at most `max_gap` seconds apart; sampled
frames without one inside that gap (brief occlusion, motion blur) neither end
the run nor emit a second observation. A longer gap starts a new run and
resets dwell, which is measured from the run's first qualifying frame. It does
**not** prove that the same object or person remained there. There is no
identity tracking or learned anomaly model.

The default stride is five decoded frames. The tool rejects sampling intervals
longer than a rule's `max_gap`. Timestamps use frame index / declared frame rate;
variable-rate recordings need separate timing qualification. Rules cannot
establish what happened between sampled frames.

Work is bounded by `--max-frames` (default 6,000), a 4K decoded image limit and
1,000 events. Bound exhaustion produces `state: partial`. Decode failure is
indistinguishable from EOF in OpenCV's boolean read result; receipts are not
proof of complete source integrity. Untrusted media/model parsing should run in
an isolated, resource-limited environment. No inference deadline or hardware
memory isolation is provided by this first adapter.

Receipts include source/model SHA-256, sampling details, review-required events,
and local inference/postprocessing timing. These timings exclude capture,
networking, rendering and review: they are not end-to-end camera latency.
Import a receipt through Events → Import receipt. The browser receives metadata,
not the source video or model. Imported receipts are unverified input; verify
the original video and hashes before relying on any observation.

## Validation

```bash
.venv/bin/pip install -r edge/requirements-test.txt
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
```

The integration fixture emits a constant synthetic box regardless of pixels.
It tests the ONNX→decoder→rules→receipt path; it does **not** test recognition.
The fixtures are created in a temporary directory and removed after tests.

Primary implementation reference:
https://docs.opencv.org/4.13.0/d6/d0f/group__dnn.html

## Machine setup and exported limits

Use [Linux](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Linux-setup) or [Windows](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Windows-setup) launch/setup guidance. The [System controls](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Resource-controls) export a validated resource policy; pass `--resource-policy FILE` to this analyzer to cap CPU thread-pool size and decoded frames. Explicit overrides can lower but not exceed policy caps. The policy hash and applied caps are recorded in successful receipts and traces. Other scheduler, GPU and RAM planning values are not misreported as analyzer enforcement. `python -m edge.host` creates an explicit read-only local snapshot; `python -m edge.resources --policy FILE` validates a policy without starting inference. OpenCV CPU is the default; the optional CUDA command above requires its separate runtime and qualification.

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/edge/README.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
