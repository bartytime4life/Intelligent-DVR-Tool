# GPU-first local analysis — November 3, 2026

[GPU guide](../../live-gpu.md) · [OEM companion](../../oem-backup.md)

This follow-up uses the owner's preference for GPU-first inference on both live
camera AI and recorded-video analysis, including OEM backup copies and finalized
LAN recorder segments. An explicit CPU override remains available. A shared
non-blocking lease permits one GPU inference worker in this service; another
workload uses a visibly labeled CPU path. Other applications, including OEM DVR
software, are outside that lease policy.

No cameras were connected or recordings activated. Detector weights, labels,
private footage and existing environments were preserved. A separate `.venv`
was prepared for this checkout using the already installed verified CPU base plus
the existing pinned optional CUDA dependencies. Pinned base validation and pip
check passed. No driver, clock, power setting or host CUDA installation changed.

## Actual owner-PC execution

The host reports NVIDIA GeForce RTX 5080, 16,303 MiB VRAM, driver 580.178.04.
Python 3.12.3, OpenCV 4.13.0, NumPy 2.5.4, ONNX Runtime GPU 1.31.1; the same
hash-bound YOLOX-S FP32 model is used on both backends, with TF32 disabled.

An initial sequential 12-frame generated-JPEG live check measured median forward
plus detection decode/NMS at **157.645 ms CPU / 8.715 ms CUDA**. Startup warm-up
was excluded. CUDA-only startup profiling reported 203 CUDA nodes; decoded
outputs agreed within the harness's declared tolerance. All generated frames had
zero detections, so this is runtime/timing evidence only, not object accuracy.

The new recording worker also completed real CPU and GPU analysis of a generated
100-frame WebM, sampled every five frames. Observed full-job times were about
**3.332 s CPU / 1.026 s GPU**, including preparation/startup/coverage validation.
These short runs occurred while software checks also used the host; they are
functional examples, not a general speedup or stable performance benchmark.
Source bytes remained unchanged and GPU results contained CUDA-only startup proof.

The actual browser OEM flow then copied a generated video, analyzed it through
the pinned CUDA backend, opened the source-matched review after removal of the
fixture original, and verified the receipt's CUDA node proof. Nothing was sent
to Events automatically. CPU-only runtime fallback is checked separately.

## Failure behavior and resource bounds

Only a GPU model-load/dependency failure or 30-second startup deadline triggers
one fresh CPU worker from the original private snapshot. Both attempts share the
five-minute wall limit. A failure during GPU recording inference remains visible
and does not silently replay on CPU. GPU failures disable subsequent GPU attempts
until service restart. Cancellation kills/reaps the GPU worker before releasing
the shared slot; no output from a cancelled attempt is accepted.

CPU hard memory policies stay unchanged. Linux GPU workers use the existing
finite 128 TiB virtual-address ceiling and a parent-owned 50 ms RSS watchdog:
3 GiB live, 4 GiB recorded. This is sampled enforcement with possible transient
overshoot, not a hard resident allocation cap. Windows retains corresponding
Job Object limits. The 1 GiB CUDA arena is not a total VRAM quota.

Tests cover preference versus actual execution, shared live/recorded contention,
explicit CPU overrides, fresh CPU fallback, mid-inference failure, wrong runtime,
missing CUDA-only proof, source binding, cancellation and retained-job metadata.
Exact source hashes and final software checks are recorded in [summary.json](summary.json).
The full run passed 486 Python tests; 59 final targeted checks include the new
GPU cancellation/reaping case. Frontend checks passed 357 with one existing skip,
12 UI browser cases and one real-CUDA OEM-copy browser case passed, and the build,
four Sites checks, documentation and launcher syntax passed. Local logs and generated media remain under ignored `qa-local/`.

Physical-camera, OEM endurance, Windows GPU execution, representative detection/
tracking accuracy, decode acceleration and 100-camera capacity remain unqualified.
The pinned inference, journal, supervision, scheduler and profiling files remain
byte-identical to the source before this follow-up.
