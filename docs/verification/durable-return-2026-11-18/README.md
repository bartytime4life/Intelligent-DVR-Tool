# Worker-end age and durable parent-return latency

November 18, 2026 owner-local date. Tested source:
[c707962acdfa8c73e85d9588526cef3f0f43fd4f](https://github.com/bartytime4life/Intelligent-DVR-Tool/commit/c707962acdfa8c73e85d9588526cef3f0f43fd4f).
[Results](results.json) · [Plan](plan.json) · [Source/input bindings](source-bindings.json) ·
[Runtime](environment.json) · [Instrumented harness](harness/recovery_replay.py).

Post-run review of the [rejected controller-pause trial](../controller-cadence-2026-11-18/README.md)
found an important metric boundary: `completion_age_ms` is computed inside the
worker at processor completion. It excludes result serialization/IPC, parent
collection, terminal journal commit and caller return. Its latency gate passed
for that worker-end metric; it did **not** qualify durable-delivery latency.
The original plan, decision, numerical receipts and executed harness remain
unchanged. The 2 ms candidate remains rejected on throughput/replacements.

This follow-up adds parent-side observation in a new private harness and runs
one descriptive 120-second baseline at the retained 0.5 ms post-step sleep.
It adopts no optimization and specifies no latency service-level acceptance target.
All five protected application modules remain byte-identical.

## What the clocks measure

For each successful `ProcessWorkers.step()` return, the parent samples the
same-host Linux monotonic clock immediately after the call and requires a
positive committed `journal_id`. The existing journal contract commits the
terminal row before returning the outcome. This observes the configured FULL/WAL
API boundary, not physical power-loss durability or downstream consumer storage.

| Metric | Start → end | Important exclusion |
| --- | --- | --- |
| Worker-end age | Source-clock `captured_at` → child processor end | Result IPC, parent collection/terminal commit/return |
| Durable parent-return age | Same `captured_at` → parent clock immediately after `step()` returns | Explicit consumer read/acknowledgment and later review |
| Post-worker return gap | Child processor end → that parent-return clock | This is an elapsed interval, not exclusive attribution to SQLite or IPC |

The gap is computed **per sample** as return age minus worker-end age, then
percentiles are calculated. It is not the difference of marginal percentiles.
Nearest-rank percentiles use index `ceil(q*n)`. Parent observation reuses the
existing post-step window clock; it adds trace arithmetic/fields without changing
the library or journal body. Observer overhead was not calibrated, so this is not
a throughput comparison against earlier runs. The new parent fields stay in the
private measurement trace and are not retroactively written into committed rows.

For stop drain, the observation is after `close()` returns and can include its
cleanup wait. Those outcomes are counted separately and excluded from the
in-window throughput and latency distributions below.

## Observed baseline

The same 30 hash-verified saved traffic recordings were cycled through 100
independent source-clock-paced virtual decoders and four CUDA sessions. Fixed
model/preprocessing/threshold, bounds, consumer cadence and pruning match the
preceding trial. Profiling and SQL tracing were off. This is not 100 distinct
physical cameras, a live network test or full-resolution recording qualification.

The run offered **22,497** opportunities and completed **19,768** inside 120 seconds
(**164.73/s**). Four successes arrived during drain; **2,684 were replaced** and
**41 remained pending**. Explicit failures, stale/budget losses, in-flight work,
source/experiment errors and worker restarts were zero. All children were reaped.
The complete identity is `22,497 = 19,768 + 4 + 2,684 + 41`.

| Successful in-window population, n=19,768 | p50 ms | p95 ms | Maximum ms |
| --- | ---: | ---: | ---: |
| Worker-end age | 369.16 | 534.22 | 628.88 |
| Durable parent-return age | 372.94 | **543.58** | 632.53 |
| Paired post-worker return gap | 3.45 | **7.01** | 125.18 |

These distributions are conditional on successful in-window returns. Replaced
or pending samples have no completion latency and are not silently assigned zero.
They do not say that 95% of **all offered** analyses completed by 543.58 ms.
All 100 virtual camera contexts produced successes, ranging from 126 to 223 each;
the largest per-context p95 return age was 572.01 ms. This does not establish an
equal per-camera analysis rate or a guaranteed deadline.

Every observed parent-return age was at least its paired worker-end age, all
measurements were finite and all 19,772 success IDs including drain were positive
and unique. All were explicitly acknowledged, with no unread journal outcome
left. SQLite remained FULL/WAL, schema 1, checkpoint cadence 512 pages. Sampled
combined parent/child RSS reached 2.016 GiB and available system RAM stayed above
77 GiB, within the existing 4 GiB / 2 GiB sampled stop guards. These are not OS quotas.

Synthetic admission and all four sessions proved CUDA execution (203 startup node
events each), with CPU fallback and TF32 disabled. The existing RTX 5080, driver,
model and environment were reused. The inherited guard denied IPv4/IPv6 creation
with EPERM; the measured processes and descendants ran under it. No package,
driver, host setting, service, camera, installed app or application default changed.

## Validation, reproduction and next gate

The new runner checked paired clock order, finite measurements, positive/unique
committed IDs, exact opportunity accounting, acknowledgments, policy and child
cleanup. Export recomputed percentiles from the private traces and compared them
with the harness summary. Source/runtime/model/input and private-trace hashes
bind the record. All five frozen modules and the tested analyzer/profile/label
files match the preceding records. The original workspace's 289 file hashes
were unchanged. No new unit-test, CPU-reference or accuracy run is claimed.

The [runner](harness/run_return.py) uses the existing owner-lab layout. Copy the
four harness modules into a fresh private `qa-local/<new-run>/`, place the exact
source clone at `source/`, and copy the earlier `core-source.json` to
`frozen-core-before.json`. Existing frozen media/manifests, pinned model/runtime
and offline guard are required. Review the plan, then run `python3 run_return.py`.
It creates new receipts only; no downloads, live capture or installed-app changes.
Public files do not reconstruct the private recording corpus.

```bash
python3 docs/verification/durable-return-2026-11-18/verify-results.py
python3 scripts/check-docs.py
python3 scripts/build-wiki.py --check
```

A future performance candidate must predeclare and measure the **parent durable
return** boundary as well as throughput/loss, rather than reuse worker-end age as
its delivery-latency gate. Transaction grouping still requires a separate reviewed
design that preserves reservation-before-IPC, terminal-before-slot-release/return,
FULL/WAL and unread recovery. The protected core remains frozen. No latency SLA,
physical 100-camera/full-resolution capacity, field accuracy, recording continuity,
power-loss durability or 24-hour operation is qualified here. Media, weights,
raw traces and private journals remain local. Rollback removes this addendum,
checker/link changes and generated mirrors; no runtime rollback or data deletion
is needed, and no native Wiki publication is included.
