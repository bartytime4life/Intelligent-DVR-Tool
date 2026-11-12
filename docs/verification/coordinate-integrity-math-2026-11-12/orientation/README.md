# Exact orientation review

This package tests the **actual** finite-coordinate orientation helper separately
from the standalone proposal prototype. Both use exact integer arithmetic on the
binary64 numbers entered into JavaScript. It does not test physical marker
accuracy, measurement uncertainty, the homography solver or camera performance.
The [parent record](../README.md) covers the coordinate-integrity integration.

Actual source at this freeze:

- [planar-predicates.mjs](../../../../src/planar-predicates.mjs):
  `50101ba8edd52a893cddf71557f9338abd251451a7ba372777e2607f7cb303e9`.
- [facility-calibration.mjs](../../../../src/facility-calibration.mjs), method
  `normalized-householder-dlt-v3`:
  `6dd984785eb2b348d72c8df19b695d3d687165f1e841a8d12d0b422252a6b9e7`.

[The manifest](manifest.json) records package, decompressed fixture and source
hashes. Receipts also record the calibration file as source context; the sign
checker does not execute its fitting or ruler methods.

## Frozen independent expectations

The [input corpus](inputs.json.gz) and [expected signs](expected.json.gz) were
written before the actual application helper existed. There are 2,707 triples:
seven explicit boundary/degenerate/extreme cases, 2,000 seeded full-exponent
finite binary64 cases and 700 repeated-point/collinear cases across seven scales.
Every expected sign uses Python standard-library `Fraction.from_float` arithmetic,
independent of JavaScript bit decoding or the candidate helper.

The checker tests each triple, its reversed orientation and a cyclic permutation:
**8,121 assertions**, with no tolerance. The decompressed digests are:

| Fixture | SHA256 |
| --- | --- |
| Inputs | `053566499b241abc8a3135a4e9b0b3c6b046f2b64f5968ebbd3db9f032dba0a5` |
| Expected signs | `268d2b4c4c9f14f52fbda9e224fa52609f7afaa9e1bbdf482a91fb347825c12a` |

Both gzip files have `mtime=0`; compression preserves the original decompressed
bytes. No case was removed or changed after executing the candidate.

## Replay

From the repository root with Node 22:

```bash
node docs/verification/coordinate-integrity-math-2026-11-12/orientation/check-orientation.mjs --require-pass
node --test tests/planar-predicates.test.mjs
```

The first command writes a receipt to the operating system's temporary directory
and prints a small summary. `--output PATH` chooses another receipt file.
`--require-pass` exits nonzero after writing the receipt if an assertion fails or
source changes during replay; without the flag failed assertions remain a
receipt with diagnostic exit zero. Unreadable input or runtime errors still fail.
Decompressed input hashes are checked before computation.

The [actual-helper receipt](actual-helper-receipt.json) records **8,121 assertions,
zero failures**, and unchanged source bytes. The [focused TAP](focused-tests.tap)
records two passing unit tests for arithmetic extremes and malformed pairs,
including sparse arrays, with zero failures/skips.

For optional expectation regeneration, Python 3 needs no extra packages:

```bash
python docs/verification/coordinate-integrity-math-2026-11-12/orientation/make-cases.py --output-dir orientation-regenerated
```

Choose an empty output directory. It writes `inputs.json` and `expected.json`
there and prints their hashes; these must match the table above. The packaged
generator was replayed and produced those exact bytes.

## Prototype history stays separate

[prototype.mjs](prototype.mjs) retains the exact standalone source
`d492a968854cb2274c9c8ad58c70742d57821d4a6309830e7d12a53e39658595`.
It is a historical proposal with no public invalid-input guard. It also runs a
small diagnostic timing loop when imported. Replay only its valid-coordinate
sign contract with:

```bash
node docs/verification/coordinate-integrity-math-2026-11-12/orientation/check-orientation.mjs --prototype --require-pass
```

The original [prototype receipt](historical-prototype-receipt.json) and portable
[prototype replay](prototype-replay-receipt.json) each record 8,121 passing sign
assertions. The actual application receipt is a separate run against the new
helper, not a renamed prototype result.

The earlier [review-wrapper receipt](historical-review-wrapper-receipt.json)
records 8,132 assertions: the same 8,121 signs plus 11 invalid-input checks on a
separate guarded review prototype. Its local timing observations remain history;
they are not application-helper results or latency guarantees. Actual malformed
input behavior is covered by the focused tests above.

## Proof review and remaining limits

For a finite binary64 coordinate, write `x = M * 2^e`. Normal numbers use the
implicit leading bit and `e = exponent_bits - 1075`; subnormals use their fraction
bits and `e = -1074`. Signed zero has zero mantissa. Choose the smallest exponent
among nonzero coordinates and shift every mantissa onto that common integer grid.
The determinant

```text
(AX - OX) * (BY - OY) - (AY - OY) * (BX - OX)
```

then differs from the represented-coordinate determinant only by a positive
power-of-two scale. Its sign is exact. An all-zero triple returns zero directly.
Across all finite binary64 values, the largest shift is 2,045 bits; coordinate
integers need at most 2,098 bits and the determinant at most 4,199 bits. Current
calibration fitting accepts at most 24 references, so its hull work is small.
No floating-point filter, approximate orientation epsilon, new dependency or
large cache is needed for these predicates.

Read-only source review confirms explicit finite coordinate-pair validation,
duplicate-point removal, exact monotone-chain turns and closed hull membership.
Signed zero duplicates compare as the same point. Invalid vertices are refused,
and fewer than three distinct non-collinear hull points cannot authorize a ruler.
Rank/conditioning, span, horizon, reference separation and fitting/withheld error
gates remain separate. An exact predicate does not repair coordinates already
rounded by input, normalization or a geographic projection; it does not inflate
the hull to represent uncertain measurements.

[Shewchuk's robust-predicate reference](https://www.cs.cmu.edu/~quake/robust.html)
explains determinant-sign failures and exact/adaptive approaches. This helper is
a direct bounded BigInt dyadic construction, not a port of his expansion code.
