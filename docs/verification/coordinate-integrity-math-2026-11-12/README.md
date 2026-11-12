# Integrated planning mathematics and coordinate integrity — November 12, 2026

This record binds a local integration and documentation update. It is proposed
source, separate from merged main, platform installation, published Wiki,
deployment and physical-camera acceptance. All geometry, imagery and recordings
used by these checks are generated fixtures; no private media or camera was used.

## Source and scope

The work starts from [PR #122](https://github.com/bartytime4life/Intelligent-DVR-Tool/pull/122)
head `33fedd1bc364fc07cdb9331594aefef06bf52e6e` and locally integrates
[PR #117](https://github.com/bartytime4life/Intelligent-DVR-Tool/pull/117)
head `2122eed5a62d6f697f50e0148c3299cbf4769ce8` and
[PR #120](https://github.com/bartytime4life/Intelligent-DVR-Tool/pull/120)
head `6507638a56adfce873b70b98e2c0b60f0398bf12`.
Local integration checkpoint `220064faad8b0423e0a666d99a02755834fa1e32`
is context, not the identity of the subsequent uncommitted patch. Executed file
hashes in [source-manifest.json](source-manifest.json) bind that patch, tests,
lockfile and protected files. No hosted PR was merged by this integration.

The combined source includes the existing visible-ground, pixel-density,
zone-area, projective-calibration and image-diagnostics proposals. Earlier
[ground](../ground-frustum-math-2026-11-12/README.md),
[projective](../calibration-projective-math-2026-11-12/README.md) and
[image](../image-diagnostics-math-2026-11-12/README.md) records remain unchanged.
Two new reproduced coordinate defects are repaired without new controls,
dependencies, schema changes or automatic activation.

## Site corrections preserve boundary rooms

A valid rotated 15 × 10 m building with two rooms sharing its exterior walls
previously failed ordinary room containment after a roughly 7 m site-origin
correction. Per-vertex longitude/latitude round trips followed by micrometre
rounding broke collinearity. The original plan was valid, and an independently
derived unrounded affine grid change was valid; only the rounded result failed.

The correction uses one affine change of the existing equirectangular grid.
Every stored geometry/anchor follows that map; aperture widths follow its linear
wall-direction scale before translation. No containment tolerance is loosened.
Physical stair/camera sizes and poses keep their existing schema semantics.
Save site still validates, refuses unsupported/far coordinates without replacing
the saved plan, supports Undo and persists only the explicit accepted edit.
This is local planning geometry, not a geodesic or surveying guarantee.

[Portable reorigin evidence](reorigin/README.md) includes the exact public baseline
source, unchanged original receipt, independent affine calculation, strict
baseline/candidate replay, 100 supported-latitude partition cases, 80 successive origin changes and a final return,
full-plan metadata checks and desktop/phone Save/refusal/Undo/reload scenarios.

## Calibration refuses outside-reference measurements

For fitting markers `(0,0)`, `(1,0)`, `(1,.9999)`, `(.9999,1)`, `(0,1)`, the
point `(.999954,.999954)` lies outside the short diagonal boundary. The former
fixed cross-product tolerance admitted it. Under the independently specified
perspective map `(.01*u/(2-u-v), .01*v/(2-u-v))`, the ruler returned about
153.648 m outside the measured region, even though fitting and independent-check
residuals were tiny. A separate hull-construction epsilon erased small real
outward turns in otherwise valid reference sets.

Method `normalized-householder-dlt-v3` evaluates orientation exactly for the
entered finite binary64 coordinates using BigInt dyadic integers. The closed
reference hull has no outward tolerance, retains every nonzero extreme turn,
deduplicates equal coordinates and refuses malformed/sparse pairs. Existing
reference-span, independent-marker separation, rank, horizon, residual and
operator-declaration gates remain. The JSON schema is unchanged; earlier method
records remain historical and must not be relabeled as new evidence.

The [independent supporting-line reference](calibration-boundary/README.md) differs
algorithmically from the application's monotone-chain hull. Its frozen core
contains 200 helper scenes/12,120 membership queries and all 126 fit inputs:
105 valid fits plus 21 required distinct-marker refusals. The preparation's
mistaken eligibility assumption for those 21 inputs is retained openly; no
coordinates or orientation expectations were removed. Both former sources fail
4,711 of 15,195 assertions. Current source passes all 15,195. A separately frozen
30-case extreme-turn supplement passes 150 assertions; its baseline fails 12.

[Exact-orientation evidence](orientation/README.md) compares 2,707 generated
triples against Python Fraction signs under three permutations: 8,121 assertions
pass for the actual imported helper. Historical prototype receipts are separate.
This establishes arithmetic behavior on represented numbers, not optical or
physical accuracy. [Shewchuk's research](https://www.cs.cmu.edu/~quake/robust.html)
explains determinant-sign robustness; this implementation uses its own always-
exact BigInt method, not copied adaptive-expansion code. The
[ECMAScript Number model](https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-ecmascript-language-types-number-type)
is the representation basis.

## Combined-source verification

[validation.json](validation.json) records commands, versions, pass/fail/skip
counts and the browser-fixture correction. [integration-replays](integration-replays/)
contains new receipts against current source; old receipts were not rewritten.

| Check | Current result |
| --- | --- |
| Production build and Sites packaging | Pass; existing large-chunk warning retained |
| Full socket-enabled Node suite | 680 passed, zero failed/skipped |
| Sites tests | 4 passed, zero failed/skipped |
| Targeted browser checks | 75 passed in initial broad run; two new fixtures corrected and passed on focused rerun; zero skips |
| Exact calibration core / extreme turns | 15,195 / 150 assertions passed |
| Exact orientation | 8,121 assertions passed |
| Earlier projective oracle | 2,049 generated cases passed |
| Earlier Sobel oracle | 611 cases / 10,472 assertions passed |
| Independent wall geometry | 42 scenes / 76,717 assertions passed |
| Snapshot/coverage/route consumers | 42 scenes / 39,075 assertions passed |
| Extended wall arithmetic | 250 scenes / 94,758 assertions passed |
| Coverage adapter preservation | 100 scenes across three poses (300 cases) / 3,900 assertions passed |
| Raw ideal-circle reference | Strict exit 1 retained: two exact-circle boundary disagreements among 365 assertions |

The 256-sided inscribed range approximation deliberately differs from the true
circle at those two boundary points. The raw failing gate remains visible and is
not converted into a pass. Generated oracles cannot qualify optics, terrain,
actual site dimensions, recognition accuracy, GPU execution or 100-camera capacity.

## Documentation update

Canonical operator guides explain the two site-origin choices, valid-plane
measurement, unavailable image diagnostics and visible recovery. The home page,
guide index, capability status, roadmap, architecture, algorithms, developer
checks, troubleshooting and saved-plan guidance point to one current integration.
Generated Wiki pages follow their canonical sources. The dated screenshot atlas
retains its older collections and adds only source-bound new captures.

[documentation-inventory.json](documentation-inventory.json) inventories public
Markdown and separates current guides, generated Wiki, historical records and
new evidence. Unaffected setup, security, runtime and field-acceptance instructions
were checked rather than rewritten. Historical source hashes, measurements and
screenshots remain intact. [preservation.json](preservation.json) records parent-
source equality for earlier evidence and the nine protected runtime/hosting files.

Source-bound checks and regenerated Wiki source do not publish the separate
GitHub Wiki. This work installs no service, starts no camera/recording/inference,
downloads no model and changes no private runtime store. The prior PR #122 head has three successful workflows; its Mac workflow reports
failure with its sole job cancelled before any reported steps (logs unavailable).
The cancellation cause remains unverified. These runs do not validate the new
integrated patch. Hosted CI and main
readback are captured separately in [remote-state.json](remote-state.json).

## Reproduce the new checks

Use Node.js 22, Python 3.10+ and `npm ci` in an isolated checkout. Choose fresh
output paths and follow each package's README for baseline failures as well as
candidate passes:

```bash
node --test tests/planar-predicates.test.mjs tests/facility-calibration.test.mjs tests/facility-reorigin.test.mjs
node docs/verification/coordinate-integrity-math-2026-11-12/orientation/check-orientation.mjs --output /tmp/new-dvr-orientation.json --require-pass
node docs/verification/coordinate-integrity-math-2026-11-12/reorigin/replay.mjs --repo . --require-pass > /tmp/new-dvr-reorigin.json
```

The calibration-boundary package supplies its own portable adapter and commands;
its original checker bytes, expectations and strict exit conditions remain bound.
The [development guide](../../development.md) covers combined build, browser,
documentation, Wiki and platform checks. Full native Python/runtime suites and
physical-device acceptance were not repeated by this coordinate/documentation
slice; inherited historical evidence must not be called new execution.
