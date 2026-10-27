# Performance preparation for at least 100 simultaneous cameras

Owner requirement, 2026-10-27: **at least 100 concurrently active cameras** in a
locally deployed system without subscriptions or paid inference services. Five
generated scenes are UI fixtures, not a product capacity limit. The
[capacity target](../edge/capacity-target.json) records this decision separately
from workload values still requiring pilot decisions.

Current state: a single-recording analyzer, hash-bound YOLOX profile, evaluation
harness, reusable sample scheduler and synthetic load model. No live ingest,
recording service, GPU inference backend, distributed worker service or
100-camera hardware qualification is implemented or activated by this change.

## Separate the workloads

| Workload | 100-camera requirement | Qualification needed |
| --- | --- | --- |
| Connections | At least 100 simultaneously active admitted sources | Protocol/codec compatibility, reconnects, stable per-source health |
| Recording | Concurrent recording when required by the accepted pilot | Aggregate network/disk rate, retention, gaps, crash recovery |
| Analytics | Every enabled camera receives its configured analysis cadence | Measured per-camera service rate, missed samples, delays and quality |
| Human review | Source-linked observations, decisions and failures | Durable review storage, per-camera state, operator workflow |
| Browser views | Navigate all cameras; render a bounded selected subset | Search/grouping/pagination and preview budgets on desktop/mobile |

Connecting 100 streams, analyzing 100 streams at an agreed cadence and rendering
100 full-resolution videos are different capacity tests. The first two form the
core system target; the browser should use selected layouts and low-cost previews.
No analysis FPS, codec/resolution, maximum delay or hardware purchase is silently
selected. Those fields remain null in the capacity target until qualified.

## Implemented scheduling foundation

`edge.scheduler.CameraScheduler` accepts an explicit inventory, including 100 or
more IDs (up to 10,000 for this component). It offers:

- One newest pending sample per camera; replacements keep the waiting position.
- A shared, bounded worker-slot count and at most one in-flight sample per
  camera, preserving ordered results for later per-camera rules integration.
- Fair FIFO dispatch: a busy camera's next sample goes behind cameras already
  waiting. High-rate sources cannot repeatedly cut the queue.
- Individual sample-size and total retained-payload byte ceilings, counting
  both pending and in-flight samples; budget rejection is explicit.
- Sample-age checks before dispatch, explicit source admission, monotonic
  sequence/time validation and completion/failure token accounting.
- Per-camera counters for received, accepted, replaced, stale, budget-dropped,
  dispatched, completed and failed work, plus queue/worker/payload high-water marks.

The scheduler is thread-safe and creates no capture, inference or worker threads.
Future adapters submit immutable byte payloads and execute returned `Work`
items in separately bounded workers, then return each token. Omit explicit
`now` in threaded use so the shared monotonic clock is read inside the lock.
The default payload bound fits 640×640×3 byte images, not raw 1080p buffers or
float32 model tensors. Decoders, preprocessing, workers, results and copies
outside the scheduler need separate memory budgets. A retained-payload limit is
not a process-memory ceiling or native-code sandbox.

Expiry is checked at dispatch. Hung in-flight workers have no hard timeout or
cancellation here; future process supervision is a separate requirement. The
scheduler is deliberately not wired into the recording analyzer: dropped or
skipped samples can change dwell behavior and detection quality, so that
integration needs its own ordered, per-camera trace and gap/reset tests.

## Reproduce the load model

Only the Python standard library is required. From the repository root:

```bash
python3 -m edge.capacity --cameras 100 --sample-fps 2 --workers 8 \
  --service-ms 650 --duration-seconds 10 \
  --output /tmp/dvr-100-source-simulation.json
python3 -m unittest discover -s tests -p 'test_*.py'
```

Use a new output path each time. `--service-ms` is required to make the assumed
constant worker cost explicit. The model advances a virtual clock, submits all
cameras on each sampling tick and drains pending work. It uses synthetic text,
not frames, decoded media or model outputs. Reports bind scheduler/simulator
code hashes, assumptions, counters, modeled completion age and overload. They
always keep actual camera capacity and target-host performance unqualified.
The simulator permits 1–10,000 sources for ramp tests, 1–256 abstract workers,
up to 60 offered seconds and at most 200,000 offered samples per invocation.

The 650ms example is an assumption, not a new model timing measurement or an
owner-workstation benchmark. It offers 2,000 samples from 100 sources in ten
seconds. Eight ideal workers can service only about 12.31 samples/second against
200 offered; the model exposes replacement/expiry rather than treating eventual
service to all IDs as a capacity pass. A separate 10ms assumed-cost case clears
the same offered load without replacement, and still establishes no real FPS.
Tests also exercise threaded admission/completion, byte bounds, source fairness,
staleness, failures and a 125-source case so 100 is not a hard-coded maximum.

## Budget before optimizing

For `N` cameras, analysis cadence `f` samples/camera/second and measured service
cost `s` seconds/sample, offered demand is `N*f`; an ideal isolated worker has
capacity `1/s`. At planned utilization `u`, the abstract worker-equivalent count
is `ceil(N*f*s/u)`. Parallel contention, batching and decode costs invalidate
simple hardware extrapolation; this is a planning equation, not a core/GPU count.

| Illustrative workload, not accepted settings | Arithmetic |
| --- | --- |
| 100 cameras × 2 analysis samples/s | 200 inference samples/s aggregate |
| 100 cameras × 30 analysis samples/s | 3,000 inference samples/s aggregate |
| 100 streams × 4 Mbit/s recording bitrate | 400 Mbit/s incoming; 50 MB/s writes; 4.32 TB/day before overhead/replicas |
| One 640×640×3 byte sample per 100 cameras | 117.19 MiB retained payload |
| Those pending samples plus 8 equally sized in-flight samples | 126.56 MiB payload, excluding all other memory |

Measure actual codec, substream, bitrate, frame rate, resolution, latency and
retention requirements before assigning network, CPU, GPU, RAM or disk budgets.
No finding here establishes that one particular workstation can satisfy them.

## Ordered enhancement plan

1. **Freeze the accepted workload.** Define per-camera source profiles, analysis
   cadence, recording/retention policy, maximum delays, acceptable losses and
   quality/error budgets. Keep labeled evaluation scenes held out from tuning.
2. **Instrument approved offline inference.** Extend traces with decode,
   preprocessing, inference, postprocessing and rule/review-delivery timings;
   measure memory, temperatures and sustained service rates on the target host.
3. **Qualify local acceleration.** Evaluate a local GPU backend and batched
   execution behind explicit profiles. Preserve the pinned YOLOX hash, COCO80
   order, source/license records and decoder semantics. Require CPU/accelerated
   box/score/geometry parity and labeled-scene quality before adoption. No new
   backend, quantization or model substitution is silently enabled.
4. **Integrate bounded workers.** Add supervised worker processes, bounded input
   and result queues, fair routing, cancellation/restart, freshness deadlines,
   per-camera rule state and deterministic receipts. Requalify dwell/max-gap
   behavior under explicit frame loss. Keep recording separate from sample drops.
5. **Add a governed local ingest/recording service.** Use explicit source
   admission and private credential handling, per-source reconnect/backoff and
   health, protected APIs, retention and disk backpressure. Credentials/stream
   URLs must not reach the hosted UI or Git. No automatic activation is implied.
6. **Scale across local worker hosts when measured capacity requires it.**
   Partition camera ownership explicitly; preserve sequence ordering, source
   hashes, worker-version receipts, bounded queues and failure isolation. A
   larger worker count alone is not evidence of faster inference.
7. **Scale the review workspace.** Add source search/groups and paged layouts,
   capped active previews, offscreen suspension and event virtualization. Replace
   editable browser-local history with durable authenticated review storage
   before operational reliance. Keep pending decisions and failures visible.
8. **Qualify 1 → 5 → 25 → 50 → 100+ simultaneous sources.** Begin with approved
   offline replay, then separately authorized physical-camera tests. Include
   disconnects, noisy/high-motion scenes, empty scenes, low light, worker loss,
   disk pressure, UI load and long-session recovery. Record per-camera delivered
   cadence, replacement/expiry rates, queue age, end-to-end p50/p95/p99, recording
   continuity, resource use and labeled quality. Set a soak duration in the
   accepted pilot plan; do not declare support from a brief synthetic test.

The existing [evaluation harness](offline-evaluation.md) remains the source for
annotated-frame precision/recall and human-adjudicated false alerts per reviewed
camera-hour. It can evaluate up to 100 distinct camera recordings in one manifest,
but pooling their sequential traces is not a concurrent-load test. All promotion
to an operating capacity claim requires actual execution evidence and human review.
