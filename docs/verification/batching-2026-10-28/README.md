# Owner-PC atomic journal batching qualification

October 28, 2026 owner-local date. Base: merged PR #19,
[`47dc335976daa22e2780d70948f0a9568ccecfdf`](https://github.com/bartytime4life/Intelligent-DVR-Tool/commit/47dc335976daa22e2780d70948f0a9568ccecfdf).
The candidate is bound by the tested file hashes; the base does not already
contain these changes. [Results](results.json) · [Bindings](source-bindings.json) ·
[Journal API](../../performance-100-cameras.md#optional-local-outcome-journal) ·
[Earlier journal cost](../journal-2026-10-28/README.md).

## Result and scope

The candidate combines atomic groups of available terminal responses with an
unread-record index. Across two matched 30-second runs each, legacy throughput
had a median of **158.93 samples/s**, candidate **167.13 samples/s**: an observed
**5.16% increase**. Consumer acknowledgment batching added no clear throughput
gain. The candidate is retained as a bounded improvement, with SQLite durability
unchanged. It does not qualify the requested physical 100-camera workload.

The two-minute candidate run processed 20,043 samples in-window at 167.01/s and
uniquely delivered/acknowledged 20,046 including drain. It still replaced 2,408
older pending samples and left 95 pending. A separate current no-journal control
processed 187.20/s. Journaling remains opt-in and still has material path cost.
These are complete-path observations, not isolated fsync timings or confidence
intervals. Do not attribute the earlier record's different absolute rates entirely
to this change; host conditions and instrumentation differ.

## Implementation and boundaries

- `OutcomeJournal.finish_many()` validates and commits 1–4 terminal rows in one
  transaction, returning IDs in input order. `finish()` retains its one-row API.
  A bad member is rejected before writing; SQLite rejection rolls back the group.
- Journaled `ProcessWorkers` stages validated responses from one bounded IPC
  pump, then commits before scheduler-slot release or outcome return. There is
  no timer, sleeping or cross-poll batch wait. At most four results are staged.
- Protocol/worker faults preserve already validated responses, then commit
  failures for remaining work as a group. Storage errors stop dispatch/restarts
  and expose unconfirmed RAM failures without durable IDs; unresolved rows remain
  available for inspection/reopen recovery.
- A partial index contains only unacknowledged terminal rows. The legacy delivery
  query scanned retained table history; the candidate query scans the unread
  index. New snapshot counters describe terminal API commits in the current open
  run, not all SQLite transactions, persisted history or physical fsync calls.
- WAL, `synchronous=FULL`, private ownership/permissions, sample/result bounds,
  explicit acknowledgment/pruning, no retry and parent-death cleanup remain.
  Version-1 row schema, stable IDs and old-reader compatibility are preserved.

Existing `edge/`, `tests/` and `docs/verification/` responsibility roots own these
changes. DVR `AGENTS.md`, existing APIs and prior records provide placement basis;
no parallel storage/schema home is introduced. Wiki files are generated mirrors.
The separate clone leaves the primary checkout intact: 289 baseline files remain,
with the same five earlier local-AI differences and no missing files. No KFM
mirrored source was edited.

## Environment, admission and correctness

Existing isolated CPU/GPU environments were reused on Linux x86_64, Python 3.12.3,
SQLite 3.46.1, Ryzen 9 9950X, 121.21 GiB usable RAM and RTX 5080 (16,303 MiB,
driver 580.178.04). Runtime: ONNX Runtime GPU 1.31.1, OpenCV 4.13.0.92,
NumPy 2.5.4, CUDA runtime 13.4.92, cuBLAS 13.8.2.12, cuDNN 9.27.0.42.
No packages, model/decoder/threshold settings, drivers or host controls changed.
Every qualification parent/descendant ran with IPv4/IPv6 denied by the separate
local runner. No new video files, live camera activation or media transmission.

| Check | Evidence |
| --- | --- |
| CPU environment suite | 125 passed, zero skips |
| GPU environment suite | 125 passed, zero skips |
| Eight added Linux tests | Atomic ordered IDs/charges, whole-batch validation, SQL rollback after earlier updates, unread query plan, staging before slot release, storage failure, valid-response preservation on protocol fault, real owner exit during/after commit |
| Native reference agreement | 100 saved full-resolution person/vehicle frames; count/label agreement, minimum IoU 0.99999569, maximum score difference 0.000003645, fixed 0.99/0.001 tolerances |
| Native journal admission | Four independent sessions per generation, CUDA-only synthetic startup proof (203 CUDA node events each), disabled TF32 and CPU fallback, retained settings |
| Database compatibility | Legacy creates two successes/two reservations; candidate preserves successes, recovers two interruptions and acknowledges one; legacy reopens, reads the remaining three, acknowledges/prunes all four. Version stays 1. |

All 100 parity outcomes were committed and left unread for inspection; they used
93 terminal commits, largest observed batch 2. The model/profile is unchanged.
Startup proof is not per-frame profiling, a new accuracy benchmark or capacity.
Linux-only journal/process tests are explicitly skipped on other platforms;
unsupported-platform admission and ordinary CPU paths have separate coverage.

## Native atomic exit windows

The private fault fixture collects four actual CUDA responses and deliberately
holds flushing until all four are available to expose a four-row transaction.
That artificial synchronization is **not** production behavior or a performance
measurement. Four full-resolution frames come from the saved person/vehicle clips.
The parent has received all four, while scheduler slots remain in-flight and no
outcomes have been returned.

| Injected parent exit | Persisted recovery | Owned child |
| --- | --- | --- |
| After two SQL updates inside the uncommitted four-row transaction | All four recover as `parent-interrupted`, no result/partial success | Parent-death SIGKILL; test subreaper reaped it about 0.122 s after injection |
| Just after four-row commit, before API return/scheduler completion | All four successes retained, no interruptions; result hashes match the computed values | Parent-death SIGKILL; test subreaper reaped it about 0.117 s after injection |

Repeated reads returned the same IDs. Acknowledging two survived reopen; only the
other two were then offered. Explicit acknowledgment/pruning emptied both journals.
The harness reaped its orphaned grandchild; a dead product parent cannot reap
itself. These are process-exit observations, not power-failure or worst-case OS
bounds. Existing single-row, child-failure, no-retry, private-directory, deadline
and parent-death tests remain in the full suite.

## Matched replay and consumer experiment

A local plan was written before the final repeated runs. It requires unchanged
native agreement, complete atomic exit recovery, WAL/FULL settings and a candidate
median at least as high as legacy under the same consumer. Final source hashes
stayed constant across all 12 qualification stages; all exited zero. A preceding
candidate diagnostic probe measured 165.33/s, largest batch 3; it remains recorded
separately and is excluded from matched medians.

The first four final performance runs follow **legacy → candidate → candidate →
legacy**, using identical harness, eager delivery/acknowledgment, recordings,
scheduler limits and four GPU sessions. This balances order partly, but is only
two runs each on one busy owner computer, not randomized repeated trials or a
statistically established universal improvement. SQL trace callbacks count
statements in both journal variants; they are instrumentation with their own cost.
The index and group changes were evaluated together, not isolated individually.

All cases cycle the same 30 hash-verified frozen low-resolution public recordings
through 100 independent source-clock-paced virtual decoders. Nominal sampling is
2/camera/s; source FPS/stride rounding determines actual offers. Source dimensions
are primarily 480×270, 768×432 and 800×450. Buffers are 64 MiB payload, 2 MiB/sample;
scheduler age/task limits 2 seconds. Journals have 1,000-row/64 MiB logical limits.

The separate consumer experiment checks delivery every 25 ms, validates metadata/
IDs, acknowledges the collected IDs together and prunes near 500 retained rows.
The eager consumer reads/checks/acknowledges on each controller pass. Both perform
in-memory qualification checks; neither is a durable rule/review consumer. An
application must handle/deduplicate records durably before acknowledgment.

| Case | Window | Offered | Completed in window | Results/s | Replaced | Successful drain | Pending |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Legacy 1 | 30 s | 5,691 | 4,707 | 156.87 | 901 | 4 | 79 |
| Candidate 1 | 30 s | 5,691 | 4,959 | 165.27 | 645 | 4 | 83 |
| Candidate 2 | 30 s | 5,688 | 5,070 | 169.00 | 532 | 4 | 82 |
| Legacy 2 | 30 s | 5,691 | 4,831 | 160.99 | 776 | 2 | 82 |
| Candidate + ack cadence | 30 s | 5,691 | 5,030 | 167.62 | 576 | 2 | 83 |
| Candidate + ack cadence repeat | 120 s | 22,549 | 20,043 | 167.01 | 2,408 | 3 | 95 |
| No-journal control | 30 s | 5,688 | 5,616 | 187.20 | 6 | 4 | 62 |

All cases had 100 active decoders, zero reported source/experiment errors, zero
explicit sample failures, zero stale/budget drops and zero in-flight work after
close. Queue identities include every pending/replaced/drained sample; drain is
excluded from throughput. Unique terminal outcomes remained ordered per camera.
Pending replacements are analysis losses, not deletion of recorded video.

The two-minute candidate used 17,770 terminal commits for 20,046 terminal rows,
largest batch 4 (average about 1.13 rows/terminal commit). There is still limited
natural coalescing; no forced delay was added to raise that number. All 20,046
rows had unique delivery IDs and were acknowledged. Explicit pruning removed
19,917 rows, leaving 129 acknowledged rows and zero unread records; peak observed
row count was 504. SQL COMMIT callbacks count all traced transactions, including
reservation/acknowledgment/pruning, and are not physical fsync measurements.

The two-minute run sampled about 2.00 GiB combined parent/child RSS peak and
4.61 GiB minimum host available memory. Combined RSS can double-count shared
pages. Guards were 4 GiB combined RSS/2 GiB available, sampled experiment stops
rather than component OS quotas. Child timing/age distributions exclude result
IPC, SQLite commit/delivery and upstream capture/network time; end-to-end durable
review latency is not measured. Detailed traces/device metrics stay on the PC.

## Limits, next gate and rollback

The optional journal path still falls behind the offered workload. These repeated
offline clips do not qualify 100 distinct/full-HD physical cameras, recording
continuity, representative video/event quality, 24-hour operation, power loss,
full/corrupt disks, network filesystems, backup/restore or exactly-once consumer
effects. Pending samples, source restart positions and per-camera rule/dwell state
remain absent. Model/settings/startup proofs still need a durable run manifest in
an admitted pipeline; this frozen qualification binds them for these experiments.

SQLite I/O can block the parent; polled deadlines are not hard real-time limits.
Parsed results and database/WAL/index/cache overhead exceed logical reservations.
Future profiling should separate parent IPC/serialization, journal and native
service costs before adding a delayed batch or weakening any durability boundary.
Consumer cadence alone did not close the gap; it is not adopted as a product default.

Rollback reverts this change while retaining version-1 rows, or omits `journal=`
to use the nonjournal process adapter. The additive unread index can remain; the
legacy reader round trip passed. Preserve private journal directories and unread
outcomes. No driver/package rollback or row migration/deletion is required. Merge,
deployment and native Wiki publication remain separate owner actions.

```bash
python3 docs/verification/batching-2026-10-28/verify-results.py
python3 scripts/check-docs.py
python3 scripts/build-wiki.py --check
```
