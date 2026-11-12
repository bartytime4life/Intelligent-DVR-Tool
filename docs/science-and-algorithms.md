# Science and algorithms

This guide connects the delivered mathematics to the problems it solves. The
[November 11 checks](verification/science-math-2026-11-11/README.md) use generated
scores, pixels and assignment matrices. They establish software behavior, not
physical-camera accuracy, detector throughput or 100-camera capacity.

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

## Next experiments need independent observations

- Compare v3 with the prior tracker using the existing [CLEAR/IDF1/HOTA evaluator](tracking-evaluation.md)
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
  the intended hardware using the [100-camera plan](performance-100-cameras.md).
  Faster assignment alone cannot establish that workload.
