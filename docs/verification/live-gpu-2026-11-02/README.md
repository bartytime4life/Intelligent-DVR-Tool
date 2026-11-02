# Live GPU first step — November 2, 2026

Base: [PR #75, `041b22277de0077b42c154e3e69a70d1387b6b55`](https://github.com/bartytime4life/Intelligent-DVR-Tool/commit/041b22277de0077b42c154e3e69a70d1387b6b55).
Candidate sources are bound by [source hashes](source-hashes.json); the
[current generated-input receipt](snapshot-policy-smoke.json) separately binds all executed
backend, worker, profile and tracker sources.

## Actual local measurements

Linux x86-64 on an AMD Ryzen 9 9950X, Python 3.12.3, OpenCV 4.13.0,
NumPy 2.5.4. Pinned YOLOX-S FP32, two CPU threads, one worker, 12 deterministic
320×240 generated JPEGs, fixed seed 20261102, preprocessing to 640×640.
The worker's startup warm-up is excluded. No physical camera or private footage
was accessed.

| Actual run | Result |
| --- | --- |
| CPU forward plus detection decode/NMS | Median 166.195 ms; p95 179.93 ms; 12 frames |
| Complete worker processing | Median 167.585 ms; p95 181.76 ms |
| Parent pipe round trip | Median 167.969 ms; p95 182.159 ms |
| CUDA attempt | Unavailable: `RUNTIME_UNAVAILABLE`; fresh CPU fallback started |
| One frame after real CPU fallback | Successful result; 176.11 ms inference/decode |
| CPU versus actual GPU agreement/speed | Not measured; no GPU execution occurred |

ONNX Runtime was absent from the available native environment. The installed
NVIDIA utility could not communicate with a driver in this restricted execution
session. These observations do not diagnose the owner's host driver or establish
that a GPU is absent. No drivers, CUDA libraries or existing environments were
changed. The measurement harness never treats a CPU fallback as a GPU timing.

All 12 generated frames produced zero detections. These are real pinned-model
execution/timing and fallback checks, not detector accuracy or representative
tracking tests. Repeat the command in [the operator guide](../../live-gpu.md) on
authorized GPU hardware, then use labeled representative recordings for quality.

## Deterministic tests

- [Python log](python-tests.log): **185 run, 176 passed, nine socket-dependent skips**.
  Live selection/recovery, native fixture worker, unchanged tracking, strict
  existing CUDA backend proof, installation forwarding/packaging, local service,
  retained-result recovery, media coverage and import tests.
- [JavaScript log](javascript-tests.log): **seven passed**, including actual
  backend/fallback labels and existing start/frame/error/review contracts.
- Linux launcher shell syntax, Windows PowerShell launcher parsing on Linux,
  and LiveDetection JSX transformation passed.
- The full GitHub Linux run caught the new guide's missing Wiki registration.
  The canonical guide index, Wiki page mapping/sidebar and seven affected
  generated mirrors were corrected. [Seven additional Wiki tests](wiki-tests.log), exact Wiki
  regeneration checks and the documentation validator then passed locally.
- Model hash/profile refusal, private verified snapshot loading, wrong runtime/
  provider/version, missing or invalid CUDA execution proof, GPU-slot limits,
  GPU startup timeout, late output isolation, mid-session GPU failure, explicit
  CPU restart, cancellation and resident-limit/read-failure termination are
  covered by deterministic simulated tests.
- A real constant-output OpenCV fixture is routed through a deliberately mocked
  CUDA adapter to compare boxes, scores, track IDs and rule observations exactly.
  This verifies shared pipeline semantics, **not numerical CUDA parity**.

The existing inference, journal, supervision, scheduler, profiling and tracker
files match their base Git blob hashes exactly. None was changed.

## Environment limits and remaining acceptance

This session denies socket creation with EPERM, so actual HTTP/browser checks
could not run. The full frontend build was attempted but the existing dependency
cache lacks the current polygon-clipping dependency; there is no shell network
access to install it. These are local verification limits, not passing checks.
GitHub's normal Linux/Windows installation, full test/build, HTTP and browser
workflows must run on the review commit.

Not established here: clean optional GPU installation, actual Windows or Linux
live CUDA execution under the new memory policy, actual GPU numerical parity,
GPU latency/throughput/VRAM peaks, representative physical cameras, tracking
accuracy, sustained multi-camera deployment or 100-camera capacity. Previous
offline GPU qualification remains historical evidence for its own sources.

Linux GPU memory enforcement intentionally differs from CPU isolation: a finite
128 TiB VA ceiling plus a parent 50 ms/3 GiB RSS watchdog, with possible transient
overshoot. Windows retains the existing hard 3 GiB Job Object committed-memory
cap. The 1 GiB CUDA arena option is not a total device-memory quota. See the full
[resource contract](../../live-gpu.md#resource-policy-and-limits) before enabling.

## Review follow-up: model snapshot file quota

The review identified that the reused Linux 34 MiB per-file hard limit was smaller
than the supported 35,858,002-byte YOLOX-S snapshot. GPU workers now select a
bounded 40 MiB hard limit before lowering it; ordinary CPU/recording workers
retain 34 MiB. A native Linux child regression writes the catalog artifact's
exact byte count, reaches the production verified-snapshot loader using a stub
runtime, and confirms that a file above 40 MiB still fails. This is a real OS/file
quota check, not CUDA execution.

[All 18 GPU-contract tests](snapshot-tests.log) passed. A fresh
[112-case compatibility run](snapshot-compatibility.log) passed 105 and skipped
seven socket-dependent cases, covering live workers, the common recording
worker policy, PC setup, service routes and person-enrollment workers. The
current smoke receipt includes analysis_worker.py in its source hashes.
The [initial smoke receipt](generated-smoke.json) remains historical to its
recorded source hashes; use snapshot-policy-smoke.json for the latest policy.
