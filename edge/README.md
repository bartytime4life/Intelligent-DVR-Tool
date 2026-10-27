# Offline analysis foundation

[Architecture and data](../docs/architecture.md) · [Evaluation](../docs/offline-evaluation.md) · [Fresh verification](../docs/verification/2026-10-27/README.md)

This tool reads one explicitly supplied local recording. It does not connect to
cameras, start background services, download models, send footage, or call an API.
No trained model is supplied. Camera compatibility, recognition accuracy and
production latency are unqualified.

An [offline evaluation harness](../docs/offline-evaluation.md) now compares
frame-level traces with approved local labels, reports fixed-threshold per-class
precision/recall and timing distributions, and computes false alerts per reviewed
camera-hour only when all covered alerts have explicit decisions. Deterministic
synthetic fixtures validate the infrastructure, not recognition quality.

The product requirement is now at least 100 simultaneous cameras. The
[performance preparation guide](../docs/performance-100-cameras.md) documents
the bounded scheduler and offline load model. `edge.capacity` is a virtual-time
diagnostic using an explicit assumed service cost; it never opens a source or
executes a detector. `edge.analyze` still processes one local recording per run.

## Run

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

See [the model comparison and reproducible qualification path](../docs/model-qualification-20261026.md)
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
selects OpenCV CPU thread count. Receipt import remains unchanged. Evaluation
traces are separate metadata files and are not browser receipts. See the
[evaluation guide](../docs/offline-evaluation.md) for coverage requirements,
new output paths, bounds, labels and review decisions.

Rule JSON is an array of named rules; browser rule exports have a separate
schema and are intentionally not silently accepted by this CLI. Map a browser
zone's normalized `rect` into an edge rule with an actual model label, and review
the result on the original recording. The browser's generic `object` sample
category is not a real detector class.

## What rules mean

An observation qualifies when its box center is inside a configured rectangle,
its exact label matches and its score meets the threshold. Dwell requires
continuous class presence at sampled frames, resetting on an absent frame or a
gap longer than `max_gap`. It does **not** prove that the same object or person
remained there. There is no identity tracking or learned anomaly model.

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

Use [Linux](../docs/setup-linux.md) or [Windows](../docs/setup-windows.md) launch/setup guidance. The [System controls](../docs/resource-controls.md) export a validated resource policy; pass `--resource-policy FILE` to this analyzer to cap OpenCV threads and decoded frames. Explicit overrides can lower but not exceed policy caps. The policy hash and applied caps are recorded in successful receipts and traces. Other scheduler, GPU and RAM planning values are not misreported as analyzer enforcement. `python -m edge.host` creates an explicit read-only local snapshot; `python -m edge.resources --policy FILE` validates a policy without starting inference. The current inference backend remains OpenCV CPU.
