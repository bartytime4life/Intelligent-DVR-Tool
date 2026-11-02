# Optional GPU detection in Monitor

CPU remains the default. This first live GPU option prefers NVIDIA CUDA on
Windows/Linux x86-64 and only for the exact pinned OpenCV Zoo YOLOX-S FP32 model.
It reuses the existing ONNX Runtime CUDA execution checks; it does not add a new
model, identity method, GPU video decoder or camera source.

[Live AI guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Live-AI-and-tracking) · [PC setup](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/PC-testing) ·
[November 2 verification](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/live-gpu-2026-11-02/README.md)

## Prepare the runtime separately

The normal Install/Check/Start CPU path remains dependable and does not install
GPU packages. Make a separate test copy of the app and back up private settings,
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

## Explicit service preference

Start the test app with analysis configured and add the optional preference:

Linux:

```bash
bash scripts/run-linux.sh --analysis --live-backend cuda-preferred
```

Windows PowerShell:

```powershell
.\scripts\Start-IntelligentDvr.ps1 -Analysis -LiveBackend cuda-preferred
```

The lower-level service accepts --live-backend cuda-preferred with its existing
--recordings and --config arguments. Use the same port/origin as the test copy
normally uses to retain browser work. Starting the service starts no cameras or
inference; **Start AI** on a connected camera is still required.

The tile reports its actual runtime: GPU · CUDA, CPU · OpenCV, or a specific CPU
fallback reason. Merely selecting cuda-preferred is not GPU execution proof.

## Selection and recovery

- CPU preference: no ONNX Runtime import or GPU initialization.
- CUDA preference: unsupported OS/model or a busy GPU slot selects CPU with an
  explicit reason. At most one GPU worker and two total live sessions.
- The CUDA child verifies the catalog hash and pinned profile, parses a private
  verified model snapshot, checks runtime version/provider/tensor contract/options,
  and proves CUDA-only node execution with a synthetic startup probe. FP32 is
  retained and TF32 is disabled. Compiled provider availability alone is not
  hardware support.
- GPU load failure, missing libraries/provider/device, worker exit or startup
  deadline: kill/reap the GPU worker, then try a fresh bounded CPU worker once.
  Each attempt has the existing 30-second start deadline (60 seconds total).
  No camera frame is sent before readiness.
- A running GPU error, crash, memory guard kill or six-second frame deadline ends
  the session visibly. The next explicit Start AI uses CPU until service restart.
  No frame is retried silently and no tracker resets inside a live session.
- Stop, page lease, session expiry and service shutdown still kill the worker.
  Ordinary Stop/lease/session expiry do not disable a healthy accelerator.

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
3 GiB**; inability to read the child's memory kills it. This is sampled enforcement,
not the CPU path's hard allocation cap: brief resident-memory peaks can exceed
3 GiB before termination. On Windows the existing 3 GiB Job Object committed-memory
limit remains. CUDA under that Windows limit is not yet qualified.

The reused 1 GiB CUDA arena limit is **not a total VRAM quota**. Driver/context
and other allocations can exceed it, as the
[provider documentation](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html#gpu_mem_limit)
explains. One GPU worker avoids multiplying GPU contexts in this first step.
No GPU utilization, whole-device VRAM, power or thermal limit is enforced here.

All other live limits remain: two cameras total, one frame in flight per camera,
at most five frames/s from the browser, 1 MiB/1080p inputs, 15-minute sessions,
15-second lease and six-second frame deadline. Tracking and rule semantics,
camera authorization, same-origin token checks and local-only processing remain.

No physical-camera acceptance, cross-platform GPU qualification, representative
tracking accuracy, GPU speedup or 100-camera capacity follows from these changes.

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/live-gpu.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
