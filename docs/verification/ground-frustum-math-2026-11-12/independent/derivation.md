# Independent mathematical reference

The existing radial footprint applied one near/far radius to every ray and used sensor horizontal FOV as a fixed ground-azimuth wedge. Tilt changes both relationships. Ordinary source-valid fixtures showed false visible and false blind points; nadir-crossing fixtures also lost ground below and behind the mount's horizontal heading.

## Ideal camera footprint

Let `X` be ground displacement to camera right, `Y` displacement along its horizontal heading, `z > 0` mount height, and `theta` downward tilt. Rotating the camera basis gives:

```text
optical depth D = Y cos(theta) + z sin(theta)
image-down   W = z cos(theta) - Y sin(theta)
```

With a centred rectilinear sensor, `a = tan(HFOV/2)` and `v = tan(VFOV/2)`, the ground point is inside the ideal image when:

```text
D > 0
|X| <= a D
|W| <= v D
X² + Y² <= R²
```

The last condition preserves horizontal range `R`. The other conditions are affine halfplanes on the ground. Their intersection with the range disk is convex before walls. It supports the whole validated tilt/FOV domain, including horizontal views, horizon rays, nadir-crossing views and ground behind the horizontal heading with positive optical depth.

For interpretation, vertical image bounds imply signed forward bounds:

```text
Ymin = z cot(theta + VFOV/2)
Ymax = z cot(theta - VFOV/2), when theta > VFOV/2
Ymax = infinity, otherwise
```

`Ymin` becomes negative after the bottom image crosses nadir. It is a signed forward coordinate, not a nonnegative radial distance. Affine inequalities avoid dividing by a near-zero horizon expression. The actual reference also uses independent orthonormal 3-D basis dot products and inverse image rays, rather than copying the application's footprint loop.

When the disk does not cut the four corners, direct integration of the half width `a * (Y cos(theta) + z sin(theta))` gives a separate trapezoid area check. For general unobstructed ideal areas the reference uses two different analytic calculations: polygon/circle Green's-theorem integration and horizontal-strip integration with quadratic line/circle crossings. Tangent-circle preparation mistakes were corrected and retained before any production candidate was evaluated.

## Opaque wall faces

For a target ground distance `d`, a vertical face at distance `s` along the same ray is intersected at height `z * (1 - s/d)`. A low wall can hide a finite interval while farther ground is visible over it; an elevated wall can leave a nearer view underneath. A single radial stop cannot represent both effects. Visible geometry can have holes and disconnected components.

The point reference uses exact rational 3-D segment/face-plane intersections and independent horizontal/vertical face coordinates. The area reference independently projects face corners from the camera onto ground. Unbounded upper projections are extended beyond the whole finite containing box with a provable power-of-two distance bound, then clipped rationally. It does not call the candidate's Boolean engine.

Every vertex and pairwise edge-intersection ordinate partitions the plane into slabs. Within a slab, horizontal crossing order is fixed and each endpoint is affine in height. Exact rational midpoint integration therefore gives exact area for the supplied polygonal boundaries. The same arrangement measures the symmetric difference over the entire returned MultiPolygon, including every hole and any misplaced part outside the expected footprint. A separate 3-D ray oracle crosschecks reference mask membership.

The range polygon is generated independently from 256 unit-circle vertices. The reference interprets each supplied binary64 coordinate and trigonometric coefficient as an exact rational. Small differences between independent floating constructions are assessed with the fixed pre-candidate numerical tolerance; this is not an exact-real arithmetic or optical-calibration claim.

## Concrete consequences

For height20m, tilt45°, HFOV90°, VFOV30° and horizontal range250m, the legacy fan reports a 1.44m² zone from `(7.7,9.1)` to `(8.9,10.3)` fully covered even though it lies outside the ideal sensor. Another 1.44m² zone from `(25,25)` to `(26.2,26.2)` reports no coverage while entirely inside. Associated routes and rehearsal classifications reverse as well.

For height4m, tilt75°, HFOV90°, VFOV60° and range50m, the true signed forward interval extends to about `-1.0718m`. A valid rear zone from `(-1,-1)` to `(1,-0.4)` is entirely inside the ideal image but excluded by the legacy wedge. The frozen corpora retain these examples and rigid rotations/translations.

The current consumer checks use distinct camera IDs with identical poses to test cache reuse and correct overlap counting across all components/holes. Exact route intervals independently check covered/overlap length and the longest continuous blind stretch. Resource-refused visibility remains unknown, with null metrics and geometry rather than a successful zero estimate.

The camera basis follows the [official OpenCV pinhole projection model](https://docs.opencv.org/4.13.0/d9/d0c/group__calib3d.html); the ground intersection and independent wall references are derivations for this study. All results are synthetic planning-model evidence. They do not establish calibrated optical coverage, field visibility, recognition quality, installed hardware performance or capacity.
