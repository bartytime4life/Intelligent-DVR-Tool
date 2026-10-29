# Owner-PC outcome journal and parent-crash qualification

October 28, 2026 owner-local date. Base: merged PR #18,
[`e628f3dba99a6b968d2a900c03ecb44daa61805f`](https://github.com/bartytime4life/Intelligent-DVR-Tool/commit/e628f3dba99a6b968d2a900c03ecb44daa61805f).
This record binds the new component by file hashes, not by a claim that the base
already contains it. [Results](results.json) · [Bindings](source-bindings.json) ·
[API and boundaries](../../performance-100-cameras.md#optional-local-outcome-journal).

## Change and ownership

An optional Linux `OutcomeJournal` commits dispatch identity before IPC and
terminal results/failure codes before returning them. SQLite WAL with
`synchronous=FULL`, an exclusive owner lock, bounded logical reservations,
explicit acknowledgment and explicit pruning preserve an inspectable outbox
across parent exits. It stores frame hashes/metadata and JSON results, not frame
payloads. Pending scheduler samples and per-camera rule state are not persisted.

The owned spawned child now arms Linux parent-death `SIGKILL` before constructing
processors and checks that its parent still matches. This stops orphaned native
computation; it is not a parent restart service or an OS sandbox. The caller still
polls deadlines and explicitly chooses any child restart budget.

New implementation/tests follow existing `edge/` and `tests/` responsibilities;
this dated evidence belongs under the existing `docs/verification/` root. The DVR
`AGENTS.md`, published component APIs and prior dated records govern placement.
No KFM mirrored sources, new policy/schema home or storage provisioning is involved.
Work used a separate clone; all 289 baseline primary-workspace files remained
present, with only the same five earlier local-AI changes. Recordings, images,
weights, databases and detailed traces remain on the owner computer.

## Environment and checks

Ryzen 9 9950X, 121.21 GiB usable RAM, RTX 5080 (16,303 MiB), NVIDIA driver
580.178.04, Linux x86_64/Python 3.12.3/SQLite 3.46.1. Existing isolated CPU and GPU
environments were reused; no packages, drivers, clocks or host settings changed.
The pinned GPU runtime is ONNX Runtime 1.31.1, OpenCV 4.13.0.92, NumPy 2.5.4,
CUDA runtime 13.4.92, cuBLAS 13.8.2.12 and cuDNN 9.27.0.42. The full runtime and
private harnesses/logs have bindings. Network containment denied IPv4/IPv6 in
all qualification parents/descendants, independently of the component.

| Check | Result and scope |
| --- | --- |
| CPU environment Python suite | 117 passed, zero skips |
| GPU environment Python suite | 117 passed, zero skips |
| Added coverage | 13 cases: durable reservation/terminal ordering, payload exclusion, reopen/ack/prune, run identity, interrupted dispatch, atomic batch rollback, row/byte pressure, commit/reservation failure, private paths/single ownership, unknown schema, bounds and actual parent death. Twelve are Linux-only; unsupported-platform admission is tested separately. |
| Native reference agreement | 100 saved full-resolution person/vehicle frames: labels/counts matched CPU references, minimum IoU 0.99999569, maximum score difference 0.000003645 (fixed tolerances 0.99/0.001). All 100 terminal records persisted and remained unacknowledged for inspection. |
| GPU execution admission | Four independent sessions per generation; each supplied a CUDA-only synthetic startup proof (203 CUDA node events), FP32/TF32 restrictions and disabled CPU fallback. Startup proof is not per-frame profiling or accuracy. |

The actual detector/model, confidence/decoder settings and CPU CLI default are
unchanged. Full-resolution parity is distinct from the low-resolution replay.
The source bindings identify the exact tested journal, supervisor and test bytes.

## Forced parent exit and delivery boundaries

The private harness first committed 12 native successes and acknowledged four.
It then dispatched four more full-resolution frames. All four completed actual
CUDA computation inside the child, wrote test-only computation markers, and
stalled before returning their result. The driver killed the parent with
`SIGKILL`. The child received parent-death `SIGKILL`; the isolated test driver
was a Linux subreaper and reaped it about **0.157 seconds after injection**.
Reaping by that harness is not a claim that a dead product parent reaps itself.
This is one software-injected process-exit observation, not a worst-case OS bound.

Reopening the same private journal produced:

- Eight unacknowledged successes, with their original receipt IDs/results.
- Four explicit `parent-interrupted` failures, with no result or retry, despite
  the harness knowing those computations had happened.
- No delivery of the four already acknowledged successes.

A second owner read those 12 records and exited with code 87 before acknowledgment.
The next open returned the **same 12 IDs**. Explicit acknowledgment and pruning
removed all 16 historical rows. A fresh worker run then completed and acknowledged
16 new native samples, using a different run UUID and new receipt IDs; its child
was reaped. A final reopen had no unread records, and explicit pruning emptied it.
This verifies at-least-once delivery and caller-controlled cleanup, not atomic
consumer side effects or exactly-once alerts.

An initial private harness attempt failed: it stopped polling after queuing the
large frames, so bounded IPC never completed and the intended crash boundary was
not reached. The harness was corrected to keep polling. Its failed log/source
are retained and hashed; component source did not change. That attempt is not
counted as a passing fault experiment.

## Offline replay and durability cost

All three sequential runs used the same 30 hash-verified frozen public recordings
cycled across 100 independent source-clock-paced virtual decoders, four native
sessions, nominal 2 samples/camera/second, 2-second age/task bounds and 64 MiB
scheduler payload budget. Source FPS/stride rounding determines actual offered
samples. The recordings are low resolution (primarily 480×270, 768×432 and
800×450), not 100 distinct full-HD physical cameras. No new video files were made.

The journal path used 1,000-row/64 MiB logical bounds, terminal delivery reads,
explicit acknowledgment after metadata checks and pruning near 500 rows. This
consumer validates metadata/IDs in memory; it is not durable review/event storage.
The control uses the same final supervisor and no journal/consumer database work.
All runs reused the same installed runtime; the control ran after the journal
runs. They were not randomized or repeated enough to isolate host noise or give
confidence intervals. The difference measures these complete paths, not SQLite
fsync cost alone.

| Case | Window | Offered | Completed in window | Results/s | Replaced | Successful drain | Pending |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Control | 30 s | 5,691 | 5,616 | 187.17 | 9 | 4 | 62 |
| Journal | 30 s | 5,691 | 3,833 | 127.74 | 1,777 | 2 | 79 |
| Journal repeat | 120 s | 22,551 | 16,505 | 137.48 | 5,946 | 4 | 96 |

Every row balances offered samples against completion, replacement, drain and
pending counts. Each had 100 active decoders, zero source/experiment errors,
zero explicit sample failures, zero stale/budget drops and zero in-flight work
after close. Pending samples remain counted; drain is excluded from throughput.
Every returned outcome was unique and ordered per camera. Replacements mean older
pending analysis samples were superseded, not that recordings were deleted.

The journal path's 30-second throughput was **31.75% lower** than the sequential
control, with materially more replacements. The two-minute path completed
16,509 terminal outcomes including drain; all had unique delivery IDs and were
acknowledged. It pruned 16,388 rows, leaving 121 acknowledged rows and zero unread
records. Peak observed row count was 502. This confirms metadata delivery/accounting
for that window, not adequate per-camera cadence. Journaling remains optional;
this result does not justify enabling it as a high-throughput default.

The two-minute journal run sampled 1.93 GiB combined parent/child RSS peak and
4.63 GiB minimum host available memory. Combined RSS can double-count shared
pages. Child preprocessing/inference/postprocessing p95 was 45.91 ms; child
completion age p95 was 539.11 ms and excludes result IPC/parent collection and
upstream network/capture. Memory guards were 4 GiB combined RSS/2 GiB available;
these are sampled experiment stops, not component OS quotas. Device metrics,
source traces and detailed observations remain private.

## Limits, next gate and rollback

Only dispatched work is durable. Pending/replaced/stale/budget-dropped samples,
source restart positions, rule/dwell state, full lifecycle events and recording
continuity are not recovered. The outbox does not persist processor/model settings
or startup proofs; a future admitted pipeline needs a separate durable run manifest.
The private harness and this frozen record supply those bindings for these tests. Logical row/result reservations do not bound SQLite
pages, indexes, WAL, disk caches or all process memory. Disk-full behavior is
fail-closed; the tests inject a real SQLite write refusal and check the visible
failure/recovery boundary, not a full physical disk or corrupted storage device.

Process exits do not qualify power failure, network filesystems, backup/restore,
malicious DB modification, a kernel/driver hang, 24-hour operation, representative
field/event accuracy or physical 100-camera capacity. User control of merge,
release/deployment and native Wiki publication remains separate.

The next performance gate is measured batching/group commit while preserving
reservation-before-IPC and terminal-before-delivery, followed by longer recovery
checks. Per-camera rules need explicit gap/reset and restart tests before pipeline
integration. Do not lower SQLite durability or silently retry failed samples to
claim a throughput gain.

Rollback omits `journal=` (retaining the nonjournal process adapter) or reverts
this optional component. Preserve/export existing private journal directories
for inspection; do not delete them as rollback. No database is opened, migrated,
or deleted automatically by the analyzer/browser, and no driver rollback is needed.

Recheck the frozen accounting without hardware or network:

```bash
python3 docs/verification/journal-2026-10-28/verify-results.py
python3 scripts/check-docs.py
python3 scripts/build-wiki.py --check
```
