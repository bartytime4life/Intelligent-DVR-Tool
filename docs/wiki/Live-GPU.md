# GPU-first local analysis

The local service prefers NVIDIA CUDA by default for live AI and saved-video
analysis, including copied OEM videos and LAN-recorder segments. CPU is an
automatic, visibly labeled fallback. CUDA supports Windows/Linux x86-64 and only
the exact pinned OpenCV Zoo YOLOX-S FP32 model.
It reuses the existing ONNX Runtime CUDA execution checks; it does not add a new
model, identity method, GPU video decoder or camera source.

[Live AI guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Live-AI-and-tracking) · [PC setup](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/PC-testing) ·
[November 2 verification](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/live-gpu-2026-11-02/README.md)

## Prepare the runtime separately

The normal installer prepares the verified CPU base and does not install GPU
packages. GPU-first preference alone does not prove GPU execution: without a
prepared CUDA runtime, the first selected job/session reports CPU fallback. Make a separate test copy of the app and back up private settings,
catalogs and recordings before changing its isolated Python environment. Do not
install CPU and GPU ONNX Runtime packages into the same environment.

After the normal CPU installation, the optional version-pinned development
requirements can be installed **in the test copy's .venv**:

Linux:

```bash
.venv/bin/python -m pip install --only-binary=:all: -r edge/requirements-live-cuda.txt
.venv/bin/python -m pip check
```

Windows PowerShell:

```powershell
.venv\Scripts\python.exe -m pip install --only-binary=:all: -r edge/requirements-live-cuda.txt
.venv\Scripts\python.exe -m pip check
```

Both need a working NVIDIA driver compatible with the installed CUDA runtime.
The Linux library pins reuse the existing isolated qualification candidate.
Windows additionally needs compatible CUDA/cuDNN DLLs and the Visual C++ runtime.
The app does not install drivers or change host configuration. ONNX Runtime's
[CUDA requirements and DLL loading](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html)
and [platform install prerequisites](https://onnxruntime.ai/docs/install/) are
authoritative; do not infer runtime compatibility from an NVIDIA card name or
the CUDA version displayed by nvidia-smi. The optional requirements are version
pins, not a hash-locked or clean-install-qualified GPU package set. Windows GPU
installation/execution and this new Linux live GPU policy still require actual
target-machine acceptance.

## Check before connecting a camera

With an existing authorized pinned model, run the reproducible generated-input
check in the same environment that will launch the service:

```bash
python -m edge.live_benchmark --model /path/to/yolox-s.onnx --frames 12 --output live-backend-smoke.json
```

Use .venv/bin/python on Linux or .venv\Scripts\python.exe on Windows in place
of python. Supply the Windows model path normally. No model download, camera,
network feed or footage access occurs. The receipt records exact input hashes,
model/labels/source hashes, runtime versions, per-worker timings, a CPU fallback
check, and decoded-detection agreement **only if both actual backends execute**.
The inference timing includes forward plus detection decode/NMS. Startup warm-up
is excluded and recorded separately. GPU memory/driver inventory and raw tensor
parity are not measured by this smoke command.

The 12 generated pictures contain no labeled objects. Matching empty detections
checks plumbing only. Follow up with approved representative fixed recordings
and held-out labels, using the existing offline CUDA qualification/evaluation
workflow, before relying on object or track quality. Treat a failed agreement
check as a blocker to promotion, regardless of a favorable speed ratio.

## Default preference and CPU override

Ordinary analysis launches now prefer CUDA for both workloads. These explicit
options are equivalent to the defaults:

Linux:

```bash
bash scripts/run-linux.sh --analysis --live-backend cuda-preferred
```

Windows PowerShell:

```powershell
.\scripts\Start-IntelligentDvr.ps1 -Analysis -LiveBackend cuda-preferred
```

The lower-level service also accepts `--analysis-backend cuda-preferred` for
recorded-video jobs with its existing `--recordings` and `--config` arguments.
For CPU-only operation, use `--analysis-backend opencv-cpu` and/or
`--live-backend opencv-cpu` (PowerShell `-AnalysisBackend opencv-cpu` and
`-LiveBackend opencv-cpu`). Mac recordings accept `--analysis-backend opencv-cpu`;
unsupported platforms/models select CPU automatically. Use the same port/origin as the test copy
normally uses to retain browser work. Starting the service starts no cameras or
inference; **Start AI** on a connected camera is still required.

The tile reports its actual runtime: GPU · CUDA, CPU · OpenCV, or a specific CPU
fallback reason. Merely selecting cuda-preferred is not GPU execution proof.

## Selection and recovery

- CPU preference: no ONNX Runtime import or GPU initialization.
- CUDA preference: unsupported OS/model or a busy GPU slot selects CPU with an
  explicit reason. One shared GPU slot covers live AI and recorded analysis
  within this service. There are still at most two total live sessions. Other
  processes, such as OEM software, are outside this slot policy.
- The CUDA child verifies the catalog hash and pinned profile, parses a private
  verified model snapshot, checks runtime version/provider/tensor contract/options,
  and proves CUDA-only node execution with a synthetic startup probe. FP32 is
  retained and TF32 is disabled. Compiled provider availability alone is not
  hardware support.
- Live GPU load failure, missing libraries/provider/device, worker exit or startup
  deadline: kill/reap the GPU worker, then try a fresh bounded CPU worker once.
  Each attempt has the existing 30-second start deadline (60 seconds total).
  No camera frame is sent before readiness.
- A running live GPU error, crash, memory guard kill or six-second frame deadline ends
  the session visibly. The next explicit Start AI uses CPU until service restart.
  No frame is retried silently and no tracker resets inside a live session.
- Stop, page lease, session expiry and service shutdown still kill the worker.
  Ordinary Stop/lease/session expiry do not disable a healthy accelerator.

Recorded jobs use the same hash-bound detector, rule engine, source validation
and review format on both backends. The job/status and completed review report the
actual backend. A GPU model-load/dependency failure or 30-second GPU startup
deadline launches one fresh CPU worker from the original private recording
snapshot, under the same total five-minute job budget. A GPU failure during
recording inference remains a failed job; it is not silently replayed or mixed
with CPU output. A GPU failure disables further GPU attempts until service
restart. Restarting the service itself never starts cameras or analysis.

## Resource policy and limits

CPU workers retain the existing Linux 3 GiB hard address-space limit and Windows
Job Object committed-memory cap. GPU workers keep the two-thread, file/core,
CPU-time, frame-size and parent deadline/session bounds.

The Linux GPU per-file write limit is 40 MiB so the verified 35,858,002-byte model
snapshot fits. CPU workers retain their existing 34 MiB limit. A native Linux
subprocess regression writes the catalog artifact's exact byte count under the
real GPU policy, reaches the snapshot loader, and verifies that larger files
still fail. The runtime in this regression is a stub, not CUDA execution.

CUDA needs a large virtual address range. On Linux its worker instead has a
finite 128 TiB address-space ceiling and a **parent-owned 50 ms RSS watchdog at
3 GiB** for live AI (4 GiB for recorded-video workers); inability to read the child's memory kills it. This is sampled enforcement,
not the CPU path's hard allocation cap: brief resident-memory peaks can exceed
3 GiB before termination. On Windows the existing Job Object committed-memory limit remains: 3 GiB live,
4 GiB recorded. CUDA under that Windows limit is not yet qualified.

The reused 1 GiB CUDA arena limit is **not a total VRAM quota**. Driver/context
and other allocations can exceed it, as the
[provider documentation](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html#gpu_mem_limit)
explains. One GPU worker avoids multiplying GPU contexts in this first step.
No GPU utilization, whole-device VRAM, power or thermal limit is enforced here.

All other live limits remain: two cameras total, one frame in flight per camera,
at most five frames/s from the browser, 1 MiB/1080p inputs, 15-minute sessions,
15-second lease and six-second frame deadline. Tracking and rule semantics,
camera authorization, same-origin token checks and local-only processing remain.

See the [GPU-default verification](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/gpu-default-2026-11-03/README.md)
for revision-bound owner-PC software measurements. No physical-camera acceptance,
cross-platform GPU qualification, representative tracking accuracy or 100-camera
capacity follows from a short controlled run.

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/live-gpu.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
