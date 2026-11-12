# Consumer, numerical and rehearsal checks

This package records generated geometry checks of the ground-visibility proposal.
The final core SHA256 is
`9207e0aeab51e2578cab9f3f82f28aa0fcd6cd3f1714a2bac5350a451587cf36`.
The coverage adapter SHA256 is
`ee7a36dcfc79ee8c4d5c5fc9e12e71a47a13d0debd0ef0e0897312de8f46c9a2`.
[The manifest](manifest.json) pins every package file, decompressed fixture and
current source/dependency file used by these checks. Application-wide checks and
publication state belong to the [parent record](../README.md).

## Replay from a fresh checkout

Use Node 22 and run `npm ci` at the repository root. No Python packages, cameras,
media, models, external maps or inference are needed. Then run:

```bash
node docs/verification/ground-frustum-math-2026-11-12/consumer-review/check-wall-scenes.mjs --require-pass
node docs/verification/ground-frustum-math-2026-11-12/consumer-review/check-adapters.mjs --require-pass
node docs/verification/ground-frustum-math-2026-11-12/consumer-review/benchmark-rehearsal.mjs --require-pass
```

Each command prints its receipt path and a small summary. Receipts default to
files in the operating system's temporary directory. `--output PATH` selects a
receipt file. Scripts check decompressed input hashes and report before/after
source hashes. `--require-pass` writes the receipt before exiting nonzero on a
failed assertion or source/configuration guard. Without that flag a failed
mathematical check remains a diagnostic receipt with exit zero; input or runtime
errors still fail. Timings naturally vary between executions.

Replay the captured before source with the identical checker and corpus:

```bash
node docs/verification/ground-frustum-math-2026-11-12/consumer-review/check-wall-scenes.mjs --baseline --require-pass
```

This command is **expected to exit 1**, with 1,402 failed prepared-point queries.
It decompresses the exact captured `c2f8e13a…` module into a temporary directory
and changes only its relative import locations to this checkout's helpers.
Its original source digest is checked before execution. It does not replace
application source. The resulting baseline receipt identifies both the evaluated
historical module and current helper/dependency bytes. The committed
[baseline receipt](baseline-wall-scenes-proof.json.gz) preserves all failures.

## Frozen 250-scene corpus and precision comparison

[wall-scenes.json.gz](wall-scenes.json.gz) contains all 250 ordinary generated
camera/five-rectangle-wall scenes and their query points, frozen before candidate
computation. Its decompressed SHA256 is
`128b21e094b8447cb26af51780e035103217fcb3c6e887a644d4eed926e3fdbb`.
No case was removed after a refusal or mismatch.

[The checker](check-wall-scenes.mjs) uses independent world-space vector
projection and constant-world-axis wall-plane intersections. It compares those
answers with a separate polygon winding predicate, then compares prepared
production queries with that predicate. It also checks the strict wire/source
binding gate, finite in-range vertices, visible area within the unoccluded
footprint, and runs the same geometry at 80 and 120 decimal places.

[The final receipt](wall-scenes-proof.json) reports:

- 250 available, wire-valid scenes; 94,758 assertions; zero failures.
- 42,374 eligible world-ray/polygon queries and 42,374 prepared-query comparisons.
- 9,010 finite in-range output vertices; maximum 80/120 visible-area difference zero.
- Source/dependency bytes unchanged during replay and decimal configuration restored.

Only the declared circle chord band, `r > range*cos(pi/256)`, is excluded from
ideal-circle point membership checks. Area and wire checks still cover every
scene. The checker is a finite corpus and sampled predicate comparison, not a
complete topology proof or a universal numeric error bound. All point queries
are retained in the compressed input, including those excluded by that rule.

The [pre-fix query receipt](historical-query-before-fix.json.gz) retains 1,402
incorrect prepared-query answers on source `7c0e5395…`. The captured `c2f8e13a…`
baseline independently reproduces the same count. The inherited edge test mixed
length and squared-length units: tiny positive edges acquired distant visibility
halos. The fix uses `|cross| <= delta*L` and
`dot in [-delta*L, L*L + delta*L]`, and skips redundant zero-length edges.
It preserves tiny positive polygons and closed boundaries; it does not snap
coordinates or delete positive features to make the corpus pass.

Earlier diagnostic artifacts remain separate:

- [Plane-mask failures](historical-plane-mask-failures.json.gz): 99/250 refusals.
- [Projected-quad failures](historical-projected-quad-failures.json.gz): 33/250 refusals.
- [20-place comparison](historical-precision20.json): four refusals; its 41,699
  evaluated points exclude unavailable scenes. [80-place comparison](historical-precision80.json):
  no refusals or mismatches, 42,374 evaluated points.
- [Collapsed-output receipt](historical-collapsed-output.json.gz): the earlier
  source `e8206460…` had 13 structurally invalid replies; exact-zero cleanup
  subsequently removed represented zero-area traces.

These artifacts retain their original bytes and historical source hashes where
recorded. The early plane/quad and precision diagnostics did not capture a full
source manifest; they are investigation history, not final reproducible pass
receipts. The final checker and captured query baseline have explicit hashes.

## Distinct-camera area and route adapters

[adapter-inputs.json.gz](adapter-inputs.json.gz) freezes 100 generated rectangle
MultiPolygon domains. [The checker](check-adapters.mjs) evaluates each at bearings
0°, 73° and 137°, translated to (1750, -1700): **300 cases, 3,900 assertions,
zero failures** in [the receipt](adapter-proof.json).

An independent cell partition computes area seen by at least one or two distinct
cameras. Independent route parameter splits compute covered, overlapping and
blind arclength, including repeated passages and contiguous blind stretches.
Cases include overlapping fragments of one camera, multiple camera IDs, holes,
separate components and routes along closed hole boundaries. The fixture
comparison tolerance is `1e-7` for transformed area/length values, not a general
accuracy bound. Unknown enabled views remain unavailable in focused unit tests;
these adapter fixtures test successful geometry rather than optical calibration.

Read-only adapter review found no blocker: fragments are grouped by camera
before overlap thresholding; open hole interiors are subtracted from route
intervals while closed boundaries remain visible. Shared work exhaustion and
nonfinite/invalid results withhold numeric totals. Work counters bound submitted
operations/vertices and observed output, not execution time inside a Boolean call.

## Rehearsal performance without fewer observations

[The benchmark](benchmark-rehearsal.mjs) reads two frozen 500-camera plans from
[rehearsal-inputs.json.gz](rehearsal-inputs.json.gz): one shared geometry, one
500 distinct overlapping bearings. Both use mount 100 m, tilt 89°, H/V view
170°/150°, range 30 m and 101 explicit route positions. It checks exact row-output
hashes, repeated results and camera-observation counts against the captured
baseline. It has no speed-based pass criterion.

The portable [performance receipt](performance-proof.json) measured:

| Scene | Before first query | Final first query | Final warm query | Camera observations |
| --- | ---: | ---: | ---: | ---: |
| Shared geometry | 2,422.60 ms | 3.50 ms | 2.73 ms | 50,500 |
| Distinct bearings | 3,578.06 ms | 133.90 ms | 17.83 ms | 49,502 |

The distinct-bearing count reflects inscribed-circle endpoint geometry and is
identical before/after. [An earlier final-source run](original-final-benchmark.json)
is retained separately. Each scene's baseline/final row digests match exactly:
`ed5f4042…` shared and `f8ae88cb…` distinct; full hashes are in both receipts.
Preparation preserves original coordinates, uses conservative edge bins and
bounding boxes, and shares queries only for identical geometry references while
retaining all camera IDs and their order. Immutable snapshots can reuse prepared
data; mutable callers prepare fresh data. These local timings are descriptive,
not camera throughput, physical visibility, inference capacity or latency guarantees.

[Focused TAP](focused-tests.tap) records 50 passes, zero failures/skips across
core, integration, visibility-task and coverage-task tests. Added tests cover the
direct radius guard, tiny triangles, zero-length edges, holes/gaps, camera order,
mutable input changes and both shared/distinct geometry preparation. The async
suite also covers source changes, cancellation, deadlines and malformed replies.

All evidence here is generated metadata and ideal level-ground geometry.
It does not qualify field optics, physical wall measurements, recognition,
private recordings, installed services, GPU throughput or 100-camera operation.
