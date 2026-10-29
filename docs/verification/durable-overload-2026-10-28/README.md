# Disk-backed overload and checkpoint qualification

October 28, 2026 owner-local date. Candidate base: merged PR #22,
[`29b20d78726b0e811fa97fe62577e92ce6a82fab`](https://github.com/bartytime4life/Intelligent-DVR-Tool/commit/29b20d78726b0e811fa97fe62577e92ce6a82fab).
[Results and exact tested file hashes](results.json) · [CPU tests](cpu-tests.log) ·
[GPU-package tests](gpu-package-tests.log) · [Earlier profiling](../profiling-2026-10-28/README.md).

## Finding and selected change

The previous local connection is available again. Existing pinned CPU/GPU package
environments, private qualification helpers and frozen recordings were located
without changing the original checkout or recordings. Direct CUDA admission on
the candidate fails with **CUDA error 100: no CUDA-capable device detected**.
Provider availability does not establish usable hardware. No CPU fallback was
used for this failed CUDA admission; no recording frames were processed.

The existing synthetic probe offered only 200 opportunities/s and was unsaturated.
It now accepts bounded **0.5–20 offers per virtual source per second**, retaining
the default 2. This is a diagnostic setting, not a production camera cadence.
The 100 sources, four workers, one pending sample per source, 64 MiB payload
budget, 1,000-row/64 MiB journal and 1–120-second window remain. Receipt identity
sets have a finite maximum implied by those source/rate/time limits. The tool
reports actual offers, losses, successful/failed drain and pending separately.

The first nine-case diagnostic used 20/source/s, 388,800 synthetic payload bytes,
eight-second windows and the same Python 3.12.3/SQLite 3.46.1 environment on this
Ryzen 9 9950X computer. Disk-backed output reported `ext2/ext3`; RAM output was
`tmpfs`. The profiled disk path spent **5.12–5.15 seconds inside SQLite commit
calls**, versus **0.122–0.124 seconds** for RAM-backed journals. Their respective
throughputs were about 501–511/s and 1,450–1,457/s. These observed commit spans
identify the main cost in this synthetic disk/process workload; they do not
establish the bottleneck in the unavailable CUDA recording replay.

The focused candidate changes only the journal's automatic checkpoint cadence
from **64 to 512 pages**. WAL and `synchronous=FULL` remain. SQLite documents that
FULL synchronizes the WAL at each commit; checkpointing consolidates pages into
the database separately. This amortizes checkpoint work without deferring the
required commit synchronization. See the primary
[SQLite WAL description](https://sqlite.org/wal.html) and
[pragma reference](https://sqlite.org/pragma.html#pragma_synchronous).

There is no batching timer, delayed outcome release, retry, new reservation
capacity, schema migration or host setting change. Reservation commits still
precede IPC, terminal commits precede slot release/delivery, acknowledgments are
explicit, and model/threshold/provider/CPU defaults are unchanged.

## Exploratory trial and prewritten confirmation

An initial six-case checkpoint trial changed only 64 versus 512 pages and
observed a 5.48% median gain. It is exploratory and excluded from the confirmation
median. Before the next nine cases, [the runner](run-experiment.py) wrote its plan,
source/guard hashes and acceptance gate: at least **3% median improvement**, FULL/WAL
unchanged, complete accounting/delivery and sampled WAL high water at most **4 MiB**.

Confirmation followed **baseline → candidate → candidate → baseline**, with
profiling disabled in these four cases. All other workload settings stayed equal.

| Case | Checkpoint pages | Offered | Completed in window | Outcomes/s | Replaced | Pending |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline A1 | 64 | 16,000 | 4,186 | 523.250 | 11,735 | 74 |
| Candidate B1 | 512 | 16,000 | 4,497 | 562.125 | 11,428 | 70 |
| Candidate B2 | 512 | 16,000 | 4,460 | 557.500 | 11,465 | 70 |
| Baseline A2 | 64 | 16,000 | 4,170 | 521.250 | 11,751 | 74 |

Median throughput was **522.250 → 559.8125/s**, an observed **7.19% increase**.
Successful drain is excluded from throughput and retained in the JSON accounting.
This is two runs per variant on one busy computer, not statistical certainty or
a universal speedup. Owner-PC activity and storage behavior were not controlled
as a dedicated benchmark laboratory.

Four separate profiled candidate cases used disk → RAM → RAM → disk; a ninth
no-journal control is separate from the primary comparison. Every case balanced
`offered = completed + failed + replaced + stale + budget-dropped + drain + pending + in-flight`,
with disjoint categories. All children were reaped; no explicit
sample failures occurred. Journal outcomes had unique delivered/acknowledged IDs.
The candidate still replaced over 11,000 opportunities per disk-backed case under
this deliberately excessive offer rate. Those are missed synthetic analyses,
not deleted recordings and not successful detections.

## Resource and recovery checks

Sampled WAL high water across the confirmation cases was **2,476,152 bytes**;
the unprofiled baseline cases sampled about 0.60 MB and candidate cases 2.14–2.26 MB.
The larger cadence has a storage tradeoff. A checkpoint threshold is **not a file
quota**: long transactions or readers can exceed it. The 4 MiB gate applies to
this finite, single-owner synthetic experiment, not every future workload.
Logical row/byte budgets still exclude database/index/cache overhead. This does
not establish an OS quota, disk-full behavior or physical power-loss reliability.

- **142 Python tests passed with zero skips in each existing CPU and GPU-package
  environment.** The latter establishes package compatibility, not native CUDA
  execution. Existing transaction rollback, atomic parent-exit windows,
  backpressure, worker failure, shutdown and interruption recovery remain covered.
- Three added regressions exercise CLI overload/loss/byte bounds, invalid offer
  rates before receipt creation, and FULL/WAL/schema/unread delivery across reopen.
- [A real PR #20 → candidate → PR #20 API round trip](legacy-roundtrip.py) retained
  three stable IDs, recovered one interrupted reservation, preserved acknowledgments
  across reopen and explicitly pruned all three. Schema version remains 1.
- The reused process-local guard denied both IPv4 and IPv6 socket creation.
  Every measured CLI process and its descendants ran under it, as did the test
  suite processes and their descendants.

Profiling spans are inclusive and can overlap. Do not sum nested/concurrent
timings or call native forward spans GPU kernel time. Commit aggregates can
include initialization/drain and exclude final database-close checkpoint overhead.
The profile-off comparison is the primary performance observation.

## Reproduce, next gate and rollback

Use the same pinned interpreter and existing trusted offline guard; no installation
is performed. The baseline source must be merged PR #22 with its 64-page policy.
The disk/RAM roots must not exist; their parents must exist. The runner creates
private roots and exclusive receipts, then removes only its temporary synthetic
journals. Real journals and recordings are never opened by the synthetic tools.

```bash
/private/env/bin/python -B docs/verification/durable-overload-2026-10-28/run-experiment.py \
  --python /private/env/bin/python --guard /private/offline_guard.py \
  --baseline-source /private/pr22 --baseline-commit 29b20d78726b0e811fa97fe62577e92ce6a82fab \
  --disk-root /private/new-disk-case --ram-root /tmp/new-ram-case
python3 docs/verification/durable-overload-2026-10-28/verify-results.py
```

[CUDA admission helper](check-cuda.py) accepts only an explicit model and new
output path, verifies the pinned YOLOX hash/labels and requests disabled fallback.
Run it through the same offline guard in the pinned GPU environment. Exit 2 means
blocked admission. Device visibility must be restored through a separately
authorized environment action before repeating the existing frozen-recording
parity and matched 30/120-second CUDA replay. Do not weaken admission or infer
GPU performance from these hashing/SQLite experiments.

No recording data was copied or transmitted; no live cameras, services, monitoring,
drivers, packages, power settings or deployment were activated/changed. The only
runtime policy change is in application journal code. Physical 100-camera capacity,
full-resolution production, sustained native CUDA gain and 24-hour operation remain
unqualified. Roll back the checkpoint line to 64 to restore the prior cadence;
preserve private WAL/database files and unread outcomes. No migration or row deletion
is needed. Merge, deployment and host changes remain separate owner actions.
