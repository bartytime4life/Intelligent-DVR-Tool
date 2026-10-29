# Optional Linux process recovery — October 28, 2026

This change adds `edge.supervision.ProcessWorkers`, an opt-in Linux process
boundary for the bounded scheduler. It detects failed/stalled generations,
reports every unacknowledged sample as an explicit failure, reaps the owned
child before a budgeted replacement, and preserves newer pending samples.
It does not retry failed samples, replace the default CPU analyzer, start a
camera service or establish 100-camera operating capacity.

Base: merged PR #17, commit `1528fd9651a59b40804a7fe39f8a657a23707bce`.
Its tree matches the previously reviewed worker PR. The
[source bindings](source-bindings.json) identify the implementation, private
harnesses and logs; [numeric results](results.json) retain unrounded measurements.
Files follow existing `edge/`, `tests/` and `docs/verification/` responsibilities.
The earlier [thread-worker](../workers-2026-10-28/README.md) and
[CUDA](../cuda-2026-10-28/README.md) records remain frozen.

## Implemented behavior

One owned spawned child holds 1–4 independently constructed processors. Parent
dispatch/completion remains under `CameraScheduler`; processor callbacks run in
bounded child threads. There is at most one in-flight sample per camera and
one call per processor. Tokens, generations, slot identities, framed bytes/JSON
and finite values are validated. A late, duplicate, unknown-generation or
oversized response cannot acknowledge another sample. Factories alone use
trusted Python spawn serialization; sample/result data is never unpickled.

Startup/task deadlines are checked when the parent calls `step()`. The task
deadline includes transport and collection after dispatch. They are **polled
deadlines**, not an independent OS watchdog. Failure ends that generation;
every still-unacknowledged token becomes a terminal `ProcessFailure`, including
results that may have been computed but not received. Already accepted outcomes
remain available. An explicitly chosen lifetime restart budget is bounded to
0–3; default zero fails closed. An unreaped child blocks replacement.

`ProcessOutcome` retains the existing work/result/error fields and adds an
authoritative generation and successful processor slot. Local snapshots expose
generation-specific startup metadata and lifecycle events. `close()` stops
dispatch/restarts, drains for a bounded interval, then accounts for remaining
work and terminates its child. Consume its returned outcomes explicitly.
Termination waits are bounded and escalate to kill; uninterruptible OS tasks
can still exceed requested waits and remain visible. See the
[full integration contract](../../performance-100-cameras.md#optional-linux-process-supervision).

This is fault isolation, not a permission, network or memory sandbox. It adds
bounded IPC copies beyond scheduler-retained bytes; models, results, decoder
caches and caller-held outputs need separate budgets. No durable journal,
per-camera rule/dwell recovery, credential handling, host-control API or live
recording integration is added. Windows process supervision is explicitly
unsupported; the existing CPU/thread routes are preserved.

## Local software and native agreement

The complete suite passed **104 tests with zero skips in each CPU-only and GPU
environment**, with IPv4/IPv6 sockets denied. Twelve new tests include actual
spawned-process stalls/exits, bounded large-payload round trips, latest-pending
recovery, startup budget exhaustion, late-result rejection, invalid
framing/generations, encoded result limits, shutdown and kill escalation against
an owned child that ignored terminate. Windows skips the eleven Linux-only
process cases; unsupported-platform admission is tested separately. Local
counts are distinct from hosted CI on the published PR head.

Actual four-session CUDA inference through the final process boundary compared
all 100 saved person/vehicle frames with prior CPU traces. Counts/labels matched,
minimum IoU was 0.99999569 and maximum score difference was 0.000003645, within
fixed 0.99/0.001 tolerances. Generation/slot provenance was retained and the
child was reaped. Each session required CUDA-only synthetic startup execution
proof, FP32, TF32 disabled and no CPU graph/runtime fallback.

The initial agreement harness rejected full-HD payloads at the pilot's 2 MiB
sample bound. The final fixed-frame check explicitly used 32 MiB/sample with a
64 MiB total scheduler budget; the 100-stream low-resolution replay retained
2 MiB/sample. No model/profile or production bounds were weakened. These
comparisons establish implementation agreement, not exhaustive video labels,
event accuracy or field quality.

## Owner PC and offline replay method

Linux x86_64, Python 3.12.3, Ryzen 9 9950X, RTX 5080, driver 580.178.04,
OpenCV 4.13.0.92, NumPy 2.5.4, ONNX Runtime GPU 1.31.1 and the existing
environment-local NVIDIA libraries. The existing PyAV 19.0.2 wheel supplied
decoding. Environments/drivers were reused without modification. Other host
applications continued running. The model, COCO80 order, preprocessing,
decoder, confidence and rejected crop/threshold decisions remain unchanged.
Exact model SHA-256:
`c5c2d13e59ae883e6af3b45daea64af4833a4951c92d116ec270d9ddbe998063`.

The private parent replay used 100 independent decoders cycling 30 previously
saved public Iowa recordings. Every original fragment's bytes/hash were verified
before use. These are low-resolution traffic clips with source-clock pacing
and monotonic rebased PTS, not 100 independent physical/full-HD cameras or ten
minutes of newly captured footage. Source terms/attribution remain in the
[source register](../host-2026-10-28/README.md#public-media-pilot-and-label-limits).

One spawned child constructed four pinned CUDA sessions. Offered cadence was
at most two samples/second/stream, quantized to source frames. Scheduler limits:
one newest pending sample per camera, 2 MiB/sample, 64 MiB retained payloads and
two-second dispatch age. The native cases explicitly selected a two-second task
deadline, 30-second startup deadline, 0.25-second restart delay and either zero
or two lifetime restarts. These are experimental workload values, not accepted
production settings. Parent and descendants had IPv4/IPv6 denied externally;
the adapter itself installs no network filter.

The controlled case inserted a 60-second software sleep in generation 1 while
CUDA sessions were live, then an explicit process exit (86) in generation 2.
These are software fault injections, not a claim to reproduce every GPU/driver
failure. Only the process created by this adapter was signaled. Its replacement
had to initialize and pass fresh CUDA startup proof before dispatch. Private
fault markers and lifecycle events measure detection/restart intervals.

The runner sampled host-available memory and combined parent/child RSS, stopping
below 2 GiB available or above 4 GiB sampled combined RSS. An outer wall timeout
bounded each case. These are sampled experiment guards, not OS quotas. GPU
memory/utilization/temperature/power were queried read-only at five-second
intervals on a separate thread; those device-wide readings include other host
workloads and are not attributed solely to this worker.

## Measured results

<!-- RECOVERY_RESULTS_BEGIN -->
| Final case | Window | Offered | Completed in window | Results/s | Failed | Replaced | Successful drain | Pending |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | 30 s | 5,688 | 5,625 | 187.49 | 0 | 0 | 4 | 59 |
| Injected faults | 120 s | 22,513 | 21,985 | 183.20 | 8 | 479 | 4 | 37 |
| Injected faults + soak | 600 s | 112,398 | 110,835 | 184.72 | 8 | 1,488 | 4 | 63 |

All 100 virtual decoders were active in every final case. There were no reported
source/experiment errors, stale samples or budget drops, and no in-flight work
after drain. Fault cases each replaced two generations and explicitly failed
eight unacknowledged samples (four per generation). All owned children were
confirmed reaped before replacement and at shutdown. No failed sample was retried.

| Final fault case | Injection | Detection seconds | Replacement ready after detection seconds |
| --- | --- | ---: | ---: |
| 120 s | software-stall | 1.999 | 1.107 |
| 120 s | abrupt-exit | 0.061 | 1.123 |
| 600 s | software-stall | 2.000 | 1.163 |
| 600 s | abrupt-exit | 0.067 | 1.199 |

These intervals use same-host monotonic clocks and include restart delay,
process startup and fresh model/proof initialization. Stall detection is
measured from the private injection marker; its task deadline began slightly
earlier at dispatch. Sampled decoder counters advanced during both observed
backoff/startup groups in each fault case. In the ten-minute case they advanced
by 1,554 and 1,672 frames during the sampled non-running intervals. This is
decoder continuity evidence, not a recording gap/durability result.

| Final case | Successful child sample p50 / p95 ms | Child completion-age p95 ms | Sampled combined RSS peak GiB | Host available minimum GiB |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 18.34 / 25.42 | 427.06 | 1.90 | 4.85 |
| Injected faults | 18.06 / 25.39 | 404.62 | 1.99 | 4.91 |
| Injected faults + soak | 18.37 / 26.45 | 412.04 | 2.30 | 3.26 |

The ten-minute run retained 120 valid whole-device query samples. Sampled GPU
memory use ranged 6,492–8,126 MiB, utilization 3–99%, temperature 46–62 °C, and
power 56.34–292.49 W. These are device-wide readings including other applications;
they are neither per-worker allocations nor a 24-hour thermal/power qualification.
Combined RSS includes decoded buffers and detailed outcomes retained by the
private harness; these samples do not establish leak-free operation.

A preliminary 30-second prototype replay completed 5,142/5,688 samples at
171.39/s, with 465 replacements, four after-stop completions and 77 pending.
It predates authoritative generation/slot outcome fields; its original valid
JSON and source snapshot remain local and its numeric diagnostic is retained
separately. Final measurements above bind the final supervisor source hash.
Sequential runs on a shared PC do not isolate process-isolation overhead or
establish statistical confidence, zero-loss operation or physical-camera capacity.
<!-- RECOVERY_RESULTS_END -->

Queue accounting includes completed-in-window, after-stop successful drain,
explicit failures, replacements, staleness, budget rejection, pending and
in-flight work. Drain does not inflate measured throughput. Unique tokens and
per-camera terminal sequence order are checked for every accepted/failed
outcome. Failed samples are not retried. This does not imply all computation
survives a crash; unreceived outputs are explicitly failed.

Sample timing covers child preparation/inference/postprocessing. Reported child
completion age begins at locally paced decode and excludes result transport/
parent collection and upstream camera/HLS delay. Every accepted result is
separately checked against the dispatch-to-collection deadline. RSS sums shared
pages across processes and is not unique physical memory or VRAM. No statistic
here is end-to-end physical-camera latency.

## Preservation, rollback and remaining acceptance

The original dirty checkout is preserved. This work used a separate clone of
merged PR #17. Recordings, images, weights, detailed traces, fault markers and
source URLs stay on the owner PC; only code, methods, numeric rollups and hashes
are proposed for GitHub. No new video files, external camera connections,
driver/host changes, database migrations or default-setting changes are part of
this work. Earlier prototype diagnostics remain local and are identified in
the numeric record rather than silently replacing the final measurements.

Reproduce component checks with `python -m unittest discover -s tests -p 'test_*.py'`,
`python3 scripts/check-docs.py` and `python3 scripts/build-wiki.py --check`.
Private harnesses and their hashes support local audit; numeric exports alone
are not an independent replay fixture. Hosted CI and native owner-PC execution
are separate evidence. Rollback selects the existing direct/thread path or
reverts this isolated component; environment/driver rollback is unnecessary.

Parent-process crash/orphan cleanup, longer representative soak, separately
approved physical-camera ingest,
recording gaps/crash recovery, durable outcome/review storage, per-camera
rule-state reset on loss, aligned video labels, accepted workload/error budgets,
other GPUs/OSes and deployment acceptance remain open. A bounded ten-minute
repeat cannot establish continuous 24-hour operation or 100-camera support.
Merge/release and native Wiki publication remain separate owner actions.
