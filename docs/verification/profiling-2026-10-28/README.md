# Durable processing: profiling and bulk acknowledgment

October 28, 2026 owner-local date. Baseline: merged PR #20,
[50349bc758dedb6363c728e4893bedcedafc3808](https://github.com/bartytime4life/Intelligent-DVR-Tool/commit/50349bc758dedb6363c728e4893bedcedafc3808).
[Earlier native replay](../batching-2026-10-28/README.md) ·
[Observed local summaries](observed-summary.json).

## Finding and focused change

PR #20's 167.01/s journaled native replay and separate 187.20/s no-journal control
motivate profiling; they do not isolate the gap. The previous acknowledgment
cadence experiment already showed no clear gain.

A separately demonstrated bulk-delivery cost is N validation queries plus N
update statements per acknowledgment. Large acknowledgments now validate sets of
at most 250 IDs and update all chunks in ONE transaction. Every ID in every chunk
is validated before any update. Missing/dispatched IDs reject the whole call;
SQL errors roll back every chunk. Duplicates/repeated acknowledgments are harmless.
Groups of 1–4 retain their original single-ID queries/updates because an initial
all-set trial regressed the common small case.

No delay, background writer, retry, implicit acknowledgment/pruning or durability
relaxation is introduced. FULL/WAL, schema version 1, stable IDs, private paths,
logical bounds, reservation-before-IPC and terminal-before-slot-release remain.
CPU defaults and CUDA provider admission/precision/fallback behavior are retained.

## Available evidence and interruption

Before the execution connection was lost, the local iteration completed 139
Python tests: 131 passed, zero failed, eight native dependency skips. The final
rerun's test summary also returned those counts, but its subsequent performance
stages became inaccessible. Source/tools were preserved from patch history.
**CI on the preserved commit is the source-bound validation**; inaccessible local
receipts do not certify this commit. Original raw receipts could not be recovered.
The numbers below are observed summaries of the preceding completed iteration,
not invented raw trials or new final-head hardware results.

The same acknowledgment harness ran against PR #20/candidate in A/B/B/A order.
Each run created 1,000 retained synthetic terminal rows and took 11 trials per
batch size. Unread reset was outside timing. SQL tracing was used only for a
separate statement count.

| Ack IDs | Earlier baseline median µs | Earlier candidate median µs | Validation queries / updates, before → after |
| ---: | ---: | ---: | --- |
| 1 | 10.319 | 9.673 | 1 / 1 → 1 / 1 |
| 4 | 22.041 | 17.057 | 4 / 4 → 4 / 4 |
| 64 | 171.411 | 66.294 | 64 / 64 → 1 / 1 |
| 1,000 | 2,656.383 | 1,113.409 | 1,000 / 1,000 → 4 / 4 |

These Linux sandbox measurements used tmpfs, Python 3.14.4 and SQLite 3.46.1.
The larger API calls took about 61% and 58% less time in that iteration. Small
timings are noisy; their algorithm stays unchanged. This measures statement
overhead, **not physical SSD latency, native replay gain or statistical certainty**.
PR #20's naturally small batches mean this may do little for its particular
replay; it primarily helps unread backlog drains. The native bottleneck remains
unproven.

Six preceding five-second synthetic storage/IPC cases (baseline/candidate A/B/B/A,
candidate profiled journal and no-journal controls) each offered/completed 1,000
opportunities, with zero failures, replacements, stale/budget losses, pending or
in-flight work. They reached the offered ceiling of 200/s and establish no
throughput advantage. All journal outcomes were uniquely delivered/acknowledged.
Their inaccessible raw receipts are not final-head evidence; rerun the tools.

## Timing model and bounds

Pass one explicit BoundedProfile to CameraScheduler, OutcomeJournal and
ProcessWorkers. Defaults leave profiling disabled.

| Phases | Scope |
| --- | --- |
| native.cuda.run / native.cpu.run | Synchronous forward wall time, including runtime/copies/scheduling; not isolated GPU kernel time |
| child.processor / child.queue | Processor service (including preparation/decoding done there) and executor queue wait |
| child.ipc.read/write, child.serialize/deserialize, child.wait | Request/result transport, encoding/parsing and select wait |
| parent.ipc.read/write, parent.serialize/deserialize | Nonblocking IPC, request construction/copies and result decoding/validation |
| journal.reserve/hash/serialize/finish | Reservation preparation/hash/encoding and terminal processing |
| journal.sqlite.query/execute/commit | Queries, statements and actual transaction commit calls, not physical fsync counts |
| journal.pending/ack/prune, parent.delivery | Durable parsing, explicit consumer operations and returned outcome tuple |
| scheduler.*, parent.step | Scheduler operations/lock wait and inclusive controller cost |

Spans are inclusive and can overlap across threads: never sum nested/concurrent
spans as elapsed time or subtract them as exact exclusive costs. Native startup
proof stays separate from forward timings. Failed calls/empty reads count.
Initialization/recovery queries can appear in journal aggregates.

The collector stores only fixed phase names, count/total/max and 48 logarithmic
nanosecond buckets per phase; counters saturate. It is thread safe and retains no
sample history, IDs, paths, media or result values. Disabled instrumentation does
not read the performance clock.

Enabled children send cumulative aggregates every 64 responses and at graceful
stop, without holding results for a profile batch. At most four generation
summaries are retained. Missing child_final markers explicitly identify lost
forced-exit tails, including unfinished calls, not zero cost. Profile reporting
encoding/transport is excluded from child timing to avoid recursion. Profiles
have a separate 64 KiB limit; original result-byte limits remain. Profiling adds
work/traffic: compare throughput with it OFF and collect attribution separately.

## Reproduce and owner gate

Scripts never open recordings, models, cameras, production journals or a network.
Output parents must exist; new receipts are exclusive mode-0600 files. Only private
temporary synthetic journals are created/removed.

~~~bash
python3 scripts/benchmark-ack.py --source-root /path/to/pr20 --label A1 --output /private/ack-A1.json
python3 scripts/benchmark-ack.py --label B1 --output /private/ack-B1.json
python3 scripts/benchmark-ack.py --label B2 --output /private/ack-B2.json
python3 scripts/benchmark-ack.py --source-root /path/to/pr20 --label A2 --output /private/ack-A2.json
python3 scripts/profile-durable.py --source-root /path/to/pr20 --seconds 5 --payload-bytes 388800 --output /private/A1.json
python3 scripts/profile-durable.py --seconds 5 --payload-bytes 388800 --output /private/B1.json
python3 scripts/profile-durable.py --seconds 5 --payload-bytes 388800 --output /private/B2.json
python3 scripts/profile-durable.py --source-root /path/to/pr20 --seconds 5 --payload-bytes 388800 --output /private/A2.json
python3 scripts/profile-durable.py --seconds 5 --payload-bytes 388800 --profile --output /private/profile.json
python3 scripts/profile-durable.py --seconds 5 --payload-bytes 388800 --profile --no-journal --output /private/control.json
python3 -m unittest discover -s tests -p 'test_*.py'
~~~

For native attribution keep the existing frozen-recording harness/qualified
factory and wire the collector into its controlling objects:

~~~python
from edge.profiling import BoundedProfile

timings = BoundedProfile()
scheduler = CameraScheduler(camera_ids, workers=4, max_sample_bytes=2*1024**2,
    max_buffer_bytes=64*1024**2, max_age_seconds=2, profile=timings)
journal = OutcomeJournal(new_private_run_directory, max_entries=1000,
    max_bytes=64*1024**2, profile=timings)
pool = ProcessWorkers(scheduler, qualified_factory, task_timeout=2,
    journal=journal, profile=timings)
# Existing offline harness feeds scheduler and polls pool.step().
# Close/drain pool; save pool.profile_snapshot() locally; close journal.
~~~

Native OpenCV/ONNX Runtime and usable CUDA were unavailable to this sandbox.
No new native CPU/CUDA or frozen-recording measurement is claimed. Next gate:
PR #20 → candidate → candidate → PR #20, profiling OFF, identical hash-bound 30
frozen recordings, 100 source-clock-paced virtual decoders, four pinned CUDA
sessions, model/threshold/frame/stride settings, 2/camera/s sampling, 2-second
sample/task limits, buffer/journal limits, SQL trace setting, consumer cadence
and pruning. Bind exact source/harness/runtime/model/media hashes.

Retain offered, completed-in-window, failed, replaced, stale, budget-dropped,
successful/failed drain, pending, RSS and unique durable delivery/ack counts.
Exclude successful drain from throughput. Replacements are missed analysis,
not deleted recordings. Collect separate profiled journal/no-journal runs with
reporting-tail/overhead notes; extend equivalent candidate workload to 120 seconds
before longer offline trials. The synthetic tool cannot substitute for native
decoding/inference or establish the cause of the owner's throughput gap.

Fourteen regressions cover bounded/threaded timing, disabled clocks, fake native
failure without retry, overload/fairness/age accounting, atomic ack validation/
rollback/persistence, backpressure, worker exit/restart, storage failure/recovery,
shutdown, independent byte limits and malformed final-profile cleanup. Existing
terminal atomicity/parent-death tests remain.

Recordings stay private/local. No camera/service activation, package/driver
installation, host changes, live monitoring or deployment is included. Physical
100-camera/full-resolution capacity, 24-hour operation, representative quality
and physical power-loss durability remain unqualified. Roll back code or omit
profile=; preserve real journals/unread outcomes. No migration/deletion is needed.
