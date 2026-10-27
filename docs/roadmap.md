# Build the next claim with evidence

[Home](../README.md) · [Verification](verification/2026-10-27/README.md) · [100-camera plan](performance-100-cameras.md)

The minimum capacity goal is **100 simultaneously active cameras**. Five generated scenes are interface fixtures, not the product target.

| Lane | Exists now | Next evidence required |
| --- | --- | --- |
| Review | Wall, queue, notes, history, rules and exports | Accessibility/mobile/long-session acceptance; durable authenticated records |
| Facility | Buildings/floors/rooms/labels, cameras, estimates and rehearsal | Site measurements, optical calibration and qualified visibility |
| Easy setup | GPS suggestion, area fields, OSM simple-way drafts, seven shapes | Live-provider qualification, complex geometry/holes, address search |
| Detection | Offline ONNX adapter; prior YOLOX-S compatibility probes | Independent labels, precision/recall, false alerts and held-out scenes |
| Performance | Bounded scheduler, budgets, synthetic overload model | Sustained decode/inference/end-to-end rates on intended hardware |
| 100-camera operation | Owner requirement and staged acceptance design | Ingest/recording/worker implementation and simultaneous-source qualification |

## Priorities and acceptance

1. **Define the workload.** Agree resolution, codec, recording/retention, analysis cadence, maximum delay, allowed loss and quality targets. “100 cameras” alone is not a sufficient benchmark.
2. **Build representative evaluation.** Use approved recordings with independent labels and reviewed alert coverage. Separate tuning/final scenes. The synthetic corpus checks arithmetic only.
3. **Measure the intended host.** Instrument decode, preprocessing, inference, postprocessing, rules and delivery. Report p50/p95/p99, resource use and sustained duration.
4. **Qualify acceleration and workers.** Preserve profile semantics, compare outputs and labeled quality, test fairness, stale work, failures and per-camera ordering. The scheduler currently creates no workers.
5. **Implement local ingest and recording.** Admit sources explicitly, protect credentials, handle reconnects and disk/retention budgets. Distinguish recording gaps from analytics drops.
6. **Scale 1 → 5 → 25 → 50 → 100+ sources.** Test disconnects, overload, low light, motion, worker loss, disk pressure, UI load and recovery. Record each camera's delivered service and recording continuity.
7. **Complete operational acceptance.** Add durable records where required; finish authentication, retention, accessibility and long-session checks before operational reliance.

No finish dates or hardware guarantees are implied. Use [pilot scope](pilot-scope.md) for decisions and the [performance guide](performance-100-cameras.md) for budgets.

## Read the load model correctly

The fresh 100-source simulation offers 2,000 synthetic samples over ten virtual seconds. With eight assumed 650 ms workers it completes 144, replaces 1,780 and expires 76. With assumed 10 ms service it completes all 2,000. These are modeled outcomes, not measurements of either model or hardware.

Both retain `concurrent_camera_capacity: unqualified`. Serving every source eventually does not satisfy an analysis cadence. [Raw reports and commands](verification/2026-10-27/README.md#100-source-load-model).
