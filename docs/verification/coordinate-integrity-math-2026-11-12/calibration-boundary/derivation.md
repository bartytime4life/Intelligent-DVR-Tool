# Independent containment and projection reference

The defect is a mismatch between the stated no-extrapolation boundary and an area-valued tolerance. For an edge vector `e`, accepting a cross product down to `-epsilon` admits an outside strip of perpendicular width `epsilon / |e|`. Short edges therefore receive a larger image-space expansion. A separate absolute turn cutoff can remove a genuine extreme vertex and shrink the computed hull.

## Exact rational supporting lines

Each finite binary64 coordinate is an exact dyadic rational. The reference converts it with Python `Fraction(float)`, preserving that number rather than its printed decimal approximation. For every distinct input pair `a,b`, it computes the determinant `(b-a) × (p-a)` by exact rational arithmetic. Pairs whose lines leave all reference points on one side are supporting lines.

A convex combination of reference points stays on the permitted side of each supporting line. Conversely, a point outside a full-dimensional closed convex polygon violates one of its supporting edge lines. Enumerating all input-pair supporting lines therefore decides hull membership without constructing the application's monotone-chain hull. Boundary equality counts as inside. Collinear/coincident inputs have no full-dimensional measurement area and return false in this helper contract.

The supplement identifies extreme vertices independently as reference points incident to two nonparallel supporting lines. This preserves a genuine outward turn however small its exact nonzero determinant. A collinear or interior marker is not extreme.

## Binary64 orientation implementation assessment

For a normal finite binary64 value, the exact representation is signed integer significand times `2^(storedExponent - 1075)`; subnormal values use the integer fraction times `2^-1074`. Choosing the least exponent among nonzero coordinates puts every coordinate over one common positive power of two. The determinant's sign then equals the sign of an exact integer determinant. This explains why the candidate's BigInt predicate avoids floating multiplication overflow, underflow and cancellation when classifying the entered coordinates.

This is a sign argument, not a claim that entered markers represent exact physical locations. Separate fit-admission span, rank, horizon and independent-marker requirements still apply.

## Reported perspective counterexample

The short hull edge joins `(1, 0.9999)` and `(0.9999, 1)`. Query `(0.999954, 0.999954)` lies outside its closed halfplane. Using the exact binary64 inputs, its determinant is approximately `-8.000000000007119e-10`; the earlier `cross >= -1e-9` test accepts it. Its perpendicular outside displacement is approximately `5.65685425e-6` image fraction.

With homography `[0.01,0,0, 0,0.01,0, -1,-1,2]`, ground coordinates are `0.01 * (x,y) / (2-x-y)`. The denominator remains positive on the measured hull. Five fitting markers and a withheld check fit with small residuals, yet the outside query is admitted and yields a roughly 153.648m distance from `(0.9,0.9)`. Independent rational projection gives the intended mapping; a fixed pre-candidate numerical tolerance separately checks the fitted matrix's ruler values for accepted points. An outside point must remain unavailable regardless of the fit residual.

All transforms and nextafter perturbations are frozen before candidate execution. Expected classifications use the final binary64 coordinates, including any rounding from an affine transformation. No candidate result controls eligibility or a boundary exclusion.

The original 21 mistaken midpoint-holdout eligibility assumptions were corrected before candidate execution using the existing independent-marker separation rule and exact squared ground distances. They require refusal, remain in the corpus and retain their original preparation records. No valid-point expectation was weakened.

This reference covers synthetic planar coordinates. It does not establish optical calibration, distortion correction, physical measuring accuracy or field acceptance.
