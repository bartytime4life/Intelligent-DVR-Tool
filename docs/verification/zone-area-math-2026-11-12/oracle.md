# Independent zone-area mathematics evidence

This is generated planning-geometry evidence. It tests area inside the drawn
polygonal camera fans, not calibrated camera visibility, detection accuracy,
physical installations or the 100-camera workload. No camera, model, inference,
private recording or network source was used.

## Frozen source and inputs

Base: `63b06ba2aab3adcffc38f52310b55969fb538afe`.

| Item | SHA-256 |
| --- | --- |
| Baseline coverage module | `122dce3ca246afea2cb66f816dae27b40f4baf5ee8bfd9bee1b2b6cac8d5bfad` |
| Passing candidate module | `0477c12aec149d25c1aa41a8f85df41bc92f415eeb0cd11ddaac9391c5d771eb` |
| Decompressed immutable corpus | `1cc1553b86d844df042fec7752afefb9bccd3fcd57e43a6bbc75d13e375b1089` |
| Deterministic gzip corpus | `0cb47e3acd2d186db1892e04e2e44e659fd19a36a37db91a7a3507a182cd1526` |
| Packaged checker | `8be922ff71164d15b097cc0cb10be3f772ca9f7f8a3eb2f49fdee4819cc3cd08` |

The 114-case corpus was frozen before the candidate implementation. It contains
every source fan vertex, validated generated plans for the camera cases and
baseline source hashes. Gzip has mtime zero and no source filename. Nothing was
removed or rounded for compression. The checker snapshots six source modules
and the already-installed public `polygon-clipping`, `splaytree` and
`robust-predicates` package bytes before Node execution. Receipts list hashes of
every copied dependency file; baseline source files are retained in `baseline-src`.
The baseline does not use the clipping package; copying it into that snapshot
does not imply it did. The candidate hash binds the live repository module at
the time of comparison, with the five unchanged facility dependencies.

## Independent mathematics

The Python oracle uses exact `Fraction` arithmetic on the binary rational values
represented by each input coordinate. Every vertex and segment-intersection
ordinate divides the plane into horizontal slabs. Within an open slab all edge
crossing orders are fixed, every endpoint is affine in height, and each covered
interval length is affine. Midpoint integration is therefore exact on each
slab; this is not a grid or a stochastic sample. Camera fragments are unioned by
ID before the sweep counts one or two distinct cameras.

All 114 expected scalar results use this arrangement. For 111 cases, a second
arrangement also includes every returned blind-polygon edge and integrates the
geometric symmetric difference from the expected uncovered region. Three larger
fan-vertex cases (`root-40-stripes`, `forty-duplicate-poses` and
`five-hundred-stripes`) omit that more expensive XOR check. They still check exact
expected scalars, complete returned-polygon area and 49 independent nonboundary
membership points each. Across the passing corpus there are 5,586 point checks.
Output area subtracts all holes and includes every disconnected component.

The separate convex reference uses exact rational half-plane intersections and
inclusion-exclusion, rather than line arrangements: 55 cases, 1,745 subset
intersections and 220 exact scalar equalities agree. The threshold-two subset
coefficient is `(-1)^k × (k-1)`, versus `(-1)^(k+1)` for ordinary union.

Production uses a balanced merge over disjoint sets of camera IDs. If `U_A/U_B`
are the child unions and `O_A/O_B` their two-camera regions, then
`U = U_A ∪ U_B` and `O = O_A ∪ O_B ∪ (U_A ∩ U_B)`. First unioning fragments of
the same ID is essential. The strictly expanded clipping guard contains the
actual zone, so discarding geometry outside the guard cannot change either
threshold set inside the zone. None of this qualifies the input camera model.

## Counterexamples and strict results

- A valid two-camera plan over a 10 m × 1 m zone reports 100% / 0% on the old
  grid, versus approximately 90% coverage / 10% overlap by area.
- Twenty narrow real generated fans over a 5 m × 0.25 m zone report 100% on
  the old grid, versus approximately 9.081476% by area.
- At the valid 500-camera limit, a 125 m × 0.008 m zone reports 100% on the old
  grid, versus approximately 0.174644% by area. This is a generated numerical
  case, not a hardware or camera-capacity test.

For the disjoint narrow-fan constructions, the zone lies between the inner and
outer fan boundaries. Only the two straight HFOV edges intersect it. The analytic
covered area is `n × tan(2.5°) × (h² - 2 × cameraY × h)`. This independently agrees
with the exact rational area of the represented fan vertices within arithmetic
roundoff. Repeated camera poses with distinct IDs also test overlap.

| Check | Baseline | Passing candidate |
| --- | --- | --- |
| Same immutable cases | 114 | 114 |
| Assertions reached | 3,282 | 8,437 |
| Failed assertions | 1,283 | 0 |
| Strict process exit | 1 | 0 |

Counts differ because invalid legacy blind-spot geometry cannot undergo the full
MultiPolygon assertions. Failures include new-contract/metadata checks and
overlapping arithmetic checks; they are not distinct bugs or field failure rates.
The strict gate existed in the first baseline run. Adding JSON/gzip input loading
later changed neither the mathematical code nor expected/observed bytes, and both
sides were rerun strictly with the packaged checker.

An earlier candidate was retained honestly: it returned `geometry-error` for the
ordinary two-camera fixture and `geometry-limit` for the sparse 500-camera case.
See `first-candidate-failure.json` and the compressed receipt. Those two expected-
success cases caused all 16 failed assertions. The passing revision handles both;
no input, tolerance or mathematical check was relaxed after that result.

The comparison tolerance is `max(5e-10 m², zoneArea × 5e-12)` for areas and
`5e-11` for fractions; metadata and resolution-invariance checks are exact.
Largest observed candidate differences are about 1.577e-11 m² for scalar area,
4.667e-15 for a fraction, and 3.661e-12 m² for blind-geometry XOR area. These are
finite-corpus observations, not universal floating-point error guarantees.

## Reproduce

From the repository root, with Python 3, Node and the existing pinned Node
dependencies installed, use fresh output folders. The baseline command is
intentionally expected to exit **1**. The checker accepts explicit `--inputs`
JSON/gzip paths and otherwise finds its adjacent corpus.

```sh
python3 docs/verification/zone-area-math-2026-11-12/check-zone-area.py --repo . --module docs/verification/zone-area-math-2026-11-12/baseline-src/facility-coverage.mjs --output /tmp/dvr-zone-baseline-replay --require-pass
python3 docs/verification/zone-area-math-2026-11-12/check-zone-area.py --repo . --module src/facility-coverage.mjs --output /tmp/dvr-zone-candidate-replay --require-pass
python3 docs/verification/zone-area-math-2026-11-12/check-convex-reference.py --output /tmp/dvr-zone-convex-replay.json --require-pass
```

The retained observation/expected hashes refer to decompressed JSON bytes.
`oracle-artifacts.json` additionally binds each packaged file's stored size/hash.
Replays use their own immutable source/input snapshots. Existing output folders
bound to different source bytes are refused.

## Numerical and resource limits

The installed [polygon-clipping 0.15.7 documentation](https://raw.githubusercontent.com/mfogel/polygon-clipping/v0.15.7/README.md)
describes a sweep algorithm dependent on both edge and intersection counts,
MultiPolygon holes/components, and global runaway guards. Those guards are not
UI latency guarantees. Its robust orientation predicates coexist with floating
intersections and near-coordinate snapping; it is not rational exact arithmetic.
The generated radial fans use consistently oriented positive-area lobes, so
pinches are compatible with its nonzero winding rule. Generic invalid self-crossed
polygons are not being promoted into supported facility zones.

Production therefore needs explicit work/output caps, recoverable unavailable
results and a disposable background worker. A response acceptance deadline can
reject a late result even when timer dispatch was delayed; a browser can delay
the actual termination callback. Preserve that distinction in timing claims.
Indoor-zone exclusions, fan construction, route arclength and simulated handoff
rehearsals remain separate contracts. An area calculation does not remove their
planning limitations or establish surveyed geometry.
