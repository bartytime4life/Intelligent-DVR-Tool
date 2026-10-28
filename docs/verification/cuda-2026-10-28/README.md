# Optional CUDA analyzer qualification — October 28, 2026

The analyzer now has an explicit `--backend onnxruntime-cuda` option for the
hash-bound YOLOX-S profile. **OpenCV CPU remains the default.** The new route
passed a 100-frame comparison on the owner PC. A two-minute experiment kept
30 public sources active; 50/100-stream local replay exposed queue replacement
under load. **This does not qualify 100 physical cameras or sustained operation.**

This record extends the frozen [earlier owner-PC report](../host-2026-10-28/README.md).
Its source base is merged PR #15, commit
`ab148d94ad4b9b38470f37f9be02dfe532d2102d`, plus the implementation identified by
[source hashes](source-bindings.json). [Numeric results](results.json) retain
unrounded measurements and accounting. The accompanying PR identifies the
published head; the base alone is not the tested implementation.

## Implementation and scope

Existing responsibilities determine placement: `edge/inference.py` owns runtime
selection, `edge/analyze.py` owns the offline command, `tests/` owns contracts,
`edge/README.md` owns operator commands, and this existing verification root owns
dated evidence. No new service, public API, schema home or live-ingest product
was introduced. Load harnesses are private experiments using the production
backend, preprocessing, decoder and bounded scheduler; they are not a shipped
recording service.

The optional [pinned environment](../../../edge/requirements-gpu-qualification.txt)
uses ONNX Runtime GPU 1.31.1 and environment-local NVIDIA libraries. The helper
imports no GPU runtime on the CPU path. CUDA requires the exact model hash,
COCO80 ordering, FP32 input/output shapes, retained provider settings, TF32 off,
and disabled CPU graph/runtime fallback. Missing dependencies, incompatible
providers/settings and execution failures fail the command. A separate actual
CPU-environment invocation failed with the expected missing-runtime diagnostic,
exit 1 and no receipt.

Startup runs one synthetic zero-input probe and checks its ONNX Runtime profile
for CUDA-only node execution. Each measured CUDA job recorded 203 CUDA node
events and no CPU node events. The temporary private profile is removed; a
hash, counts and limited scope remain in receipt/trace `runtime` metadata.
This is startup execution evidence, not per-frame profiling or accuracy proof.
The 1 GiB CUDA arena setting is not a hard limit on all device allocations.

Receipts retain `intelligent-dvr.receipt.v1`, with additive runtime metadata.
Event generation, confidence, rules, preprocessing, NMS, CPU requirements and
browser backend controls are unchanged. No driver installation or host tuning
was performed. The rejected crop/lower-confidence candidates remain disabled.

## Environment and checks

Linux x86_64, Python 3.12.3, Ryzen 9 9950X, RTX 5080 (16,303 MiB reported),
driver 580.178.04; OS usable RAM approximately 121.21 GiB. Other applications
were running. This is one host, not a result for other GPUs or Windows CUDA.
OpenCV 4.13.0.92, NumPy 2.5.4, ONNX 1.23.2; the complete optional runtime pins
are linked above. Model SHA-256:
`c5c2d13e59ae883e6af3b45daea64af4833a4951c92d116ec270d9ddbe998063`.

| Local check | Passed | Skipped | Scope |
| --- | ---: | ---: | --- |
| Python, CPU-only environment | 86 | 0 | Includes native CPU integration and fake-runtime CUDA contracts |
| Python, separate GPU environment | 86 | 0 | Same suite; actual GPU execution is measured separately below |
| Frontend unit tests | 46 | 0 | Existing receipt/domain/facility/resource behavior |

The Python and native clip comparisons ran with IPv4/IPv6 sockets denied in
the process and descendants. Contract tests cover lazy imports, missing/wrong
runtime, unavailable providers, fallback prevention, settings/shapes, startup
proof, temporary cleanup and execution failures. They do not emulate hardware
qualification. These local counts are distinct from hosted CI on the PR head.
Private log hashes are retained in `source-bindings.json`.

## Actual analyzer comparison

Both backends ran the real `edge.analyze` command on the same saved MEVA vehicle
and person-entry clips, exact weights/labels/rules and four CPU threads. The
vehicle clip sampled 40 frames (stride 15); the person clip sampled 60 (stride 5).
All 100 sampled frames had matching detection counts and labels. Minimum box
IoU was **0.99999569**, against a preselected 0.99 floor; maximum score difference
was **0.000003645**, against a 0.001 ceiling. Event records were exactly equal:
zero vehicle events and one pending person class-presence event.

| Clip | CPU p50 / p95 ms | CUDA p50 / p95 ms |
| --- | ---: | ---: |
| Vehicle | 96.76 / 108.60 | 9.21 / 10.12 |
| Person | 97.74 / 105.17 | 8.74 / 9.18 |

These timings cover inference plus postprocessing, excluding video decode,
input preparation, startup probe and receipt writing. Complete command wall
times were 5.07/2.27 seconds for vehicle CPU/CUDA and 7.28/2.57 seconds for person.
Clip hashes and execution-profile hashes are in `results.json`. The original
source/license records are in the earlier report. Their partial activity/person
labels and unresolved timestamp alignment do not establish exhaustive detection
or event accuracy. This is implementation agreement, separate from the earlier
300-image COCO benchmark.

## Load experiments

One shared GPU worker used the new production backend with four CPU threads,
fixed preprocessing/decoder, and the existing newest-pending-per-camera scheduler.
Each independent video decoder used one FFmpeg thread. Offered sampling was at
most two frames/second per stream, quantized to source frames. Pending payloads
were bounded to 64 MiB total, 2 MiB/sample and two seconds of age. The experiment
stopped below 2 GiB host available memory or above 3 GiB sampled worker RSS;
these sampled guards are not hard OS memory quotas.

The live case used 30 distinct official Iowa traffic sources for 120 measured
seconds after startup. These are low-resolution traffic streams, commonly
480×270, 768×432 or 800×450, mostly 15 fps; not 30 full-HD streams. Sources,
attribution and rights boundaries remain in the
[earlier source register](../host-2026-10-28/README.md#public-media-pilot-and-label-limits).
The parent acquired public video; its GPU worker had network access denied.

For 50/100 replay, both parent and worker had network access denied. Thirty
previously saved public recordings were hash/size verified, then cycled across
50 or 100 independent decoders. Clips looped with monotonic rebased timestamps
and source-clock pacing. These were 30-second virtual-stream experiments,
not 50/100 distinct live cameras and not a sustained soak.

| Workload | Active | Decoded frames | Offered | Completed | Results/s | Replaced | Expired | Pending at stop |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Live, 120 s | 30/30 | 55,923 | 6,751 | 6,615 | 55.12 | 104 | 21 | 11 |
| Replay, 30 s | 50/50 | 23,369 | 2,846 | 2,413 | 80.42 | 392 | 0 | 41 |
| Replay, 30 s | 100/100 | 46,666 | 5,691 | 2,185 | 72.81 | 3,417 | 0 | 89 |

Every row has zero budget drops, no reported source/experiment errors and worker
exit 0. Accounting is `offered = completed + replaced + expired + budget drops +
pending`. Replacements discard older pending samples deliberately; they are
not completed work. Pending work was not drained into these measured totals.

| Workload | Inference p50 / p95 ms | Local completion-age p95 ms | Sampled combined RSS peak GiB | Host available minimum GiB |
| --- | ---: | ---: | ---: | ---: |
| Live 30 | 9.39 / 10.74 | 341.71 | 1.54 | 6.24 |
| Replay 50 | 9.35 / 10.95 | 524.37 | 1.51 | 5.24 |
| Replay 100 | 10.56 / 11.93 | 523.49 | 1.81 | 5.47 |

Completion age begins at locally paced decode and excludes camera/provider/HLS
delay. It is not end-to-end camera latency. RSS combines the experiment parent
and worker, not total host memory or VRAM. Aggregate throughput includes decode,
copies, IPC, preprocessing, scheduling and postprocessing; inference timing alone
does not describe pipeline capacity. Completed samples per stream ranged
184–225 live, 37–56 at 50 replay, and 18–28 at 100 replay.

The live run retained 884 new fragments (77,578,192 bytes), all verified against
recorded size/SHA-256. It reported zero HLS sequence gaps. This does not prove
gap-free wall-clock coverage, full decode of every saved fragment, crash recovery
or a production recorder. Replay reused saved bytes and created no new video.

The 100-stream run offered about 189.65 samples/s and completed 72.81/s. Decode
continued, but one shared inference worker did not maintain the offered cadence.
The lower aggregate completion rate at 100 than 50 streams is observed; these
runs do not isolate a single cause. No 100-camera operating claim is made.

## Reproduction, preservation and next acceptance

Use the [operator commands](../../../edge/README.md#optional-explicit-cuda-backend)
in a separate environment, with approved local input, exact hashes and new
output paths. Compare CPU/CUDA traces before changing model, runtime, precision,
rules or preprocessing. Run `python -m unittest discover -s tests -p 'test_*.py'`,
`npm test`, `python3 scripts/check-docs.py` and
`python3 scripts/build-wiki.py --check`. The private load harnesses are retained
on the owner PC and identified by hash; public numeric receipts support audit,
not independent reproduction without those harnesses and source bytes.

Recordings, downloaded images, weights, detailed traces, raw profiles and source
URLs remain on the owner PC. Only source code, methods and sanitized numeric
records are proposed for GitHub. The original dirty checkout was preserved;
implementation used a separate clone based on merged PR #15.

Next acceptance requires representative fully aligned video labels, per-camera
delivered cadence, longer soak/recovery tests and approved physical-camera ingest.
Shared batching or additional workers are candidates for a separate measured
change; these results do not authorize changing detection thresholds or buying
hardware. Rollback selects `--backend opencv-cpu` or reverts this isolated change.
The original CPU environment remains available. Merge/release and native Wiki
publication are separate from this local implementation and its draft PR.

Runtime references: [official CUDA provider documentation](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html)
and [pinned 1.31.1 session implementation](https://github.com/microsoft/onnxruntime/blob/v1.31.1/onnxruntime/python/onnxruntime_inference_collection.py).
