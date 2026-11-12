# Science and mathematical improvements — November 11, 2026

Baseline: merged documentation head
`c517b438789efbe81d410f23f2a0a173ed72c86c` (PR #111).
Work is isolated in `science-math-workspace`; older checkouts and private runtime
data are preserved. See [science and algorithms](../../science-and-algorithms.md)
for primary research, equations, assumptions and follow-up experiments.

## Reproduced behaviors

[Generated before/after comparison](behavior-comparison.json) binds the immutable
baseline and uses prescribed detections, generated JPEGs and synthetic scores:

- At 0.21-second frame spacing, a still arrival never obtained a confirmed track
  in 35 baseline frames. The candidate confirms on frame 2 (zero-based), then
  follows it. Both versions use four detector calls for 35 still empty frames.
  The candidate intentionally samples occupied/recoverable states more often.
- Calibration person/empty scores of 0.53/0.51 and 0.514/0.512 both left the
  baseline threshold at 0.50. Empirical selection finds 0.53 and 0.514 respectively,
  preserving person finds while removing empty-room flags on the generated check.
  This demonstrates attainable operating points, not recognition quality.

## Exact association comparison

[Source-bound local experiment](association-comparison.json) uses five generated
300×300 matrices. Every case retains the baseline match count and total cost.
Three-object components reduce the Hungarian matrix-cell total from 90,000 to
900. Empty feasible graphs and one-sided components need no Hungarian solve;
dense graphs keep the original solver. Timings are descriptive local samples,
with warm-up excluded, not camera/inference/capacity evidence.

Reproduce into a **new** destination with an environment containing NumPy:

```bash
python scripts/compare-association-components.py --output /tmp/new-association-comparison.json
python -m unittest discover -s tests -p 'test_tracking*.py'
python -m unittest discover -s tests -p test_live_worker.py
node --test tests/training*.test.mjs tests/recognition.test.mjs
```

`test_tracking_association.py` checks every one of the 512 three-by-three
feasibility graphs with both tied and distinct costs, random rectangular graphs,
unbalanced components, isolated vertices and dense fallback. An independent
review also enumerated partial matchings for those small graphs. Match identities
may differ for tied optima; v3 and source hashes identify the changed tracker.

`test_live_worker.py` exercises the real JPEG/motion/tracker path with a Python
backend stub and prescribed detector output. It tests tentative confirmation,
lost recovery, exact expiry, exhausted summary caps, bounded retries and empty
keyframes. No ONNX detector is run by that suite.

Training tests compare the efficient empirical sweep with an exhaustive
operating-state oracle on 2,187 generated two-recording cases. They retain equal
session weighting, per-recording no-regression, fresh-check isolation, frozen
threshold values and exact exported/displayed cutoffs. A separate 612,000-score
generated stress case completed in 376 ms in the reviewer's local Node process;
this is a descriptive sample, not a supported library size or device benchmark.

## Boundaries

[Final local validation](validation.json) records source hashes, unchanged
protected files, build, 560 Python tests with loopback enabled, 559 passing Node
tests plus the two opt-in cases verified in an eight-test loopback rerun, four
Sites tests, 14 focused Chrome browser scenarios and documentation checks.
The initial browser attempt lacked Playwright's default headless-shell binary;
the existing Chrome channel was used without installing a browser. A new test
initially closed an already-open Advanced panel; correcting that duplicate test
click yielded the complete passing browser run. Neither was an application failure.

No cameras, private recordings, model downloads, installed-service replacement,
device setup or inference starts were needed for these repairs. The five pinned
runtime sources (`inference.py`, `journal.py`, `supervision.py`, `scheduler.py`,
`profiling.py`) and dependencies remain unchanged. The standard tracking-metric
adapter still uses the original dense solver. Old v1/v2 results remain readable;
current tracking evaluation requires re-analysis against the v3 method/hash.

These checks do not qualify physical-camera recognition/tracking accuracy, CUDA
execution, OEM compatibility, endurance, storage capacity or 100 simultaneous
cameras. Fresh calibration checks are paired empirical comparisons, not confidence
intervals or independent-frame statistical tests. Hosted CI, merge, Wiki publication
and installed state are separate from the local source checks recorded here.
