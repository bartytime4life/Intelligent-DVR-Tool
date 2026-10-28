# Native execution and runtime repair: October 28, 2026

[Verification index](../README.md) · [Product status](../../product-status.md)

These measurements ran in an isolated Linux cloud runner with Python 3.12.14.
They do not describe the owner's PC. Application code was the merged #13 revision
`c9fb19a82a56de04f77b194cf62ed51992674816`; the runtime pin was corrected locally.
[Source hashes and package versions](summary.json) identify the tested files.

## Actual execution

| Check | Observed result | Scope |
| --- | --- | --- |
| Full Python suite | **77 passed, zero failures/skips** | Includes native synthetic integration; [original log](python-tests-verified-runtime.log) |
| Exact pretrained YOLOX-S artifact | Three contract probes passed | Black, gray and seeded-noise inputs; [raw report](yolox-s-contract.json) |
| Synthetic recording through the actual pretrained model | 20/20 analyzed frames, completed receipt, zero emitted observations | Generated pixels, not representative footage; [receipt](yolox-s-recording.json) |
| Recording inference/postprocessing | Median **503.09 ms**, p95 **524.86 ms** per analyzed frame | One OpenCV CPU thread; no warmup frames excluded; excludes video decode, preprocessing and capture/network delay |
| Whole recording command | **10.1672 seconds** wall time | Includes interpreter/model setup, video I/O and output; [run context](recording-run.json) |

Zero observations on synthetic pixels is not an accuracy result. The three
probes are not a sustained throughput benchmark. There is no valid cameras-per-CPU
or cameras-per-GPU extrapolation from these measurements.

The model is the pinned 35,858,002-byte OpenCV Zoo artifact, SHA-256
`c5c2d13e59ae883e6af3b45daea64af4833a4951c92d116ec270d9ddbe998063`.
Its bytes matched [the candidate record](../../../edge/candidates/opencv-zoo-yolox-s-2022nov.json).
No weights or recording bytes are committed. All recording inputs were generated
locally: 320×240 MJPG, 5 FPS, 20 frames; five black, five gray-127 and ten seeded
noise frames from NumPy seed 20261028. The 4-second source duration does not imply
that processing kept pace with that source.

## What was repaired

The old qualification file pinned `opencv-python-headless==4.14.0`. The configured
package index had no matching distribution; the package release includes a build
suffix. An attempted `4.14.0.94` installation then failed native import with SIGBUS
(exit -7); its installed native binary did not match its RECORD checksum.
The underlying cause was not established. This is a local installation observation,
not evidence that the upstream release is generally defective.

The isolated `4.13.0.92` installation matched its installed RECORD hash and
imported successfully. Its native binary SHA-256 is recorded in [summary.json](summary.json).
The corrected [requirements file](../../../edge/requirements-qualification.txt)
pins all six installed distributions; [runtime-freeze.txt](runtime-freeze.txt)
records their actual versions. CI now installs that same qualification file.
The earlier [aborted test log](python-tests.log) and
[native-import failure](cv2-import-failure.log) remain separate from the successful
run; they are not counted as passes.

## Reproduce

Create a separate Python 3.12 environment, then install:

```bash
python -m pip install -r edge/requirements-qualification.txt
python -m unittest discover -s tests -p 'test_*.py'
```

After deliberately obtaining the candidate's exact model and checking its hash,
the bounded Linux probe can be repeated with a **new** output path:

```bash
python -m edge.qualify --model /private/dvr/yolox-s.onnx \
  --labels edge/labels/coco80.json --profile opencv-zoo-yolox-s-2022nov \
  --threads 1 --timeout-seconds 45 --memory-mib 2048 \
  --output /private/dvr/new-contract-report.json
```

The optional synthetic recording is constructed using
`cv2.VideoWriter_fourcc(*'MJPG')` and `numpy.random.default_rng(20261028)` with the
frame sequence above. Analyze it with the same model/profile/labels,
`edge/rules.example.json`, `--stride 1 --max-frames 21 --threads 1` and a new
receipt path. This is a reproducible plumbing/CPU probe, not labeled recognition.

## Remaining measurement gates

The COCO annotation endpoint returned HTTP 503 to this runner on HEAD and GET;
no labeled dataset was obtained. That observation does not establish a global
service outage. No precision/recall result is claimed. Connected file searches
also did not locate the separately reported PC worktree or approved recordings.

Representative, independently labeled recordings and intended-host measurements
are still required. Use the [offline checklist](../../offline-qualification.md)
to collect that source/evidence and define the workload. Then measure staged
1/5/25/50/100+ concurrent sources with per-source cadence, delay, drops, resources,
recording continuity and recovery. Live operation, detection accuracy and
100-camera operating capacity remain unqualified.
