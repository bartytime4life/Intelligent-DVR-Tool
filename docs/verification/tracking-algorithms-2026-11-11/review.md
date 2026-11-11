# Tracker review and draft readiness — November 11, 2026

The algorithm branch incorporates current main
`dfa0f3b6d7283842612718447d007b6dd949a592` (PR #106), including its Recognition
handoff fixes. The verification-index conflict was resolved by retaining both
records and regenerating the Wiki source. No installed service was changed.

## Review result

The review found and repaired one blocking integration defect: Recognition still
recomputed the legacy upper-middle median and rejected some valid v2 results.
Validation now uses the averaged median specifically for v2, preserving the v1
historical convention. Incorrect summaries for either version remain rejected.
The new Node and browser regressions failed before this repair and pass after it.
No blocking issue remains in this review; this is an in-session review, not
independent approval.

The source review covered prediction units and covariance composition, Joseph-update dimensions,
class-partition mapping in all three association stages, expiry/admission order,
path compaction endpoints and memory bounds, method/hash binding and historical
result readability.

The most important remaining risk is changed tracking behavior, rather than
detector behavior. Fifteen generated scenarios had identical reported tracking
metrics. The expiry scenario exposes a deliberate tradeoff: correct separation
of two visitors also leaves the returning visitor's first hit tentative. It must
not be described as an across-the-board accuracy improvement.

## Recognition compatibility repair

The generated browser case contains two person tracks lasting 0 s and 0.5 s.
The v2 result reports median 0.25 s (displayed as 0.3 s); v1 reports the historical
0.5 s. Before the repair, importing the v2 result raised `Invalid tracking class
summary` and never opened its review. Both versions now open, and a deliberately
wrong v2 summary still produces the validation error. Metadata-only results
remain visibly unverified until a recording is matched.

[Before repair](median-before.png) and [v2 review after repair](median-after.png)
show generated metadata only, with no recording attached.

[Review source hashes](review-source-hashes.json) bind the tracker, browser
validator, fixtures, tests and probe runner. The full Linux local checks after
integration are 540 Python, 543 Node, four Sites contract and seven browser tests
(four Recognition and three generated-camera live-AI cases), with no skips.
Production build and documentation checks pass. The existing Facility Studio
large-chunk warning remains. Hosted results belong to the draft PR, separately
from this local record.

## Source-bound evaluator comparison

[The probe runner](run-regression-probes.py) executes each source tree's own
tracker and full existing evaluator. It neither rewrites tracker references nor
passes a baseline trace off as a current-version result. Each receipt records
input/source/trace/manifest fingerprints, method, tracker hash, metric implementation
hashes and generated-data limitations. Matching input and synthetic-source hashes
were checked across all sixteen pairs.

- [Baseline receipt](regression-baseline.json): merged main at `dfa0f3b`.
- [Candidate receipt](regression-candidate.json): integrated source at `433a4e7`,
  whose tracker bytes are unchanged from `d6515dd`.

| Generated cases | Result |
| --- | --- |
| Crossing, temporary occlusion, departure/reappearance and confidence changes, each at 1, 2 and 5 Hz | All twelve reported metrics identical in all twelve cases |
| Approach/retreat with changing scale and prescribed detection jitter at 1, 2 and 5 Hz | All twelve metrics identical in all three cases |
| Different visitors at the same location, separated by track expiry | IDF1 improves; MOTA and HOTA decrease because the first new hit is tentative |

The expiry case has three labeled detections in four sampled frames. The baseline
incorrectly reuses the previous visitor's number. The candidate retires it before
matching and requires two hits to confirm the new visitor, as for other new tracks.

| Metric, ratios | Baseline | Candidate |
| --- | --- | --- |
| Tracked true positives | 3 | 2 |
| Missed tracked detections | 0 | 1 |
| Untracked detections | 0 | 1 |
| IDFP | 1 | 0 |
| MOTA | 1.0000 | 0.6667 |
| IDF1 | 0.6667 | 0.8000 |
| HOTA | 0.7454 | 0.7071 |
| Association accuracy, AssA | 0.5556 | 0.7500 |

This is a deterministic regression case, not a held-out physical-camera study.
It preserves the two-hit confirmation policy instead of tuning it to improve this
probe's score. A known-answer evaluator regression now covers the candidate's
two true positives, one miss, IDF1 0.8 and HOTA `1/sqrt(2)`.

## Test plan and remaining coverage

| Area | Check type and coverage target | Evidence or remaining gap |
| --- | --- | --- |
| Time model | Unit invariants for integer/fractional/zero time and stable repeated updates | Split prediction, propagated noise and 500 irregular updates covered |
| Association | Exact objective against full assignment, all score stages and class isolation | 100 randomized comparisons plus stage-specific mapping checks |
| Lifecycle/history | Expiry boundary, capacity release, tentative tracks and repeated compaction | Covered by tracker regressions; path remains deliberately coarse |
| Evaluation provenance | Each version evaluated with its own source/hash, identical prescribed input | Sixteen paired probes plus known-answer expiry metrics |
| Native workflow and saved imports | Generated camera, constant-output model, explicit Start/Stop and review transfer; v1/v2 saved-result validation | Seven browser checks, including the reproduced median rejection; these are not detector-quality evidence |
| Platform/release | Current Linux local build, suites and documentation; hosted Windows/Mac/install checks | Draft CI must be reported separately; no installation or release implied |
| Real tracking quality | Approved independently labeled held-out views, changing scale, lighting, crowds and irregular cadence | Still unqualified; no real recordings were accessed |

To reproduce, use the prepared project Python environment and clean source
checkouts containing the two revisions. The runner creates temporary metadata
fixtures and refuses to replace an existing output:

```bash
python docs/verification/tracking-algorithms-2026-11-11/run-regression-probes.py --source-root /path/to/baseline-checkout --output new-baseline.json
python docs/verification/tracking-algorithms-2026-11-11/run-regression-probes.py --source-root . --output new-candidate.json
```

The public draft contains code and generated metadata only. Cameras, private
recordings, models, enrollment templates and credentials remain local and untouched.
Merge, installation, native Wiki publication and real-camera qualification remain
separate actions.
