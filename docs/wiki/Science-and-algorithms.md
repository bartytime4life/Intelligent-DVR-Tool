# Science and algorithms

This guide connects the delivered mathematics to the problems it solves. The
[November 11 checks](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/science-math-2026-11-11/README.md) use generated
scores, pixels and assignment matrices. They establish software behavior, not
physical-camera accuracy, detector throughput or 100-camera capacity.

## Preserve valid planar reference geometry

A homography maps image points to a single measured plane using homogeneous
coordinates: `s * [east, north, 1] = H * [u, v, 1]`. Multiplying all entries of
`H` by the same nonzero number does not change that map. The
[OpenCV explanation](https://docs.opencv.org/4.13.0/d9/dab/tutorial_homography.html)
describes both bottom-right-entry and unit-Frobenius normalization.

Forcing the denormalized bottom-right entry to one incorrectly refused the safe
map `east = 1/u, north = v/u` on a reference square with `u` from 0.2 to 0.8.
Its horizon at `u = 0` lies outside that working region. Calibration now keeps a
unit-Frobenius matrix and uses scale-relative projection/horizon checks.
Conversely, five or more references mapping to one ground line could previously
produce tiny fitting and withheld errors while collapsing a ruler distance to
zero. A ground-plane transform must also be nonsingular; residuals alone cannot
establish that geometry. Checks operate in normalized coordinates so changing
the local ground origin does not itself create a rank failure.

The [calibration guide](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Planar-calibration) and
[generated projective checks](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/calibration-projective-math-2026-11-12/README.md)
keep the independent-marker, operator-declaration, residual-tolerance and
no-extrapolation gates. They do not establish physical marker accuracy, lens
calibration, depth or survey acceptance.

## Choose a useful detection threshold

A detector score is an ordering signal, not a calibrated probability that a
person is present. A threshold is an operating point: accepting weaker scores can
find more people and can also create more empty-room flags.
[Fawcett's ROC analysis](https://www.math.ucdavis.edu/~saito/data/roc/fawcett-roc.pdf)
explains the trade-off and constructing empirical operating points from sorted
scores. The implementation does not calculate detector AP/mAP or fit probabilities.

The previous 0.05 grid could miss a useful setting: with person scores of 0.53
and empty-room scores of 0.51, a current threshold of 0.50 accepts both, while any
threshold in `(0.51, 0.53]` separates them. Even a 0.01 grid misses narrower gaps.
The training optimizer now considers the observed score boundaries, alongside
the bounded manual grid and preferred margin. It preserves the exact suggested
value through display, fresh checking, export and explicit application.

For calibration session `i`, let `TPR_i(t)` be the fraction of person-present
samples accepted at threshold `t`, and `FPR_i(t)` the fraction of empty-room
samples accepted. Selection maximizes:

```text
J(t) = mean over calibration sessions of [TPR_i(t) - FPR_i(t)]
```

This is equivalent to maximizing mean session balanced accuracy. Equal weight
for the two conditions and for each session is an explicit product choice, so a
long recording cannot outweigh all shorter ones merely by adding samples.
Candidates must retain person detections, avoid any per-recording regression and
improve at least one calibration count. Equal objective values prefer the shared
empty-room margin. A sorted sweep avoids recounting every sample at every cutoff.

Saved fresh checks remain regression guards, outside optimization. The chosen
current/trial pair is frozen before a new recording; both are scored on those
same new frames. [Official threshold-tuning guidance](https://scikit-learn.org/stable/modules/classification_threshold.html)
explains why selection and validation data must be separated. This is an empirical
session comparison, not a significance test. Adjacent video frames are dependent;
many frames do not imply many independent trials. Dependence can make naive
confidence intervals too narrow, as demonstrated by
[Bakshy and Eckles](https://arxiv.org/abs/1304.7406). A separate recording still
shares camera, person and lighting conditions; it does not prove generalization.

## Schedule samples from lifecycle state

The motion gate should save detector work on an empty, still scene. It must also
provide the observations needed to confirm a new track or recover a recently lost
one. The [author's ByteTrack implementation](https://github.com/FoundationVision/ByteTrack/blob/d1bf0191adff59bc8fcfeaa0b33d3d1642552a99/yolox/tracker/byte_tracker.py)
keeps unconfirmed tracklets for subsequent association; returned confirmed output
does not include all internal state.

Previously, a tentative track was invisible to the gate. At 0.21-second sampling
intervals, a still new arrival could wait 2.10 seconds for the next keyframe,
exceed the 2-second lost limit, then start tentatively again forever. The gate now
asks whether **any unexpired tentative, tracked or lost association** needs a
sample. This includes states beyond the numbered-summary cap. Queries do not
extend a track's lifetime. After the existing recovery window expires, still-scene
keyframes resume. Detector work can increase during that recovery window; this
fix does not change the two-session live-AI bound or start inference automatically.

## Reduce assignment work exactly

After class and IoU gating, tracks and detections form a bipartite graph. A
feasible edge is a permitted match with its existing cost. No edge joins distinct
connected components, so a matching is the union of component matchings:

```text
maximum feasible match count = sum of component maximum match counts
minimum cost at that count   = sum of component minimum costs
```

The tracker solves sparse components independently, uses the minimum-cost edge
for one-row/one-column components, and leaves isolated vertices unmatched. It
retains the original Hungarian solver for dense graphs. It never truncates
candidate lists or prunes a feasible edge. This is an implementation derived from
the graph decomposition above, not an implementation of SciPy's sparse solver.
The [official SciPy matching documentation](https://scipy.github.io/devdocs/reference/generated/scipy.sparse.csgraph.min_weight_full_bipartite_matching.html)
describes the graph/cost formulation and the trade-off between dense and sparse
solvers; no SciPy dependency was added.

With 300 generated objects in 100 disconnected three-object groups, the
Hungarian submatrices total 900 cells rather than 90,000. An all-infeasible graph
needs no Hungarian solve. Dense graphs retain their original dimensions, and the
full IoU/gating matrix is still allocated. Local timings are descriptive samples,
not concurrent-camera or inference benchmarks. Equal-optimum ties can select a
different valid set of pairs. Method `bytetrack-style-iou-kalman-v3` and the source
hash bind the changed tracker; old v1/v2 review results remain readable, but current
tracking evaluation requires fresh source-matched traces.

## Measure the route by covered distance

Counting regularly spaced points can overestimate or miss narrow coverage.
Instead, intersect every route segment with the drawn ground-fan polygons and
measure the resulting intervals. This uses the distinction between a point and
a positive-length segment described in the
[CGAL intersection reference](https://doc.cgal.org/latest/Kernel_23/group__intersection__linear__grp.html).
The [Shapely manual](https://shapely.readthedocs.io/en/stable/manual.html#geometric-objects)
also distinguishes planar curve length from surface area. Neither library is
added as a dependency here; the route-specific implementation uses interval
clipping and an endpoint sweep.

For segment `j`, let `L_j` be its length and `N_j(t)` the number of distinct
camera footprints covering its normalized position `t`, including their edges:

```text
route length   = sum_j L_j
covered length = sum_j L_j * integral_0^1 [N_j(t) >= 1] dt
overlap length = sum_j L_j * integral_0^1 [N_j(t) >= 2] dt
coverage       = covered length / route length
```

Polygon crossings divide each segment into intervals where that count is
constant. Union intervals belonging to the same camera before counting distinct
cameras. Shared vertices use half-open crossing parity; collinear polygon edges
contribute positive boundary length and isolated touches contribute none.
Fully collapsed zero-area fans are ignored. Repeated/backtracking passages count
on every visit, preserving the route’s traversal rather than spatially merging
it. The longest uncovered run continues across route vertices.

The old 0.5 m sample grid reported 100% for eleven narrow fans on a 5 m route.
Their drawn coverage is `20 * tan(2.5 degrees) = 0.873218858… m`, or about 17.5%.
The [independent generated checks](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/route-coverage-math-2026-11-12/README.md)
compare the implementation with rational rectangle clipping and analytic cases.
Floating-point tolerance is relative to coordinate scale and capped relative to
segment length; tiny roundoff-scale gaps can coalesce. A nearly collinear edge
can be treated as closed boundary even if raw binary vertices sit a few rounding
units on its opposite side; an exactly coincident route is sensitive to that
choice. The small errors in ordinary oracle cases are not a universal error bound.
Outdoor zone percentages still use a bounded grid. The separate handoff
rehearsal defaults to `max(2, min(601, ceil(route_length_metres) + 1))`
distance-spaced positions and assumes 1.4 m/s. Its simulated duration is
`route_length_metres / 1.4`; the UI uses an integer playback multiplier for
simulations longer than 60 seconds. These sampled proposals are not actual
tracking, and exact integration of drawn polygons does not establish physical
visibility. [Rehearsal documentation correction](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/documentation-alignment-2026-11-12/README.md).

## Bind metrics to evaluated bytes

Detection and tracking metrics must identify the same data they evaluate.
[Evaluation captures each bounded JSON input once](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Offline-evaluation#what-the-report-measures),
then parses and hashes those exact bytes. Tracking compares its second-stage
manifest/trace captures with the hashes already validated. Source media keeps
a streamed validation-time SHA-256 check; it is not copied or decoded by this
binding. The report's `input_binding` describes these semantics, without claiming
an atomic multi-file snapshot or loaded-code provenance.
[Generated replacement-race evidence](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/evaluation-binding-2026-11-11/README.md)
checks consistency independently of detection quality.

## Next experiments need independent observations

- Compare v3 with the prior tracker using the existing [CLEAR/IDF1/HOTA evaluator](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Tracking-evaluation)
  on owner-approved, independently labeled clips, including still arrivals,
  occlusion, crossings, scene changes and low-score boxes. Generated continuity
  tests cannot supply those quality labels.
- Evaluate [OC-SORT](https://openaccess.thecvf.com/content/CVPR2023/html/Cao_Observation-Centric_SORT_Rethinking_SORT_for_Robust_Multi-Object_Tracking_CVPR_2023_paper.html)
  observation-based recovery and [BoT-SORT](https://arxiv.org/abs/2206.14651)
  motion/state improvements as separately measured candidates. They are not enabled
  by these repairs; appearance models, camera-motion estimation and new tuning
  costs need separate evidence.
- Repeat training across deliberately different recording sessions and conditions,
  freezing thresholds before each fresh check. Use recording/site grouping when
  planning uncertainty analysis; do not randomly split neighboring frames and
  claim independent validation.
- Qualify capture, recording, analytics cadence and visible tiles separately on
  the intended hardware using the [100-camera plan](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/100-camera-plan).
  Faster assignment alone cannot establish that workload.

---

[Canonical source](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/science-and-algorithms.md) · Generated companion; dated evidence, examples and illustrations retain their labels.
