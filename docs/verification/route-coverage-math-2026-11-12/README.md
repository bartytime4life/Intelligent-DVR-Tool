# Route coverage by arclength — November 12, 2026

This change integrates on merged source
`cd6d15666beb55a9641068398d82a3d02eaa7769` (PR #112). The former coverage module
is byte-identical to historical baseline
`c517b438789efbe81d410f23f2a0a173ed72c86c`; the reproducer checks that identity.
Inputs are generated plan coordinates, not camera footage or surveyed sites.
The later [documentation integration](documentation-integration.json) records
merged documentation source `65ec81166f7b4c7577e415c757e4696459012d63`, unchanged
algorithm/UI hashes and regenerated 68-page Wiki outputs. Original validation
counts above that integration remain bound to their original source.

## Reproduced errors

| Valid plan | Former point-count result | Arclength result |
| --- | --- | --- |
| Eleven 5° camera fans at 0.5 m spacing along a 5 m route | 100% | 17.464377…%; 0.873218858… m covered |
| One 25° fan centered between the endpoints of a 0.5 m route | 0% | 88.677865…% |
| A 0.25 m route touching the fan only at its initial endpoint | 50% | 0%; isolated point has zero length |

Each case uses a validated facility and the existing `coverageFan` geometry.
The first analytic result is `20 * tan(2.5 degrees)` metres, divided by the
5 m route length. The [rectangle comparison](rectangle-oracle.json) retains both
baseline/candidate results, source hashes and oracle errors.

## Method and bounds

Each nonzero route segment projects the polygon vertices into along/across-route
coordinates. Half-open line crossings pair into interior intervals; collinear
edges add closed boundary intervals. Intervals are clipped to the segment, united
per camera ID, then swept to measure lengths covered by at least one and two
distinct cameras. No candidate camera or route segment is sampled away.
The [science guide](../../science-and-algorithms.md#measure-the-route-by-covered-distance)
gives the integral and primary geometry references.

Positive-length edges of a noncollapsed fan count; isolated touches and fully
collapsed zero-area fans do not. Zero-length route segments add no distance.
Repeated/backtracking traversal counts each passage. Blind runs join across
vertices, including duplicate vertices. The UI reports uncovered distance and
longest continuous gap in the selected metric/imperial units; it keeps the
planning disclaimer and unsaved-camera preview behavior.

Arithmetic tolerance is eight machine epsilons times the coordinate/arithmetic
scale, capped at `segment_length * 1e-10`. It is not a fixed metre grid. Positive
gaps above that tolerance remain. Compensated sums reduce accumulated distance
error. Almost-collinear raw binary vertices can snap to a closed boundary; a
route exactly on that line can gain or lose a long boundary interval under tiny
coordinate perturbations. The independent polygon checks retain this sensitive
case separately from strict interior agreement. Rectangle errors are not a
universal geometric error bound. A generated maximum-size plan exercises all 199 nonzero route segments,
500 cameras and 9,751,000 fan edges without mutating inputs. This is a bounded
geometry check, not a concurrency or camera-capacity benchmark.

The outdoor zone grid and its uncovered-cell overlay are unchanged. Its
20,000-cell limit is distinct from route integration. The separate 61-position,
30-second handoff rehearsal remains a simulated proposal and was not changed
into tracking or physical visibility evidence.

## Reproduce and interpret

```bash
node --test tests/facility-route-coverage.test.mjs tests/facility-planning.test.mjs
python3 scripts/compare-route-coverage.py --output /tmp/new-route-oracle.json
npm run build
DVR_TEST_SOCKETS=1 npm test
npm run test:sites
DVR_BROWSER_CHANNEL=chrome npx playwright test --config=playwright.facility.config.mjs facility-camera-planning.spec.mjs
python3 scripts/build-wiki.py --check
python3 scripts/check-docs.py
```

Use the existing prepared browser environment; the optional Chrome channel is
distinct from CI’s pinned Chromium. Proof output must be a new path. The oracle
uses Python’s `Fraction` slab inequalities for 500 rectangle cases, independent
of the general polygon crossing implementation. Cases include distinct/shared
camera IDs, zero-length vertices, diagonals and repeated traversal. Analytic
tests additionally cover concave fans, tangencies, boundaries, winding,
rotation/translation and small positive gaps. Generated browser regressions
check the corrected 17.5% and gap wording at 1440 and 375 pixels.

The separate [polygon oracle](polygon-oracle.json), reproduced by
`python3 scripts/check-route-polygons.py --output NEW_FILE.json`, splits segments
at exact rational line/edge intersections and classifies interval midpoints.
It checks 454 strict-comparison cases, including actual pinched/occluded fans,
concave rings, traversal and tiny gaps, and retains six nominal-boundary
diagnostics without asserting strict raw-binary equality there. Twelve
above-tolerance offsets agree. These sensitive cases remain visible in the
receipt rather than being counted as ordinary scalar agreement.

[Validation](validation.json) records actual checks and source hashes. All
experiments are generated. Drawn polygon integration is a ground-plane planning
estimate; it does not prove optical calibration, detection quality, identity,
indoor visibility, real-camera performance or 100-camera capacity. Protected
runtime/hosting files and dependency versions remain unchanged. Generated Wiki
sources and source PR state are separate from Wiki publication, merge and an
installed application.
