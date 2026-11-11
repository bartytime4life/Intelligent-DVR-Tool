# Tracking mathematics and bounded association — November 11, 2026

This local change starts from merged source
`914f0649b671e31879e5870808959a393dd004db` (PR #105). The original workspaces were
preserved; implementation is on `codex/mathematical-upgrades-20261111` in
`algorithm-upgrade-workspace`. [Source hashes](source-hashes.json) identify the
tested tracker, regression tests and comparison script. This record does not
establish hosted CI, merge, installation, deployment or field acceptance.

[Follow-up review](review.md) records integration with PR #106, sixteen paired
source-bound evaluator probes, and the explicit identity/confirmation tradeoff
at track expiry. Its later validation supplements the initial checks below.

## Reproduced defects and resulting behavior

The original tracker already used a Kalman filter and Hungarian assignment. The
upgrade repairs the time model, lifecycle, bounded history and summary arithmetic,
and reduces unnecessary association work. [The generated receipt](comparison.json)
compares both implementations on identical deterministic inputs.

| Generated check | Baseline | Candidate |
| --- | --- | --- |
| Same box after a 3 s gap with a 1 s expiry | Revives ID 1 | Returns unconfirmed; a second fresh match gets ID 2 |
| Last path point after 2,101 hits at 10 Hz | 199.9 s, while last observation is 210 s | 210 s; keeps the first observed point too |
| Median durations of 1 s and 9 s | 9 s | 5 s |
| Maximum covariance difference: predict 10 reference frames versus 4 then 6 | 225 | About 3.64e-12, numerical roundoff |
| Assignment cells, 300 objects in ten equal classes | 90,000 | 9,000 total; largest matrix has 900 cells |
| Assignment cells, 300 objects in one class | 90,000 | 90,000 |

The covariance comparison holds height fixed and makes no intermediate measurement
updates. It measures mathematical composition, not prediction error on footage.

## Mathematics and algorithms

For each position/velocity coordinate pair, let `t` be elapsed seconds times 30,
and `qp`, `qv` the squared position and velocity noise weights at the starting
height. The constant-velocity transition and integrated covariance are:

```text
F(t) = [[1, t], [0, 1]]
Q(t) = [[qp*t + qv*t^3/3, qv*t^2/2],
        [qv*t^2/2,        qv*t]]
P_predicted = F(t) P F(t)^T + Q(t)
```

This is the integral of `F(s) diag(qp, qv) F(s)^T` from zero to `t`. It accounts
for velocity noise propagating into position during an unsampled interval. At
fixed rates, `Q(a+b) = F(b) Q(a) F(b)^T + Q(b)`. The former `diag(q)*t` omitted
that propagated uncertainty. Height-dependent rates are frozen within each
prediction; partition invariance is not claimed when height changes. The reference
weights are a modeling choice, not statistically fitted noise estimates.

The Joseph measurement update uses
`P = (I-KH) P_predicted (I-KH)^T + K R K^T`, followed by symmetry averaging.
The gain still uses a linear solve instead of an explicit matrix inverse. Fixed
identity/zero blocks of `H` are evaluated by slicing to avoid unnecessary products.

Class-aware matching has no feasible edges between different labels, so the
optimization separates exactly into one Hungarian problem per shared class.
The number of computed similarities falls from `n*m` to `sum(n_c*m_c)`. Each
block maximizes feasible match count, then minimizes cost, preserving the global
objective. Row and column order remains deterministic within each block. The
same partitioning applies to confident, low-score and tentative association.
Malformed labels are rejected before tracker state changes.

Paths use deterministic dyadic sampling over hit order. The retained stride doubles
whenever the 2,000-point storage fills; compaction retains the first hit and every
other stored hit. The latest actual observation is kept separately. Final summaries
select at most 32 points including both endpoints. Memory remains bounded across
arbitrarily long runs; path detail decreases with run length. This is neither
time-uniform resampling nor an exact geometric reconstruction.

## Verification

- 43 focused tracker/evaluator tests pass, including 100 randomized comparisons
  with the full assignment objective, fractional/zero/split time predictions,
  500 irregular predict/update cycles, expiry boundaries and repeated path compaction.
- Full Python suite: 539 passed, zero skipped, with `DVR_TEST_SOCKETS=1`.
- Full Node suite: 536 passed, zero skipped, with `DVR_TEST_SOCKETS=1`.
- Sites worker contract: 4 passed. Production build passes with the existing
  large-chunk warning for Facility Studio.
- Three existing native analysis browser tests pass using Chrome, a generated
  camera and constant-output test model: explicit AI start, tracked overlay,
  manual Events handoff, Stop, restart and failed-still-save recovery.
- The in-app browser opened the local source preview on port 4307 and showed
  Monitor with zero receiving cameras and no active recording or AI.
- Documentation links, generated Wiki source and whitespace checks pass.

The first full Python attempt overlapped the production build and reached one
build-dependent test before `dist` existed. Re-running after build completion
passed. The final full run uses the completed build. No product workaround or
test weakening was added for this setup-order error.

The comparison script runs one warm-up plus seven descriptive update timings per
case. Its receipt includes local timings, Python/NumPy versions and both source
hashes. It is not a controlled performance study; matrix-cell counts are exact
for these generated inputs. No camera FPS, recognition accuracy, GPU execution
or 100-camera capacity is inferred from them.

Use the project's prepared Python 3.12 environment and existing Node dependencies:

```bash
npm run build
DVR_TEST_SOCKETS=1 python -m unittest discover -s tests -p 'test_*.py'
DVR_TEST_SOCKETS=1 npm test
npm run test:sites
DVR_BROWSER_CHANNEL=chrome npx playwright test --config=playwright.analysis.config.mjs live-ai.spec.mjs
python scripts/compare-tracking-algorithms.py --output new-comparison.json
python scripts/check-docs.py
python scripts/build-wiki.py --check
git diff --check
```

The comparison requires the baseline commit in local Git history and creates
receipts exclusively, refusing to overwrite an existing output. It opens no media,
models or devices. Validation used an existing local Python 3.12 environment;
no packages, weights or services were installed or replaced.

## Provenance and limits

Method changes to `bytetrack-style-iou-kalman-v2`, with the existing track schema.
Analyzer receipts already bind the tracker SHA-256. Old results remain readable;
the evaluator rejects old methods/hashes until explicitly re-analyzed. Historical
receipts are unchanged. The pinned inference, journal, supervision, scheduler and
profiling sources are byte-identical to the base revision.

The continuous-noise model changes prediction behavior and needs held-out labeled
tracking evaluation on representative camera views, especially for changing object
scale, occlusion and irregular cadence. These software checks do not establish
tracking accuracy, calibrated probabilities, physical OEM/device compatibility,
Windows/CUDA execution, durability, installed-machine readiness or capacity.
Track IDs remain within-camera continuity estimates requiring human review.

## Research references

- Bewley et al., [Simple Online and Realtime Tracking](https://arxiv.org/abs/1602.00763),
  2016: the existing Kalman/Hungarian tracking foundation.
- Zhang et al., [ByteTrack](https://arxiv.org/abs/2110.06864), 2022: the existing
  high-/low-score two-stage association approach; no benchmark score is transferred
  to this implementation.
- Roger Labbe, [FilterPy continuous white-noise documentation](https://filterpy.readthedocs.io/en/latest/common/common.html#filterpy.common.Q_continuous_white_noise):
  constant-velocity continuous-noise covariance. This implementation additionally
  retains independent position diffusion; no FilterPy dependency was added.
- Miller et al., [NASA/TM–20220007267](https://ntrs.nasa.gov/api/citations/20220007267/downloads/NASA-TM-20220007267.pdf),
  Appendix A, equation 23b: Joseph covariance update. The DVR state/noise model and
  path sampler are local implementation choices, not results established by that report.

SciSpace was consulted for related association research; no source, recordings,
camera configuration, enrollment templates or private files were uploaded.
