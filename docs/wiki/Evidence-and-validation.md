# Evidence record · October 27, 2026

[Repository](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Home) · [Visual tour](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Visual-tour) · [Machine-readable summary](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/2026-10-27/summary.json)

This record describes fresh execution for the documentation refresh. Application, edge and test sources were synchronized from GitHub main **`5fbb604cd0a2962a0bb830fefe8475a161a9b737`**. [Source SHA-256 and Git blob hashes](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/2026-10-27/source-hashes.json) identify the tested files. Documentation scripts and the new CI check are additional refresh changes.

## What ran

| Check | Actual result | Evidence |
| --- | --- | --- |
| JavaScript domain/facility/starter tests | 27 passed; 0 failed, 0 skipped | [Node log](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/2026-10-27/node-tests.log) |
| Sites Worker packaging tests | 4 passed; 0 failed, 0 skipped | [Packaging log](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/2026-10-27/sites-tests.log) |
| Python unittest discovery | 55 run: 47 passed, 8 skipped, 0 failed | [Python log](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/2026-10-27/python-tests.log) |
| Production build | Completed; chunk-size warning retained | [Build log](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/2026-10-27/build.log) |
| Synthetic annotation evaluation | Completed; 4 annotated fixture frames | [Evaluation JSON](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/2026-10-27/evaluation.json) |
| 100-source overload and idealized models | Both completed, qualification remains unqualified | [Overloaded JSON](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/2026-10-27/overloaded.json), [idealized JSON](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/2026-10-27/idealized.json) |
| Documentation integrity | Local links/heading targets, media hashes/byte budget and result/log consistency checked | `python3 scripts/check-docs.py`; rerun this check on changes |

The local test executor used Node.js **22.13.1** and Python **3.14.4**. Native `cv2`, `numpy` and `onnx` were unavailable, so eight inference/profile integration tests skipped. Skips are not passes. This sweep did not obtain model weights or rerun the pretrained model. The existing CI installs native test dependencies on Python 3.12; its result must be read separately for the exact refresh commit.

Default Node test isolation did not expose the individual suite assertions in this restricted executor. An initial packaging invocation failed. The counted results come from the same test files rerun in single-process mode, with packaging checked after the completed build. The earlier attempts are not counted as successful suite runs. Normal ordered CI remains build → tests → packaging.

## Reproduce

From the repository root:

```bash
npm ci
npm run build
npm test
npm run test:sites
python3 -m unittest discover -s tests -p 'test_*.py'
python3 scripts/check-docs.py
```

Install `edge/requirements-test.txt` in an isolated Python environment for the native synthetic integration cases. These remain synthetic contract checks even when they pass.

If the executor blocks child test processes, run the same JavaScript files in one process:

```bash
node --test --experimental-test-isolation=none \
  tests/domain.test.mjs tests/facility.test.mjs tests/facility-starter.test.mjs
node --test --experimental-test-isolation=none tests/sites-worker.test.mjs
```

Recreate reports using **new output paths**; the CLIs refuse to overwrite evidence:

```bash
python3 -m edge.evaluate \
  --manifest tests/fixtures/evaluation/manifest.json \
  --reviews tests/fixtures/evaluation/reviews.json \
  --output /tmp/dvr-documentation-evaluation-new.json
python3 -m edge.capacity --cameras 100 --sample-fps 2 --workers 8 \
  --service-ms 650 --duration-seconds 10 \
  --output /tmp/dvr-documentation-overloaded-new.json
python3 -m edge.capacity --cameras 100 --sample-fps 2 --workers 8 \
  --service-ms 10 --duration-seconds 10 \
  --output /tmp/dvr-documentation-idealized-new.json
```

## 100-source load model

Both simulations offer 100 source IDs × 2 samples/s × 10 virtual seconds = **2,000 synthetic samples**, using eight abstract workers and a 2-second dispatch-age bound.

| Assumed service time per sample | Completed | Replaced by newer sample | Expired before dispatch | Modeled overload |
| --- | ---: | ---: | ---: | --- |
| 650 ms | 144 | 1,780 | 76 | Yes |
| 10 ms | 2,000 | 0 | 0 | No |

These counters come directly from the committed reports. Completion includes queue drain after the offered interval. Payloads are synthetic text, and the clock is virtual. No video decoding, model execution, camera networking, disk recording, GPU contention or browser workload is measured. The 10 ms row is an assumption, not an achieved optimization. Both reports keep actual camera capacity, hardware performance and recognition accuracy unqualified.

The result is useful because it makes overload visible. Eventual service to all source IDs does not establish the requested analysis cadence. [Scaling design](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/performance-100-cameras.md).

## Evaluation arithmetic

The four annotated synthetic frames produce these fixture results:

| Class | TP | FP | FN | Precision | Recall |
| --- | ---: | ---: | ---: | ---: | ---: |
| person | 2 | 2 | 1 | 0.5 | 2/3 |
| car | 1 | 1 | 0 | 0.5 | 1 |
| bicycle | 0 | 0 | 0 | null | null |

The supplied timing values produce p50=20 ms and p95=40 ms. Those values were **provided by the fixture, not measured by this run**. Its supplied false-alert decision yields 900/camera-hour from four seconds of synthetic coverage; that demonstrates a formula, not an operating false-alert rate. [Method and limits](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/offline-evaluation.md).

## Browser observations

Actual screenshots were taken from the existing local preview in a dedicated in-app browser tab. [Media provenance](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/media/README.md) identifies the capture revision and matching main-branch display components. The restricted executor could not start another listening development server; no fresh exact-main production preview is claimed.

| Interaction | Observed outcome | Scope |
| --- | --- | --- |
| Open Monitor and sample review dialog | Four-view wall, queue, rule, score and review controls rendered | Generated sample scenes |
| Enter note and confirm Loading Dock observation | Queue changed 2 → 1; visible save message; history showed Confirmed | Browser-local sample decision |
| Open Zones | Numeric geometry, dwell/threshold and save/simulate controls visible | Panel inspected; no new detector execution |
| Open Facility | Map/3D buildings, camera inventory and six-step guide rendered | Fictional local-grid plan |
| Scrub rehearsal 0 → 30 seconds | Marker, coverage text and timeline changed; at ~15 s C-07 was in estimated view | Planned route; no observed person |
| Add L wing, U wing and Round | Building count changed 3 → 4; geometry/dimensions updated | Explicit planning inputs |
| Undo each added shape | Original three-building plan restored; Undo became disabled | Demonstration edits reversed |
| Expand OSM starter | Bounds, network disclosure, offline import and attribution visible | No live lookup, GPS or provider-availability test |

The sweep did not complete mobile, screen-reader, room-drawing keyboard, long-session, live-provider or physical-camera acceptance. Existing room drawing requires a pointer. The sample date shown in captures is fixture text.

## Build and review limits

The fresh build emitted a lazy facility JavaScript chunk of about **1.79 MB minified / 476 kB gzip** and a Vite warning. This is a package-size observation, not a load-time or frame-rate measurement. Documentation media stays under a separate 3 MB integrity budget and is outside `public/`, so it is not added to application assets.

A structured code/documentation review checked the refresh for changed runtime behavior, untrusted input, external media dependencies, fabricated screenshots, unsupported capability language and broken navigation. Runtime application/edge code is unchanged by the refresh; the new scripts only compose local screenshot artifacts and validate documentation. The CI workflow adds one standard-library documentation check. No full security scan or security certification is claimed.

Historical model evidence remains in the [October 26 report](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/model-qualification-20261026.md) and its original JSON files. That evidence establishes a selected pretrained artifact's compatibility on synthetic inputs and a generated recording, not representative-scene accuracy, target-host latency, five-camera throughput or 100-camera operation.

## CI follow-through

Both [push CI](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/40559417348) and [PR CI](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/40559454533) completed successfully at refresh commit `a00c9c76a1ada57eb786a23778e1c1bcaab3547a`. GitHub's runner installed the native test dependencies. **27 JavaScript + 4 packaging + 55 Python = 86 tests passed, with no skips.** Build, documentation integrity and wiki-mirror checks also passed.

[Machine-readable CI result](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/2026-10-27/ci-results.json) · [Timestamped test-log excerpt](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/2026-10-27/ci-test-excerpt.log). This addendum updates the evidence presentation; application and edge code remain unchanged. Read the workflow for later documentation commits separately. Native cases use synthetic ONNX/recording fixtures and do not establish representative recognition accuracy, real camera compatibility or 100-camera throughput.

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/2026-10-27/README.md) · Documentation refresh: October 27, 2026.
