# Rejected controller-pause experiment

November 18, 2026 owner-local date. Tested source:
[80825904df5c2989aa546178c59c9d20b49f3977](https://github.com/bartytime4life/Intelligent-DVR-Tool/commit/80825904df5c2989aa546178c59c9d20b49f3977).
[Results](results.json) · [Predeclared plan](plan.json) · [Decision](decision.json) ·
[Source/input bindings](source-bindings.json) · [Runtime](environment.json) ·
[Baseline CI](base-ci.json).

The [preceding native qualification](../native-profile-2026-11-18/README.md)
identified material durable-result commit work. This experiment tested whether
sleeping longer after each controller step would collect larger batches and
amortize that work. **The 2 ms candidate was rejected:** it made fewer controller
calls, but its unprofiled median throughput was 2.83% lower and it replaced more
analysis opportunities. The private benchmark retains its 0.5 ms pause. No
application default or implementation changed.

## Scope and criteria fixed before execution

Only the private harness's post-step sleep and a shared, inexpensive step counter
were added. Both variants used the same counter. A was 0.5 ms and B was 2 ms;
these are requested sleeps **after** a step, not fixed polling periods. Startup,
shutdown, worker deadlines and the 25 ms minimum consumer interval were unchanged.
The application library remains polled by its caller; this record does not claim
that the installed app uses either benchmark pause.

The primary order was A1 → B1 → B2 → A2, 30 seconds each with profiling and SQL
tracing off. Criteria required at least 3% higher median throughput, fewer median
replacements, equal offered counts, candidate p95 completion age no more than
baseline median p95 + 25 ms and no more than 1,000 ms, plus agreement on at least
2,500 common completed samples (matching counts/labels, box IoU ≥0.99, confidence
delta ≤0.001). Separate A/B profiles followed. A matched 120-second extension was
conditional on passing these criteria; **it was not run** after rejection.

All cases used the preceding 30 hash-verified local traffic recordings, cycled
through 100 independent source-clock-paced virtual decoders and four explicitly
admitted CUDA sessions. Model, preprocessing, current score threshold 0.1,
per-class NMS 0.45, nominal 2/source/s sampling, frame/stride handling, sample age,
task/byte limits, 2.5-second drain, journal bounds, consumer cadence and pruning
were unchanged. See the preceding record for those fixed settings and public
source/rights limits. These are low-resolution repeated recordings, not 100
distinct physical cameras or newly recorded internet feeds.

## Unprofiled result and decision

Each primary run offered 5,688 samples. Throughput counts only successes collected
inside the fixed 30-second window; later successes are retained as drain.

| Order | Pause ms | Completed | Analyses/s | Replaced | Drain | Pending | Step starts in window |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A1 | 0.5 | 4,747 | 158.23 | 854 | 4 | 83 | 28,859 |
| B1 | 2 | 4,633 | 154.43 | 968 | 5 | 82 | 8,179 |
| B2 | 2 | 4,811 | 160.37 | 792 | 4 | 81 | 8,218 |
| A2 | 0.5 | 4,972 | 165.73 | 624 | 4 | 88 | 28,784 |

Medians were **161.98/s A** and **157.40/s B**. Median replacements rose from
739 to 880, despite about 72% fewer step starts. Candidate p95 completion ages
531.69 / 531.19 ms passed the latency gate; the baseline median p95 was 534.36 ms.
The throughput and replacement gates failed. Both the positive latency result
and failed gates are retained. Two runs per variant on one busy owner PC do not
establish statistical certainty or a universal scheduling rule.

The A1/B1 traces shared **3,974 completed camera/sequence identities**, with
30,057 matched predicted boxes. Counts, labels and confidence scores agreed;
minimum box IoU was 0.9999999999999909 and maximum confidence delta was zero.
This compares predictions on matching deterministic replay samples, not boxes
against independent ground truth. It supplies no new accuracy or false-alert rate.

## Separate profiles and limits

| Profiled case | Offered | Completed | Analyses/s | Replaced | Drain | Pending |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A, 0.5 ms | 5,688 | 4,832 | 161.07 | 766 | 5 | 85 |
| B, 2 ms | 5,689 | 4,586 | 152.87 | 1,016 | 7 | 80 |

The profiled B case offered one additional boundary opportunity. These single
cases are diagnostic, separate from the equal-offer unprofiled comparison and
not a profiling-overhead estimate. Full aggregates and private receipt hashes
are retained in the JSON.

Profiled SQLite commit calls fell from 9,560 to 8,526, but fewer results were also
completed. Normalized by successes including drain, commits/outcome fell from
1.976 to 1.856. Average terminal group size moved only from 1.129 to 1.200 rows.
Commit spans totaled 8.636 and 7.746 seconds respectively. Fewer calls or commits
alone did not predict higher end-to-end throughput in this experiment. Longer
caller sleeps also change collection and dispatch responsiveness; this test
does not isolate an exclusive causal time budget.

Spans are inclusive, nested and concurrent; do not sum/subtract them as exclusive
elapsed time. Native forward includes runtime, copies and scheduling, not pure
GPU kernel time. Parent aggregates can include initialization, no-op calls and
drain. Both children supplied graceful final summaries. Snapshots precede the
last consumer-tail read/ack and database close/checkpoint, so those final storage
costs are excluded. Physical fsync counts and WAL high water were not measured.

## Execution, preservation and reproduction

All six replays had 100 active decoders, no reported source/experiment errors,
zero explicit failures, stale or budget drops, no remaining in-flight work and
reaped children. Each balanced:

`offered = completed + successful drain + replaced + stale + budget-dropped + failed + pending + in-flight`.

Every returned outcome had a committed journal ID; delivery IDs and camera
terminal ordering were unique, all delivered results were explicitly acknowledged,
and no unread outcome remained. Replaced/pending samples remain visible rather
than being counted as successes. Journals retained FULL/WAL, schema 1 and the
512-page checkpoint policy. Sampled combined parent/child RSS stayed below
1.93 GiB, with more than 80 GiB system RAM available, inside the unchanged
4 GiB / 2 GiB stop thresholds; these are sampled guards, not OS quotas.

Synthetic CUDA admission and each of the four sessions in every run proved 203
CUDA node events with TF32 and CPU fallback disabled. The existing RTX 5080,
driver and pinned environment were reused without installation. The inherited
guard denied IPv4/IPv6 creation with EPERM. All measured subprocesses and their
descendants used it. Metadata omits unrelated historical clip-selection fields.
Raw traces, private journals, model, recordings and source URLs remain local.

All five protected core files and the tested analyzer/profile/label files match
the preceding CPU/GPU agreement record. The original workspace's 289 file hashes
were unchanged. The baseline application's four post-merge CI workflows passed;
those hosted checks remain separate from native execution. No new unit-test or
100-frame CPU-reference run is claimed for this harness-only timing change.

The [exact runner](harness/run_cadence.py) uses the same existing owner-lab layout
as the preceding record. Copy its four harness modules into a fresh private
`qa-local/<new-run>/`, place an exact-source clone at `source/`, and copy the
preceding record's `core-source.json` to `frozen-core-before.json`. Existing model,
recordings/manifests, environment and guard are required. Review the plan before
running `python3 run_cadence.py`; output paths must be fresh. It performs no
downloads, installation, live capture or installed-app reconfiguration. The public
hashes and source snapshots do not reconstruct the private recording corpus.

```bash
python3 docs/verification/controller-cadence-2026-11-18/verify-results.py
python3 scripts/check-docs.py
python3 scripts/build-wiki.py --check
```

Further work should target the actual reservation/terminal transaction grouping
under a separately reviewed design, preserving reservation-before-IPC,
terminal-before-slot-release/delivery, FULL/WAL and unread recovery. The protected
core stays byte-identical under the current owner instruction; this negative
experiment supplies no authority to relax those guarantees or promote a pause.
Physical 100-camera/full-resolution capacity, field accuracy, recording continuity,
power-loss durability and 24-hour operation remain unqualified. Rollback removes
this dated record, checker call and guide/index mirrors; no application rollback,
migration, recording deletion or native Wiki publication is involved.
