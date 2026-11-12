# Coherent pinhole ground visibility — November 12, 2026

This proposal replaces a radial-sector estimate with tilted pinhole ground
regions minus projected wall shadows. Every planner consumer uses the same
current-plan polygons, including their holes and separate pieces. A failed or
outdated estimate stays unavailable. Calculation adds no new editing, backup
or Undo restriction; existing Save/Discard guards still apply.

This is local generated-geometry and browser evidence. It does not qualify
physical optics, recognition, a 3D volume, installed services or camera capacity.
The [operator guide](../../facility-builder.md),
[mathematical reference](../../science-and-algorithms.md#project-the-visible-ground-footprint)
and [product status](../../product-status.md) describe behavior and scope.

## Source and lifecycle

The isolated branch starts from the unmerged zone-area proposal #121 at
`730df9a3e45d96bb9bf154e809bf8d03c10c4c64` and locally integrates the unmerged
pixel-density proposal #119 at `e1468c9b263b24c0cef045af86ce69ea263fc116`.
The local integration checkpoint is `96b37413abcf2ebe7692f4fa6bdb6338bf2fb70a`.
This does not merge either hosted PR. Main was freshly read as
`63b06ba2aab3adcffc38f52310b55969fb538afe`.

The [parent proposal readback](parent-proposal-status.json) records both PRs
open, draft and unmerged, with all four workflows successful at the stated read
time. Those workflows test their parent revisions, not this integration.
The [source manifest](source-manifest.json) and [local validation receipt](validation.json) identify the
bytes and environment tested for this proposal.

The primary checkout, private media and runtime stores are preserved. Protected
edge/runtime and hosting files retain their main bytes. No camera, recording,
inference, model download, installed-service replacement or deployment is part
of these checks. Wiki companions are repository outputs, separately unpublished.

## Reproduced geometric contradictions

The previous footprint uses common near/far radii on every viewing direction,
with sampled rays that stop at the first wall. These generated valid plans
expose differences from a rectangular pinhole image and finite-height shadows:

| Entered geometry | Earlier result | Ground-model result |
| --- | --- | --- |
| Mount 20 m, tilt 45°, H/V view 90°/30°, range 250 m; zone corners (7.7,9.1)–(8.9,10.3) | 100% zone coverage | Outside the ideal image: 0% |
| Same camera; zone (25,25)–(26.2,26.2) | 0% | Inside the ideal image: 100% |
| Mount 4 m, tilt 75°, vertical view 60°; small zone behind the mount | 0% | Rear ground is inside the image |
| Mount 4 m; opaque wall at forward 5–6 m, base 0 m/top 2 m | Map/zone/route can disagree with the independent line of sight | A finite shadow can leave visible ground beyond it |
| A raised opaque wall, base 2 m/top 6 m | First-obstruction truncation hides ground unnecessarily | Ground beneath the wall can remain visible before its shadow |

Coordinates above use a camera at the origin, bearing north. Full fixtures,
queries and strict original outcomes are retained in the independent package.
These are numerical counterexamples, not measured field failure rates.

## Ground and shadow construction

For local ground coordinates `X` right and `Y` forward, mount height `h`,
downward tilt `theta` and horizontal range `R`:

```text
D = Y cos(theta) + h sin(theta)
V = h cos(theta) - Y sin(theta)

D > 0
|X| <= tan(HFOV/2) D
|V| <= tan(VFOV/2) D
X² + Y² <= R²
```

The implementation clips five half-planes against an inscribed 256-sided range
polygon in normalized local coordinates. Maximum inward radial chord error is
`R * (1 - cos(pi/256))`, about 0.0226 m at 300 m. The circular range is therefore
approximated conservatively. An independent strict ideal-circle point gate
retains two exact-boundary disagreements; the record does not relabel that raw
gate as passing. Approximation-aware assessment is separate and declares its
eligibility rule independently of observed results.

A wall segment with base `b < h` starts its ground shadow at scale `h/(h-b)`.
When its top `t < h`, the shadow ends at `h/(h-t)`; otherwise it extends beyond
the bounded ground view. A wall entirely at or above the mount casts no
positive-area downward shadow. Shared projected wall vertices and a proved
containing square bound the construction before shadow union and subtraction.
The existing 0.5 m facade-mount policy stays explicit. Doorway gaps/lintels
participate; exterior glazing remains opaque. Floor/roof slabs, terrain,
furniture, lens distortion and lighting are outside this model.

Method `pinhole-ground-shadows-v1` returns complete MultiPolygons. Closed visible
boundaries include shadow-hole boundaries. Route overlap counts distinct camera
IDs after unioning that camera's intervals and subtracting strict hole interiors.
The point-ray diagnostic can differ on a wall boundary; all displayed consumers
use the regularized polygon convention instead of mixing definitions.

## Numerical choices and failure behavior

Projected shadows reproduced Boolean reconstruction errors in the previous
engine. The new pinned wrapper uses polyclip-ts 0.16.8, BigNumber.js 9.3.1 and
transitive splaytree-ts 1.0.2. Every pre-existing lockfile package record is
retained; only those three package records and the two direct dependencies are
added. The old polygon-clipping package remains for existing callers.
[Distributed notices](../../../public/licenses/ground-visibility-LICENSE.txt)
are bundled with the app.

Boolean operations use 80 decimal places synchronously, restoring the caller's
BigNumber configuration even on failure. Inputs are decimal interpretations of
binary64 values; division and output conversion are finite-precision operations.
Independent 80-versus-120-place comparisons are evidence for the frozen corpus,
not a universal robustness or error bound. Exact binary64 signed-area fallback
removes only truly collapsed world-coordinate rings, preserving tiny nonzero
features without snapping or a fixed metre-sized cutoff.

The final point-query audit also exposed an inherited dimensional tolerance bug:
a tiny positive-area edge could classify distant ground as on its boundary.
Cross/dot tests now scale their length tolerance by edge length, and zero-length
edges cannot claim arbitrary points. The unchanged generated queries retain
before/after outcomes. Prepared edge data and conservative spatial bins reduce
rehearsal work; shared geometry is queried once while preserving every camera ID
and original order. No route samples or valid tiny features are discarded to
obtain the timing improvement.

| Visibility work counter | Per camera | Whole plan |
| --- | ---: | ---: |
| Wall-edge visits | 20,000 | 2,000,000 |
| Half-plane / Boolean operations | 4,096 | 12,000 |
| Input vertices visited | 2,000,000 | 4,000,000 |
| Output vertices observed | 600,000 | 1,200,000 |
| Vertices in one submitted/result geometry | 65,536 | 65,536 |

Wire validation separately limits 500 cameras, 65,536 vertices per camera,
1,200,000 unique vertices and 4,000,000 validation visits. It checks finite
coordinates, closure, winding, nonzero area, hole bounds, horizontal range,
camera order/IDs and unavailable-value contracts. These are bounded structural
checks, not a second full independent topology proof. Valid geometry can exceed
a budget and remain unestimated. Output costs are recorded after library return;
counters do not promise real-time execution inside a call.

Each worker has a ten-second monotonic response-acceptance deadline, rechecked
after validation. Cancellation closes the response gate before termination.
Render-time plan/attempt identity gates hide results even before replacement
effects run. Partial geometry withholds total coverage, route conclusions,
rehearsal proposals and installer export; it is never converted to zero coverage.
Coverage retains its separate per-zone/shared budgets documented in the
[earlier area record](../zone-area-math-2026-11-12/README.md).

## Consistent operator experience

- Map GeoJSON, selected-camera 3D, DORI lines and installer SVG preserve separate
  pieces and holes. The 3D image is an illustrative ground-view envelope.
- Coverage workers receive the accepted view snapshot. They do not recompute
  legacy fans. Identical geometry can be shared while different camera IDs still
  count as different cameras for overlap.
- Rehearsal retains the distance-spaced 2–601 positions and assumed 1.4 m/s pace.
  Prepared polygon queries reduce repeated edge work without changing samples
  or treating a missing view as a blind spot.
- Camera drag hides the changing view until release. Leaving camera editing or
  changing the plan, selection, view or floor cancels the old gesture; Undo that
  changes the plan also cancels it. A units refresh preserves the gesture.
- **Try views again** recovers failed estimates. Calculation adds no new editing,
  backup or Undo restriction; existing Save/Discard guards still apply. Installer
  export requires a clean saved plan
  and its complete accepted snapshot; a lookalike plan clone cannot borrow it.

## Independent evidence and reproduction

The [independent package](independent/README.md) retains frozen ideal-image and wall-shadow inputs,
analytical/rational checks, original baseline outcomes and raw disagreements.
The [consumer-review package](consumer-review/README.md) retains the separate 250-scene numerical corpus,
80/120 precision comparison, MultiPolygon adapter checks and query timings.
Each package supplies its own replay instructions and source hashes. Generated
inputs were frozen independently of candidate success; failed cases remain in
the corpus. Timings describe this local process, not target-hardware guarantees.

Final visibility source SHA-256:
`9207e0aeab51e2578cab9f3f82f28aa0fcd6cd3f1714a2bac5350a451587cf36`.

| Check | Recorded result | Scope |
| --- | --- | --- |
| Production build | Passed | Includes the retained large-chunk warning; prepares Sites layout |
| Full Node suite, socket fixtures enabled | 656 passed, 0 failed, 0 skipped | JavaScript and controlled local fixtures |
| Sites packaging | 4 passed, 0 failed, 0 skipped | Worker/build contract; no deployment |
| Targeted browser suite | 68 passed, 0 failed, 0 skipped | Playwright 1.56.1 / Chromium 141, 1440/375 px and existing editing/recovery flows |
| Independent wall oracle | 76,717 assertions, 0 failures | 42 generated scenes, independent rational areas/XOR and 3D line of sight |
| Independent production consumers | 39,075 assertions, 0 failures | Shared snapshots, distinct-camera areas, holes, route gaps and unavailable states |
| Raw ideal-circle gate | 365 assertions, 2 failures, strict exit 1 | Two exact-circle boundary points excluded by the declared inscribed polygon |
| Separate numerical corpus | 94,758 assertions, 0 failures | 250 unchanged scenes, 80/120 precision agreement and independent point queries |
| MultiPolygon coverage adapter | 3,900 assertions, 0 failures | 300 generated poses with holes, separate pieces and camera IDs |

Root replays of the packaged wall, consumer and raw ideal checkers reproduce the
independent receipt hashes exactly. Full Node/Sites/browser logs and root replay
receipts are retained in `checks/`. Full native Python, camera/inference browser
lanes, physical devices and representative recognition tests were not rerun for
this JavaScript/documentation change.

![Actual built preview showing a generated low-wall plan, 0% near-shadow coverage and 100% beyond-shadow coverage. No camera is connected.](manual-preview.jpg)

This direct built-preview check imported a generated plan as a separate facility,
kept Grid selected and inspected the blind overlay and coverage table. Existing
saves were retained. [Capture hashes and dimensions](screenshots.json) also bind
the desktop/mobile generated browser fixtures and unavailable/pending views.

Run application checks from a prepared checkout with Node 22:

```bash
npm ci
npm run build
DVR_TEST_SOCKETS=1 npm test
npm run test:sites
```

Playwright is separate from application dependencies. The
[developer guide](../../development.md#browser-regressions) describes the pinned
1.56.1 runner and Chromium setup. Browser fixtures use generated facility plans
and controlled failures; no physical camera or external map is required.

## Documentation and preservation

Canonical README, guide index, handbook, facility workflow, troubleshooting,
architecture, developer reference, science guide, status, roadmap, dependency
notices and evidence index are reconciled. Wiki pages are regenerated from those
sources. The [documentation inventory](documentation-inventory.json) records every public Markdown path outside this record and
classifies canonical guides, generated companions and dated evidence. Historical
receipts and screenshots retain their original bytes and interpretations.

The [preservation receipt](preservation.json) binds nine protected files, all 146
pre-existing lockfile package records, historical evidence and existing media.
Local links, graphics consistency, Wiki drift, all eight Wiki tests and whitespace
checks are recorded separately from application validation. Passing those checks
does not publish the separate GitHub Wiki or qualify installed behavior.

Primary references: [OpenCV pinhole model](https://docs.opencv.org/4.13.0/d9/d0c/group__calib3d.html),
[PBRT projective cameras](https://pbr-book.org/4ed/Cameras_and_Film/Projective_Camera_Models),
[polyclip-ts source](https://github.com/luizbarboza/polyclip-ts).
The ground/shadow derivation, limits and evidence policies above are specific to
this implementation.
