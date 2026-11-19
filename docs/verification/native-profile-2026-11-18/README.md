# Owner-PC native CUDA and durable-result profiling

November 18, 2026 owner-local date. Tested source:
[d9fa29ebebe102d43202a38c1d67347f1f62b85c](https://github.com/bartytime4life/Intelligent-DVR-Tool/commit/d9fa29ebebe102d43202a38c1d67347f1f62b85c).
[Results](results.json) · [Source/input bindings](source-bindings.json) ·
[Runtime and network guard](environment.json) · [CUDA admission](cuda-admission.json).

This closes the previously blocked **native measurement** gate on the owner's
computer. CUDA admission now succeeds without a driver, package or host-setting
change. The earlier [blocked admission and synthetic checkpoint experiment](../durable-overload-2026-10-28/README.md)
remain historical evidence with their original limits. This is a new dated
observation, not a correction to those results.

No application implementation changed. The five pinned inference, journal,
supervision, scheduler and profiling modules match that earlier record byte for
byte; [core hashes](core-source.json) were checked before every measured stage and
afterward. The primary dirty checkout's 289 tracked/nonignored file hashes and
HEAD were also unchanged. Work used an isolated clone and private experiment
directory. No merge, installation, service or camera activation is included.

## Admission and saved-frame agreement

The existing RTX 5080 (16,303 MiB), driver 580.178.04, Python 3.12.3 and ONNX
Runtime GPU 1.31.1 executed the hash-bound YOLOX-S model. TF32 and CPU fallback
were disabled. The synthetic startup probe recorded 203 CUDA node events and
no CPU execution events. Each of the four worker sessions in every replay
also produced its own successful startup execution proof. Startup evidence is
separate from recording inference and capacity.

The same 100 saved full-resolution frames (60 person-entry and 40 vehicle-clip
frames) were run through **current-source OpenCV CPU references** and four
supervised CUDA sessions. Historical traces selected frame indices only; their
old detection outputs were not the oracle. Labels and counts matched on every
frame. Minimum matched box IoU was **0.99999569**, and maximum confidence delta
was **0.00000365**, within the fixed 0.99 / 0.001 tolerances. All 100 outcomes were
committed, retained unread and the child process was reaped.

The current decoder uses score threshold 0.1 and per-class NMS IoU 0.45; these
were not changed for this experiment. This is CPU/GPU output agreement, not
accuracy against independent person labels or an event/rule evaluation.
The [MEVA attribution, transformations and incomplete-label limits](../host-2026-10-28/README.md#public-media-pilot-and-label-limits)
still apply. There is no new precision, recall or false-alert claim.

## Matched replay with profiling off

All cases used 100 independent source-clock-paced decoders cycling the same 30
hash-verified, previously saved Iowa traffic recordings. They are mostly
480×270 to 800×450 at 15 FPS, **not 100 distinct physical cameras**. Four CUDA
sessions shared one supervised process. Sampling was nominally 2/source/s,
quantized to source frames. Actual offered load was 189.6/s in the 30-second
cases and 187.475/s in the longer run.

Each sample was bounded to 2 MiB, queued payloads to 64 MiB, sample age/task time
to two seconds, and successful stop drain to 2.5 seconds. Journals used local
ext4/NVMe storage, 1,000 logical rows, 64 MiB logical bytes, WAL, FULL synchronization,
schema 1 and the existing 512-page automatic checkpoint cadence. Explicit consumer
polling had a 25 ms minimum interval; acknowledged rows were pruned at 500 retained
entries. No-journal controls omitted that storage/consumer work. SQL tracing was
off throughout. These controls measure the entire durable-result path's cost,
not just one SQLite setting.

| Run order | Seconds | Completed in window | Analyses/s | Replaced | Successful drain | Pending |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Journal 1 | 30 | 4,897 | 163.23 | 706 | 4 | 81 |
| No journal 1 | 30 | 5,399 | 179.97 | 202 | 4 | 83 |
| No journal 2 | 30 | 5,524 | 184.13 | 100 | 4 | 60 |
| Journal 2 | 30 | 4,800 | 160.00 | 802 | 6 | 80 |
| Journal, longer repeat | 120 | 20,512 | 170.93 | 1,930 | 6 | 49 |

The two-run medians were **161.62/s journaled** and **182.05/s without the journal**:
an observed **11.22% lower throughput** for durable results on this workload.
This ABBA comparison uses current code throughout. It does not measure the gain
of any historical optimization, isolate a checkpoint change, or establish
statistical certainty on a busy owner PC. The harness now stops offers at a
fixed window boundary and excludes outcomes collected at/after it from throughput;
that timing and the current decoder prevent direct speedup claims against older runs.

All seven replay cases had 100 active decoders, no reported source/experiment
errors, zero explicit failures, stale losses, budget drops or remaining in-flight
work, and reaped children. Replacements and pending work are retained in the
accounting, not counted as successes. Every case satisfies:

`offered = completed + successful drain + replaced + stale + budget-dropped + failed + pending + in-flight`.

The longer run offered **22,497** samples, decoded **186,364** frames, and uniquely
delivered/acknowledged **20,518** durable results including six after the window.
It replaced **8.58%** of offered opportunities. No unread journal outcomes remained;
49 unprocessed pending samples were still visible at stop. This is not zero loss.
Replacement drops an analysis opportunity, not the retained recording.

## Separate timing attribution

Two additional 30-second runs enabled bounded profiling, journal then no journal.
They completed 169.40/s and 184.33/s respectively; these single profiled cases
are **not** the primary performance comparison or a profiling-overhead estimate.
Their full fixed-size aggregates and graceful final-child markers are in the JSON.

| Inclusive span | Profiled journal | Profiled no-journal |
| --- | --- | --- |
| Parent step | 13.146 s / 26,442 calls | 3.164 s / 47,245 calls |
| SQLite commit | 9.001 s / 9,981 calls; mean 0.902 ms | absent |
| Journal payload hashing | 1.072 s / 5,086 calls | absent |
| Child processor service | mean 17.814 ms / 5,086 calls | mean 19.713 ms / 5,534 calls |
| Native CUDA forward | mean 11.089 ms / 5,086 calls | mean 11.272 ms / 5,534 calls |

Durable commit work is material in this observed controller path. The profile
does not prove it explains the entire throughput gap. Spans are inclusive,
nested and concurrent: **do not sum or subtract them as exclusive elapsed time**.
Native forward includes runtime, copies and scheduling, not pure GPU kernel time.
No-op reservation calls and initialization/drain work can appear in aggregates.
The snapshot follows worker close/drain but precedes the final consumer-tail
read/ack and database close/checkpoint; those final storage costs are not included.
Both children emitted graceful final summaries, so no forced-exit profile tail
was lost in these two cases. Profile reporting itself also adds unmeasured work.

Across all cases, sampled combined parent/child RSS stayed at or below **2.02 GiB**
and sampled system available RAM stayed above **76 GiB**, within the 4 GiB / 2 GiB
stop thresholds. These are sampled process limits, not OS-enforced quotas.
Five-second whole-GPU samples reached 5,221 MiB including other applications;
they are not isolated worker allocations or exhaustive peaks. WAL file high water
and physical fsync counts were not instrumented in this native run.

## Validation, reproduction and remaining gate

The existing guarded GPU-package environment passed **47 targeted Python tests,
zero skips**: [21 journal](core-tests.log), [12 process supervision](process-tests.log)
and [14 profiling](profiler-tests.log). This is not the full current application
suite or browser/native-service acceptance. The inherited seccomp guard explicitly
denied IPv4 and IPv6 socket creation with EPERM. All native measured subprocesses
and descendants ran through that guard. GitHub CI, if run for the documentation
change, is a separate hosted-source check and cannot repeat this hardware claim.

[Exact harness snapshots](harness/run_checks.py) are retained with hashes for
audit. They use the original owner-lab layout, not a newly shipped public CLI.
To repeat on this PC, copy the five harness modules into a **new private**
`qa-local/<new-run>/` beside the existing frozen qualification folders; place an
exact-source clone at `source/` and copy `core-source.json` to
`frozen-core-before.json`. Review the explicit source revision, paths and run plan
before invoking `python3 run_checks.py`. Existing recordings, fragment/selection
manifests, model, pinned environments and guard must already exist. The scripts
perform no downloads/installations; fresh output/log paths are required.

Run the admission helper through the same guard first, with the explicit pinned
model and a new output file. Run the metadata collector separately through that
guard after the experiment. It checks network denial and captures package/clip
bindings. The source-binding file lists the 30 assembled recording hashes plus
person/vehicle frame indices and clip hashes. Private media, raw per-sample
traces, databases, source URLs and reference boxes are deliberately absent;
the public files alone cannot independently reconstruct the input corpus.

```bash
python3 docs/verification/native-profile-2026-11-18/verify-results.py
python3 scripts/check-docs.py
python3 scripts/build-wiki.py --check
```

The next performance experiment should be a separately reviewed proposal for
reducing durable controller work while preserving reservation-before-IPC,
terminal-before-delivery, FULL/WAL and unread recovery. The five pinned modules
remain frozen under the current owner instruction. No optimization is adopted
from this diagnostic alone. A longer controlled replay with explicit latency/loss
targets comes before representative multi-source recording and physical-camera
acceptance. Disabling the journal is a diagnostic control, not a durability fix.

Recordings, downloaded images, model weights, private journals and detailed traces
stayed on this computer; no new video was recorded. No cameras, live monitoring,
services, packages, drivers, host power settings or deployment were changed.
Physical 100-camera/full-resolution capacity, representative field accuracy,
recording continuity, power-loss durability and 24-hour operation remain
**unqualified**. Rollback removes this dated documentation, index/guide links and
generated mirrors; no application rollback, migration or media deletion is needed.
