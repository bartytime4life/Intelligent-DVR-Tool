# Science and algorithms

This guide connects the delivered mathematics to the problems it solves. The
[November 11 checks](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/science-math-2026-11-11/README.md) use generated
scores, pixels and assignment matrices. They establish software behavior, not
physical-camera accuracy, detector throughput or 100-camera capacity.

The current branch adds a [visible-ground proposal](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/ground-frustum-math-2026-11-12/README.md)
on top of the unmerged pixel-density and zone-area proposals. The model below
describes this branch; [product status](https://github.com/bartytime4life/Intelligent-DVR-Tool/wiki/Product-status) keeps it separate from
the merged baseline and installed software.

## Project the visible ground footprint

An ideal pinhole camera has a rectangular image plane. Intersecting that view
with the ground generally does not produce a radial sector. Sensor edges depend
on forward camera depth, low walls cast finite shadows and a steeply tilted image
can include ground behind its mount. The projection starts from the
[OpenCV camera model](https://docs.opencv.org/4.13.0/d9/d0c/group__calib3d.html)
and [projective camera geometry](https://pbr-book.org/4ed/Cameras_and_Film/Projective_Camera_Models);
the following ground and wall construction is derived for this planner.

Let `X` be horizontal right, `Y` horizontal forward along the entered bearing,
`h` the mount height, `theta` downward tilt and `R` horizontal range:

```text
D = Y cos(theta) + h sin(theta)       camera-axis depth
V = h cos(theta) - Y sin(theta)       vertical image numerator

D > 0
|X| <= tan(HFOV/2) D
|V| <= tan(VFOV/2) D
X² + Y² <= R²
```

Five linear half-planes clip a local, range-normalized 256-sided inscribed
polygon. Its largest inward radial error from the true range circle is
`R * (1 - cos(pi/256))`, at most about 0.0226 m for an allowed 300 m range.
This is a declared geometric approximation, not a tolerance for optical error.
An independent ideal-circle point check retains two exact-circle-boundary
disagreements; its raw strict result is retained as a failure in the record.
The ideal image-edge predicate allows only scale-relative arithmetic roundoff.

For a vertical opaque wall with horizontal endpoints `A`, `B`, base `b` and
top `t`, projection from the mount scales the segment outward. If `b < h`, the
shadow starts at scale `h/(h-b)`. When `t < h`, it ends at `h/(h-t)`;
otherwise it extends beyond the range boundary. A wall entirely at or above the
mount casts no positive-area downward ground shadow. Shadows are clipped to a
proved containing square before union and subtraction. Low walls can create
holes, and elevated walls can split the visible ground into separate pieces.
The existing 0.5 m facade clearance is an explicit planning policy.

Method `pinhole-ground-shadows-v1` keeps the complete MultiPolygon for each
camera ID. One captured plan snapshot supplies map shading, selected-camera 3D,
DORI lines, zone areas, route distance, sampled rehearsal and installer SVG.
Closed visible-polygon boundaries, including shadow-hole boundaries, use one
shared convention. A diagnostic exact 3D ray can classify an occluding boundary
differently; it does not silently replace the displayed polygon in another view.

Projected vertices exposed reproducible reconstruction failures in the prior
Boolean engine and in ordinary finite precision. The branch pins
[polyclip-ts 0.16.8](https://github.com/luizbarboza/polyclip-ts)
and BigNumber.js 9.3.1, running synchronous Boolean operations with 80 decimal
places and restoring the caller's arithmetic configuration afterward. Decimal
conversion and division still have finite precision. Agreement at 80 and 120
places on the frozen generated corpus is evidence for those inputs, not a proof
for every valid polygon. Exact binary64 signed-area fallback distinguishes
truly collapsed output from small nonzero features without a metre-sized cutoff.

A separate point-membership audit found a dimensional error in the earlier
closed-edge tolerance: comparing area-like cross/dot products with an unscaled
length tolerance could give a tiny edge a many-metre halo. For edge length `L`
and arithmetic length tolerance `delta`, the corrected cross bound is
`delta * L`, and the dot interval is `[-delta * L, L² + delta * L]`.
Prepared edge data, conservative spatial bins and shared-geometry queries reduce
rehearsal work while retaining the same samples, camera order and closed boundaries.

Work caps bound half-plane and Boolean operations, edge visits and input/output
vertices. A disposable worker and ten-second elapsed-time acceptance gate reject
stale, cancelled, invalid and late snapshots. Partial geometry cannot yield a
total coverage claim, a rehearsal blind spot or an installer export. Source-bound
budgets, independent rational/ray checks and raw failures are in the
[geometry record](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/ground-frustum-math-2026-11-12/README.md).
Flat ground, ideal roll-free optics and modeled opaque walls still need physical
qualification; floor slabs, terrain, lens distortion and recognition are outside
this model.

## Project ground detail through the camera

The camera planner estimates **horizontal detail across a flat ground plane**,
perpendicular to the entered bearing. Under the
[ideal pinhole model](https://docs.opencv.org/4.13.0/d9/d0c/group__calib3d.html),
horizontal image position depends on camera-axis depth. Euclidean slant distance
can substitute for that depth only on the optical axis.

For horizontal resolution `W`, downward tilt `theta`, mount height `z`, forward
ground distance `Y` along the bearing and transverse ground coordinate `X`:

```text
fx                      = W / (2 tan(HFOV/2))
camera-axis depth Zc    = Y cos(theta) + z sin(theta)
horizontal image offset = fx X / Zc
horizontal px/metre      = fx / Zc
threshold ground limit  = (fx / threshold - z sin(theta)) / cos(theta)
```

The table clips the centreline interval to the modeled near/far view. Map
thresholds are straight ground lines perpendicular to the bearing, clipped to
the current visible-ground snapshot. A wall shadow can leave several disconnected
fragments; they are not joined across the shadow. The table describes the
nonnegative forward centreline before wall occlusion. Steep views can have rear
ground contours even when that table has no forward interval. Contours do not
change coverage or simulated rehearsal.

At height 4 m, tilt 60°, HFOV 90° and width 1920 pixels, an independently
projected transverse target at forward distance 0.5 m gives about 258.47 px/m.
The previous slant calculation gave 238.15 px/m and missed a positive 250 px/m
centreline interval. [Generated projection and contour checks](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/dori-projection-2026-11-12/README.md)
bind the correction to its source. The existing thresholds remain planning
figures, not recognition guarantees. That earlier record retains its original
radial-sector footprint. The current ground construction is described above;
ideal optics, roll-free pose and flat ground require separate physical validation.

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
Instead, intersect every route segment with the visible ground polygons and
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
cameras, subtracting strict hole interiors and retaining closed hole boundaries.
Shared vertices use half-open crossing parity; collinear polygon edges
contribute positive boundary length and isolated touches contribute none.
Fully collapsed zero-area pieces are ignored. Repeated/backtracking passages count
on every visit, preserving the route’s traversal rather than spatially merging
it. The longest uncovered run continues across route vertices.

The earlier radial-sector counterexample reported 100% from the old 0.5 m sample
grid for eleven narrow fans on a 5 m route.
Their drawn coverage is `20 * tan(2.5 degrees) = 0.873218858… m`, or about 17.5%.
The [independent generated checks](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/route-coverage-math-2026-11-12/README.md)
compare the implementation with rational rectangle clipping and analytic cases.
Floating-point tolerance is relative to coordinate scale and capped relative to
segment length; tiny roundoff-scale gaps can coalesce. A nearly collinear edge
can be treated as closed boundary even if raw binary vertices sit a few rounding
units on its opposite side; an exactly coincident route is sensitive to that
choice. The small errors in ordinary oracle cases are not a universal error bound.
Those historical fan dimensions remain in their dated record; they are not
recalculated as though they came from the new pinhole model. The zone-area
proposal below replaces the earlier outdoor grid. The separate handoff
rehearsal defaults to `max(2, min(601, ceil(route_length_metres) + 1))`
distance-spaced positions and assumes 1.4 m/s. Its simulated duration is
`route_length_metres / 1.4`; the UI uses an integer playback multiplier for
simulations longer than 60 seconds. These sampled proposals are not actual
tracking, and exact integration of drawn polygons does not establish physical
visibility. [Rehearsal documentation correction](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/documentation-alignment-2026-11-12/README.md).

## Measure zone coverage by area

A regular grid can miss gaps between its sample centres. A validated 10 × 1 m
zone crossing an ordinary fan edge has 90% covered area, yet the old grid reports
100%. A second camera covers a 10% strip between grid rows but produces 0% sampled
overlap. Narrow views repeated at grid centres can amplify this aliasing: a
validated 500-camera fixture reports 100% where the drawn fans cover about 0.175%.
These are generated numerical counterexamples, not observations of field failure.

For each camera ID, union its visible pieces and clip them to the zone. For a group
of distinct cameras, keep two masks: `U` for at least one view and `O` for at least
two. Combining disjoint camera groups A and B gives:

```text
U(A ∪ B) = U(A) ∪ U(B)
O(A ∪ B) = O(A) ∪ O(B) ∪ (U(A) ∩ U(B))
coverage = area(U) / area(zone)
overlap  = area(O) / area(zone)
blind    = zone \ U
```

Implementation first clips each footprint to a strictly expanded axis-aligned bounding
rectangle `B` containing the zone `Z`, then combines masks and clips final results
to `Z`. The identity `Z ∩ F = Z ∩ (F ∩ B)` preserves the measured set while removing
irrelevant arcs. Padding is 1% of each normalized bounding-box span, with a
32-machine-epsilon minimum; the zone itself is neither enlarged nor snapped.
This operation order avoids reproduced floating boundary-reconstruction failures.

The recurrence counts every point with at least two distinct cameras, including
triple overlap, exactly once as a set. A balanced merge avoids repeatedly scanning
one growing union. This branch uses the same pinned high-precision Boolean
wrapper as ground visibility, returning components with outer rings and holes.
The earlier area record used polygon-clipping 0.15.7, retained for other callers.
Area uses locally anchored,
compensated cross products, subtracting holes from their outer rings; the
[CGAL signed-area reference](https://doc.cgal.org/latest/Polygon/group__PkgPolygon2Functions.html)
describes the orientation convention. CGAL is not added as a dependency.

Method `polygon-area-v1` translates/scales a copied zone and footprints into a local
frame, integrates the resulting polygonal areas, and checks area ordering and
coverage-plus-blind conservation within a stated floating tolerance. Failed
geometry is unavailable, not zero. Collapsed pieces are excluded before clipping.
The blind overlay carries full MultiPolygon topology rather than grid rectangles.
These calculations now measure the captured pinhole ground regions, preserving
their holes and separate components. Polygonal range, wall and ground-plane
assumptions remain approximations of real visibility.

Per-zone and aggregate clipping budgets bound submitted operations and vertex
visits. Repeated identical zone footprints reuse their result within one plan.
The worker is disposable, rejects responses at or beyond a ten-second monotonic
elapsed-time deadline and is cancelled
when its plan is superseded or Coverage closes. The UI accepts only the current
plan/attempt response and clears old numbers/shading while it waits. Browser
scheduling can delay a timeout callback; the counters are computational limits,
not a proof of real-time performance or 100-camera ingest/inference capacity.

The [independent area record](https://github.com/bartytime4life/Intelligent-DVR-Tool/blob/main/docs/verification/zone-area-math-2026-11-12/README.md)
compares generated cases with exact rational horizontal-slab integration and
checks scalar areas, blind geometry, distinct-camera counts, invariance and
failure recovery. Numerical agreement does not establish optical calibration.

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
