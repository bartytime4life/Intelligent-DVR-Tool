# Bounded local worker qualification — October 28, 2026

Four independent CUDA sessions improved the matched 100-stream offline replay
from **89.60 to 187.33 completed analyses/second** in the final matched repeat.
They preserved CPU-reference
agreement on 100 fixed frames. The new `edge.workers.LocalWorkers` adapter
provides bounded execution and explicit failure outcomes; **100-camera operating
capacity remains unqualified**. The sampling cadence is experimental, not a new
accepted owner workload or analyzer default.

Base: merged PR #16, commit `e0a0a12e68613b16dd9df68153bd0f95f5e88437`.
[Numeric results](results.json) and [source bindings](source-bindings.json)
identify the tested implementation and private experiment hashes. Placement
follows existing responsibilities: runtime adapters under `edge/`, contracts
under `tests/`, and dated evidence under `docs/verification/`. This is a local
component; no ingest API, recording daemon or new schema/policy home was added.
The [previous CUDA report](../cuda-2026-10-28/README.md) remains frozen.

## Behavior and checks

The adapter exclusively dispatches/completes scheduler tokens, runs at most
one call per processor and preserves the scheduler's per-camera order, newest
pending sample, byte/age limits and fair routing. A processor exception stops
new dispatch, records failure and allows other active work to drain. Executor
admission failures account for all already dispatched tokens. There is no
fallback, retry, model substitution or hidden executor backlog. The caller owns
processor/model construction and cleanup. See the
[integration contract](../../performance-100-cameras.md#bounded-local-execution-adapter).

Six new contract tests use real threads and controlled barriers to check
bounded calls/payload accounting, ordered replacement/fairness, fail-stop and
drain behavior, partial executor-admission failure and invalid configurations.
The complete suite passed **92 tests, zero skipped in each CPU-only and GPU
environment**, with IPv4/IPv6 sockets denied. These are local checks; hosted CI
is recorded separately on the PR head. No frontend code was changed.

An actual four-worker run compared 100 saved person/vehicle frames against the
prior CPU traces: counts/labels matched, minimum IoU **0.99999569**, maximum score
difference **0.000003645**, within fixed 0.99/0.001 tolerances. Each of four
sessions retained CUDA-only startup proof (203 node events, no CPU node events),
FP32 with TF32 disabled and graph/runtime fallback disabled. This is detector
agreement, not exhaustive annotations, event-rule integration or field accuracy.

## Hardware and fixed-tensor trial

Same owner PC: Linux x86_64, Python 3.12.3, Ryzen 9 9950X, RTX 5080, driver
580.178.04, OpenCV 4.13.0.92, NumPy 2.5.4 and ONNX Runtime GPU 1.31.1.
The existing pinned CUDA environment was reused without modification.
The single-process replay also loaded the existing PyAV 19.0.2 wheel from its
separate Python 3.12 environment; no new package/driver installation occurred.
Other applications continued running.

The exact YOLOX-S weights, COCO80 ordering, preprocessing and decoder remain
unchanged. Model SHA-256:
`c5c2d13e59ae883e6af3b45daea64af4833a4951c92d116ec270d9ddbe998063`.
CPU remains the analyzer default; four sessions are an explicit candidate.

Before adapter integration, a private fixed-tensor trial ran the same 100
prepared frames three times per configuration. Each independent session used
four CPU threads and the pinned CUDA options. Aggregate throughput was
77.64 samples/s with one session, 178.82 with two, and 222.74 with four.
All 900 outputs met the CPU-reference count/label/box/score criteria. This
includes inference/postprocessing and result checks, but excludes video decode
and input preparation; it is not a camera-capacity benchmark. Higher individual
call latency can coexist with higher combined throughput.

## Matched full-pipeline replay

The private offline harness used the production scheduler, new execution
adapter, actual backend and actual preprocessing/output decoder. Thirty frozen
public Iowa recordings from the earlier experiment were verified against every
fragment's byte count/SHA-256, then cycled across 100 independent PyAV decoders.
No network access or live-camera activation occurred. Each decoder used one
FFmpeg thread, source-clock pacing and monotonic rebased PTS at loop boundaries.
Source resolutions/rates are retained privately; these are low-resolution
traffic clips, not 100 distinct physical/full-HD cameras. Source terms and
attribution remain in the [earlier report](../host-2026-10-28/README.md#public-media-pilot-and-label-limits).

Both configurations used one process and no frame IPC, four CPU threads per
native session, at most two offered samples/second per stream, one newest
pending sample per camera, 2 MiB/sample, 64 MiB retained-payload budget and
two-second dispatch-age limit. The process was network-denied, externally wall
time bounded, and sampled for a 4 GiB RSS ceiling / 2 GiB available-memory floor.
These are experiment guards, not hard quotas or product supervision.

| Phase | Workers | Measured window | Offered | Completed in window | Results/s | Replaced | Drained after stop | Pending |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Initial | 1 | 30 s | 5,688 | 2,397 | 79.90 | 3,205 | 1 | 85 |
| Initial | 4 | 30 s | 5,688 | 5,162 | 172.07 | 463 | 4 | 59 |
| Initial | 4 | 120 s | 22,504 | 22,472 | 187.27 | 4 | 4 | 24 |
| Final | 1 | 30 s | 5,688 | 2,688 | 89.60 | 2,909 | 1 | 90 |
| Final | 4 | 30 s | 5,688 | 5,620 | 187.33 | 7 | 4 | 57 |
| Final | 4 | 120 s | 22,502 | 22,369 | 186.41 | 107 | 4 | 22 |

All 100 decoders were active in each matched run, with no reported source or
experiment errors, no stale/budget/failed samples and zero in-flight work after
drain. Queue accounting includes after-stop drain separately; drain does not
inflate measured throughput. The final 30-second comparison delivered about
2.09× throughput; the initial comparison delivered 2.15×. Neither cleared every
offered sample. Initial trials preceded a narrow executor-admission outcome
fix; normal GPU execution was unchanged. Final runs repeated native parity and
all load windows on the final module hash, recorded before each invocation.
Both phases are retained instead of choosing the best measurement. These
sequential tests on a shared PC do not establish statistical confidence or
zero-loss operation: replacements varied from 4 to 107 in the two-minute runs.
Unlike the older separate-process experiment, each matched comparison
holds IPC architecture fixed; comparisons to the older 72.81/s result cannot
attribute the entire difference to concurrency alone.

| Final run | Sample processing p50 / p95 ms | Local completion-age p95 ms | Sampled process RSS peak GiB | Host available minimum GiB |
| --- | ---: | ---: | ---: | ---: |
| 1 worker, 30 s | 10.35 / 13.17 | 526.07 | 1.63 | 5.78 |
| 4 workers, 30 s | 18.71 / 27.48 | 399.54 | 1.88 | 5.57 |
| 4 workers, 120 s | 19.44 / 28.33 | 428.15 | 1.96 | 4.52 |

Sample-processing time includes preparation, inference and postprocessing.
Throughput also includes decode, scheduling, byte copies and collection.
Completion age begins at locally paced decode, excluding upstream camera/HLS
delay. RSS is process memory, not VRAM or total host use. The CUDA arena limit
is per session; aggregate device use, power and temperature are not qualified
by these RSS samples.

## Preservation, reproduction and open acceptance

Recordings, images, weights, detailed traces and source URLs remain on the owner
PC. The new implementation used a separate clone based on merged PR #16; the
original dirty checkout and earlier published results remain preserved.
The private harness/source hashes support local audit; numeric exports alone
are not an independently runnable replay fixture. Public result checks validate
accounting and boundaries, not hardware or source rights.

Reproduce component checks with `python -m unittest discover -s tests -p 'test_*.py'`,
`python3 scripts/check-docs.py` and `python3 scripts/build-wiki.py --check`.
Build an explicit local processor for each independent backend, submit approved
samples to the scheduler and consume every outcome returned by `step()` and
`close()`. Callers retain responsibility for source admission, per-camera rule
state, results and processor cleanup.

Thread execution cannot terminate a stuck native call. Supervised process
deadlines/restart, durable results, result-size budgets, full aligned video
labels, accepted per-camera cadence, longer soak/recovery and separately approved
physical-camera ingest remain open. The existing analyzer and its CPU default
are unchanged. Rollback removes the adapter integration or reverts this isolated
change; it requires no environment or host rollback. Merge/release and native
Wiki publication remain separate owner actions.
