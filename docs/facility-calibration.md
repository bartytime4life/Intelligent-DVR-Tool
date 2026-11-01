# Calibrate a camera image to a measured ground plane

[Facility Studio](facility-image-diagnostics.md) · [Field-acceptance runbook](field-acceptance.md) · [Visual atlas](visual-atlas.md) · [Security boundary](../SECURITY.md)

![Schematic showing sampled camera image points 1-4 and independent check C mapped to a single measured ground plane.](media/current/facility-science.svg)

*The points are illustrative labels, not an observed survey, measured error estimate or genuine-camera result. Use at least four well-spaced references and a separate withheld marker in a real test.*

## Purpose and evidence boundary

The experimental **Ground-plane calibration** panel links coordinates in **one frozen camera image** to points on a **single independently measured flat facility plane**. It is intended to help site engineers compare planned camera footprints with actual reference markers. It does not calibrate a camera lens, recover 3D depth, locate an elevated person or object, prove recognition accuracy, or create a survey-grade digital twin.

The solver uses a normalized, Householder-QR planar homography (eight degrees of freedom). This relates two planes under a perspective projection; see the [OpenCV homography overview](https://docs.opencv.org/4.13.0/d9/dab/tutorial_homography.html). It is deterministic and runs in the local browser with no subscriptions, model inference, camera activation, upload or remote service.

## Operator workflow

1. Open **Facility → Cameras**, select a camera and **Image diagnostics**. Freeze an explicitly connected source, open a local still, or pause an approved local recording and freeze a frame. The source is sampled to at most 720 pixels on the longest side.
2. Expand **Ground-plane calibration**. Select four or more distinct, well-spaced markers actually lying on the same known plane. For each, click **Mark image** and the corresponding pixel in the frozen frame, or type image X/Y percentages. Image marker circles may also be dragged.
3. Supply **East metres** and **North metres** from measured facility-plan coordinates. Type values directly or click **Pick on map**, then click the matching marker in the facility map. **A map click is only a coordinate suggestion**, not a survey measurement. The person conducting the work must verify the physical marker position independently.
4. Provide at least one extra, **independent check point** which is never used to solve the homography and must lie inside the fitting-point boundary.
5. Click **Compute planar transform**. Review separately reported fitting RMSE and independent-check RMSE/maximum in metres. No calibration acceptance is implied by a small fitting RMSE.
6. Confirm that the points were independently measured and share a plane; choose a **maximum acceptable independent-check error** based on the project's measurement needs. Ground-plane measurement is unlocked only if **both fitting and withheld-check maximum errors** are within the operator's chosen threshold and the check lies inside the fitting hull.
7. Use **Measure within reference boundary** for a two-point same-plane distance, or enter sampled-image start/end X/Y percentages. Extrapolation beyond the fitting-point convex hull is refused. Results are an estimate and remain sensitive to lens distortion, optical focus, marker error and perspective.
8. **Export calibration JSON** explicitly to keep the transform, references, selected tolerance, check residuals, plane declaration, camera/plan identity and SHA-256 of the **sampled RGBA pixels**. This is **not** a fingerprint of original recording bytes. Calibrations are in browser memory and are discarded on changing the image, camera or session; the exported metadata is editable and unsigned.

## Safety and validity rules

| Area | Behavior |
| --- | --- |
| Geometry | Requires 4–24 points, at least four fits, no duplicate/near-coincident fitting or check markers, adequate width and height of both planes, no projective horizon through the fitted region, stable finite homography and in-bounds image/ground coordinates |
| Validation | Fit and independent held-out error reported separately; a check outside the fitting hull cannot authorize measurement |
| Ruler | Only on the selected plane, only inside the fitted reference hull, only after user declaration and explicit residual tolerance |
| Bounds | Image coordinates are fractions of the downsampled frame; facility coordinates are local east/north metres within ±2 km |
| Provenance | Sampled RGBA SHA-256, original/sample image dimensions, selected camera/plan, method, reference pairs, residuals and operator declaration; no credential fields or video |
| Persistence | No automatic calibration save to the facility plan; no automatic upload/recording/inference or identity tracking |
| Claim | **Experimental planning estimate.** No independent lens/ground accuracy, physical camera acceptance, calibration standard, or real-world safety compliance claim follows from a synthetic test |

## Verification gates

The `tests/facility-calibration.test.mjs` suite uses known synthetic perspective transforms, noisy held-out references, singular/collinear/duplicate points, bounds and extrapolation refusals. Facility Playwright tests cover reference entry, withheld checks, plane-only measurement and map-coordinate selection. Source/CI tests cannot qualify physical marker accuracy.

For field acceptance, use five or more measured, visible markers on a permitted real camera, record camera model/lens/codec/focus, original source frame and coordinate measurement method, and reserve one or more markers for withheld checks. Compare estimated distances against separately measured dimensions and report p50/p95/max error, not just the fitted residual. Repeat after moving or changing the camera or stream resolution. Do not claim field calibration before this evidence exists.
