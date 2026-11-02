# Offline tracking evaluator validation — November 2, 2026

Base: merged PR #75, `041b22277de0077b42c154e3e69a70d1387b6b55`.

Scope: local CLI, tracking/detection contracts, reference metric arithmetic,
synthetic tracker integration and documentation. No footage, camera, model or
network was used by the evaluator. No existing review decisions were changed.

[Machine-readable record](summary.json) binds the implementation and test files.
The test environment was the available Linux Python 3.14.4 / NumPy 2.3.5 runtime;
this local run does not establish Windows, macOS or physical-device acceptance.
The existing CI workflow separately runs Python tests on Linux/Windows with its
pinned runtime; inspect the PR's actual check results before claiming those pass.

## Local checks

```bash
PYTHONPATH=tests:. python3 -m unittest \
  test_tracking_evaluation test_tracking test_evaluation test_edge test_wiki_docs -v
python3 scripts/check-docs.py
python3 scripts/build-wiki.py --check
```

The focused suite passed **72 tests**, including 20 tracking-evaluator tests.
This includes 160 exhaustive small-assignment comparisons, known-answer metric
cases, four deterministic scenarios using the actual tracker, rejection of
misaligned/missing/invalid labels and references, independent-label declarations,
source binding, synthetic/real separation, weighted aggregation, local-only
execution and non-overwriting outputs. The 160 comparisons are cases within one
test, not 160 extra tests. Documentation links, media/evidence checks and generated
Wiki source mirrors passed. No Wiki publication or application deployment occurred.

| Known-answer metric case | MOTA | IDF1 | HOTA |
| --- | ---: | ---: | ---: |
| Perfect supplied path | 1 | 1 | 1 |
| Two IDs swap halfway through 4 frames | 0.75 | 0.5 | sqrt(1/3) |
| One correct, one missed, one false path | 0 | 0.5 | sqrt(1/3) |
| One path, 0.5 IoU | 1 | 1 | 10/19 |

These are evaluator arithmetic checks on synthetic metadata. The
[operator guide](../../tracking-evaluation.md) gives the actual-tracker synthetic
results, independent local-label format, metric implementation/adaptation details
and the procedure for future owner-approved recordings. Tracking accuracy on
physical cameras, identity verification and multi-camera capacity remain
unqualified. Equal-optimum assignment ties can differ from SciPy's choices;
no blanket external-benchmark parity claim is made.
