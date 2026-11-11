# Track continuity across frame resizing — November 11, 2026

This follow-up starts from merged PR #107 at
`c0aee35c5e634e5bb2949f1002336c2cc3c71078`. Its file tree is exactly the reviewed
`bc1a1d9392aeed1d9b22a08237ca9ec61bb93be5` tree
(`bed51e0e1f689a2996a5988d66b7d0d1a4d0cca2`). No source or review threads were
changed during that merge. The current work is isolated on
`codex/tracker-frame-size-20261111`, with no installed-service changes.

## Reproduced problem

`Tracker.update` accepts normalized detections and the dimensions of each frame.
It previously converted every detection into that frame's pixels, while keeping
the previous Kalman state and last matched box in the old frame's pixel units.
The association therefore compared incompatible coordinates after a resize.

For normalized box `[0.6, 0.2, 0.1, 0.3]`, the 1280×720 first frame confirms ID 1.
The same box at 640×360 then loses its ID, and the old box is reported as
`[1.2, 0.4, 0.2, 0.6]`, outside the image. Even an empty resized frame distorts
the last matched box. A tentative track can also fail confirmation solely because
the frame size changed.

The [comparison receipt](comparison.json) contains actual generated-box and
native-worker outputs for the baseline and candidate. The native probe uses the
same generated constant-output ONNX fixture, OpenCV CPU backend and unchanged
worker for both cases, substituting only the baseline tracker loaded from Git.
It is not a benchmark or a test of a physical camera/detector's quality.

| Generated JPEG sequence | Baseline detection track | Candidate detection track |
| --- | --- | --- |
| 320×240 | 1 | 1 |
| 640×480 | Unconfirmed; ID 1 becomes lost | 1 |
| 160×120 | Detector rests, no detections | 1 |
| 960×720 | Detector rests, no detections | 1 |

In this particular still-scene fixture, lost continuity also made the motion gate
eligible to skip subsequent frames. With the coordinate repair, the tracked object
keeps the detector running under the existing policy. No motion-gate thresholds,
inference behavior or activation policy were changed.

## Coordinate repair

The first accepted frame defines fixed dimensions `(W0, H0)` for the run,
including when its detection list is empty. Every later normalized box is
converted using those same units:

```text
[x, y, w, h]_tracking = [xn*W0, yn*H0, wn*W0, hn*H0]
```

The Kalman mean, velocity, covariance and last matched box all stay in this
coordinate system. Reporting divides by the same `(W0, H0)`, so no repeated state
rescaling or uncertainty conversion is needed. Given the same first dimensions,
times and normalized detections, subsequent image dimensions cannot change any
tracker calculation. They are still checked against the existing type/range limits
before the fixed tracking dimensions are used. Decoding, model preprocessing and
returned live-frame dimensions continue to use the actual image size.

This is a coordinate-consistency guarantee for resized images. It does not infer
whether physical framing changed, undo cropping/rotation, calibrate geometry or
establish an object's identity. Existing expiry, score, confirmation, memory and
source-binding rules remain in effect.

The algorithm remains `bytetrack-style-iou-kalman-v2`; the summary convention and
track schema are unchanged. The changed tracker SHA-256 distinguishes this patch.
Old results remain readable; current-source evaluation still requires explicit
re-analysis when tracker bytes differ. Historical receipts were left intact.

## Verification

- Four new tracker regressions failed on the merged baseline and now pass:
  repeated size/aspect-ratio changes versus a fixed-size reference run, a lost
  box across an empty resized frame, an empty first frame followed by confirmation,
  and expiry followed by confirmation at a different size.
- The 60-frame paired sequence includes three classes, a missed frame, a low-score
  frame and new tentative tracks. IDs, active records, complete final summaries,
  Kalman means and covariances are exactly equal to the fixed-size run.
- The new native worker regression runs generated JPEGs through the actual
  constant-output ONNX CPU path and checks frame dimensions, detector cadence,
  one stable ID, one active track and normalized box agreement.
- All 48 focused tracker/evaluator tests pass. Full Linux checks pass with
  `DVR_TEST_SOCKETS=1`: 545 Python and 543 Node tests, no skips. Four Sites contract
  tests and three generated-camera native browser tests pass.
- Production build passes with the existing Facility Studio large-chunk warning.
  Documentation, generated Wiki-source and whitespace checks pass.
- [Source hashes](source-hashes.json) bind the tested implementation, regressions,
  comparison runner and unchanged protected runtime files. The live worker is
  also byte-identical to the merged baseline.

Use the prepared project Python/Node environments; build before the full Python
suite because one existing production-entry test needs `dist`:

```bash
npm run build
DVR_TEST_SOCKETS=1 python -m unittest discover -s tests -p 'test_*.py'
DVR_TEST_SOCKETS=1 npm test
npm run test:sites
DVR_BROWSER_CHANNEL=chrome npx playwright test --config=playwright.analysis.config.mjs live-ai.spec.mjs
python docs/verification/tracking-frame-size-2026-11-11/compare.py --output new-resize-comparison.json
python scripts/check-docs.py
python scripts/build-wiki.py --check
git diff --check
```

The comparison requires the trusted baseline in local Git history and creates
its output exclusively. It does not overwrite an existing file. Generated ONNX,
JPEG and video fixtures are temporary; no recording, camera, enrollment template,
credential, model download or installed application was accessed or changed.

## Hosted evidence remains separate

Merged PR #107's [cross-platform checks](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/43102486106),
[Mac source install](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/43102486863)
and [PC install kit](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/43102486880)
passed. At follow-up readback, the
[longer browser workflow](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/43102486404)
had passed both preflights and the general browser suite and was running native
synthetic analysis checks. This record does not call that workflow complete.

Those results belong to PR #107, not to this new patch. Neither merged source nor
CI installation on disposable runners establishes installation on the owner's
computer, physical-camera tracking accuracy, OEM compatibility, GPU execution,
durability or the 100-camera target. This follow-up needs its own review and CI.
