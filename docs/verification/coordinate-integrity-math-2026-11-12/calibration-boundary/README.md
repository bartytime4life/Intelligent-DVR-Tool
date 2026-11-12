# Independent calibration-boundary evidence

The candidate passes the unchanged synthetic containment/ruler corpus (15,195 assertions) and nonzero-turn supplement (150 assertions). Both earlier calibration versions fail the retained containment gate, and the PR117 supplement baseline loses real extreme vertices. [Results](results.json) bind executed source/helper hashes, immutable inputs, checker identities and full retained failures. The [derivation](derivation.md) explains the independent references and their limits.

This is numeric planning-model evidence. It does not establish optical calibration, survey accuracy, recognition quality, installed behavior, hardware throughput or field performance.

## Portable replay

Use Python 3.10+ and Node.js from a checkout at the revision under review. The commands run generated numbers only; no server, camera, recording or inference is started. No additional Python package is required.

From the checkout root:

```sh
CALIBRATION_EVIDENCE=docs/verification/coordinate-integrity-math-2026-11-12/calibration-boundary
python3 "$CALIBRATION_EVIDENCE/replay.py" verify
python3 "$CALIBRATION_EVIDENCE/replay.py" baseline-main --out /tmp/dvr-calibration-main-before
python3 "$CALIBRATION_EVIDENCE/replay.py" baseline-pr117 --out /tmp/dvr-calibration-pr117-before
python3 "$CALIBRATION_EVIDENCE/replay.py" baseline-turns --out /tmp/dvr-calibration-turns-before
python3 "$CALIBRATION_EVIDENCE/replay.py" candidate --repo . --out /tmp/dvr-calibration-after
python3 "$CALIBRATION_EVIDENCE/replay.py" candidate-turns --repo . --out /tmp/dvr-calibration-turns-after
python3 "$CALIBRATION_EVIDENCE/replay.py" reference --out /tmp/dvr-calibration-reference
```

Choose a fresh output directory per command. All three baseline commands deliberately exit **1** with retained failures. Both candidate commands and the independent reference regeneration exit **0** on the recorded source. An expected baseline failure is never converted to a passing strict result. New source bytes require a new replay.

Each ordinary run writes the unchanged mathematical checker's full `result/receipt.json` and observations. Its `replay.json` separately binds the packaging adapter, original checker, bundle manifest, executed source/helper bytes and observed strict exit. A checker's `sourceRevision` is checkout context; file hashes identify uncommitted candidate bytes. After a documentation commit, that context label may change even if executed numerical bytes and observations remain identical.

The `reference` command regenerates the original expectations, applies the explicit pre-candidate eligibility correction and regenerates the turn supplement. It compares every resulting input/expectation byte against the frozen artifacts. This uses independent Python rational arithmetic and no application geometry code.

## Frozen inputs and baselines

- [Core input corpus](data/inputs.json.gz): 200 helper scenes and 12,120 exact-membership queries; 126 fit inputs retained, consisting of 105 valid fits/735 ruler queries and 21 required reference refusals. Ordinary shapes, short edges, tiny positive-area and collinear controls, nextafter neighbors, permutations/duplicates and affine image/ground variants are included.
- [Core expectations](data/expected.json.gz) and [freeze receipt](data/freeze-receipt.json.gz): exact supporting-line hull membership; zero point exclusions. Numerical fit/ruler tolerances were fixed before candidate execution and never relax boundary membership.
- [Nonzero-turn inputs](data/turn-inputs.json.gz), [expectations](data/turn-expected.json.gz) and [freeze receipt](data/turn-freeze-receipt.json.gz): 30 valid affine fits checking the complete extreme-vertex set, including positive tiny turns and truly collinear/inward controls.
- `retained` includes full original and candidate receipts and observations. `baseline-source` contains only the two public calibration-module snapshots needed to replay earlier versions without unpublished Git objects.
- [preparation-v1.tar.gz](preparation-v1.tar.gz) retains all original preparation inputs, expectations, checkers and the first failing PR117 baseline. Twenty-one midpoint holdouts were initially presumed valid; their approximately 0.007071m separation from a fit marker violates the pre-existing 0.01m distinct-marker rule. The explicit v2 correction makes these required refusals. **Every original coordinate and case remains unchanged.** The correction was frozen before candidate execution.

The main and PR117 strict baselines each retain 4,711 failures: 4,216 direct memberships, 225 fitted memberships, 225 ruler-availability checks and 45 withheld-check classifications. Their 105 valid numerical fits and 21 required refusals pass. The PR117 turn baseline retains 12 failures among 150 assertions. Original v1's additional 21 mistaken eligibility failures remain visible in the preparation archive.

## Adapter and byte preservation

All mathematical checker, runner and generator bytes are stored unchanged in `frozen` as deterministic gzip files. The adapter expands them to their original filenames before execution. Every gzip has modification time zero and no embedded filename. [bundle-manifest.json](bundle-manifest.json) binds both compressed and decoded bytes, plus every other packaged artifact.

The separate [replay adapter](replay.py) changes storage/source transport only. It supplies hash-verified packaged baseline source and recorded Git context. The original turn checker predates the newly imported predicate helper and snapshots only its main module; the adapter copies imported helper bytes beside that original snapshot and records their hashes in the companion replay receipt. The primary checker already snapshots and binds relative imports itself. **No mathematical code, expected value, tolerance, input eligibility or strict exit gate is patched by the adapter.**

Portable baseline receipts and observations reproduce their retained originals byte for byte. Candidate observations also reproduce the original runs. `results.json` carries both candidate source hashes because the original supplement receipt alone binds only its main calibration module; its imported predicate is separately transport-bound.

## Concrete consequence and limits

The [exact counterexample](data/counterexample-proof.json.gz) has a query just outside a short fit-hull edge. Its exact binary64 determinant is negative, but the earlier fixed `-1e-9` threshold admits it. A well-fitted perspective transform then returns an approximately **153.648m** ruler result beyond the measured hull. Other fixtures show genuine positive turns being discarded even while reference errors remain low.

The contract classifies the supplied binary64 coordinates inside a **closed** convex hull. It does not estimate marker-placement uncertainty, recover unrounded coordinates, model lens distortion or infer ground truth from a good fit. Some direct-helper shapes are too small for fitting's separate admission rules; they are helper tests, not claims of valid calibration reference sets. Metamorphic fixtures are reclassified from their actual rounded coordinates rather than assuming that a boundary remains exactly invariant after floating-point transformation. Finite-corpus success is not a universal metrology or numerical-error guarantee.
