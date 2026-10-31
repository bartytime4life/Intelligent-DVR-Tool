# Saved-recording enhancement: bounded local verification

Checked October 30, 2026 local time, against the sharpening-comparison worktree
based on `5f11794cc91f1a37379aaad85b2de79b88a73c03`. These are software checks,
not installed-version, physical-camera, accuracy or capacity acceptance.

| Check | Result and scope |
| --- | --- |
| Python regression | 270 discovered; 264 passed, six socket tests skipped because the local execution sandbox refuses loopback sockets. Includes six new comparison tests. |
| Frontend regression | 188 discovered; 187 passed, one socket-dependent test skipped. Executed with Node 22's `--experimental-test-isolation=none` so individual test results were visible in this restricted environment. |
| Packaging adapter | Four Sites adapter tests passed. Production build emitted both client/server artifacts; existing large-chunk notice remains. |
| Documentation | Local-link/media/evidence checks and generated wiki-mirror check passed. |
| Native transform and worker | Generated edges passed source preservation, deterministic pixel change, native constant-ONNX handoff, separate detections, metadata validation and Linux recovery without replay. |
| Failure behavior | Rejected unknown/invalid metadata, orphan/missing samples, excessive detections, invalid boxes/hashes, transform failure, controlled output disk exhaustion and output collisions. Partial results remain partial. |
| Evaluation arithmetic | Intentionally worse candidate predictions retain their misses and separate metrics. Original metrics and rule observations remain unchanged; empty labels/coverage yield undefined metrics. |
| Real pinned detector | OpenCV Zoo YOLOX-S processed 30 generated frames / six paired samples. [Sanitized metadata](generated-model-smoke.json) binds source/model/implementation hashes. Original detections and rules matched a separate baseline; source bytes stayed unchanged. |

The pinned-model smoke uses generated shapes, not representative people or
vehicles. Its extra candidate detections are not an accuracy improvement. Local
native runtime: Python 3.12, OpenCV 4.13.0, NumPy 2.5.4, ONNX 1.23.2; no new
dependency or model installation. Timings in the generated-source receipt are
sequential samples, not randomized benchmarks or camera lag.

The browser suite adds an explicit paired native job and a controlled different-
detection overlay/import case, including mobile width and CSV download. Local
browser/HTTP execution is blocked by the socket restriction; fresh Linux/Windows,
browser and installation CI results belong to the review commit, not these local
counts. Physical-camera accuracy and neural restoration remain unqualified.

Reproduce with `python -m unittest discover -s tests -p 'test_*.py'`, `npm test`,
`npm run build`, `npm run test:sites`, `python scripts/check-docs.py` and
`python scripts/build-wiki.py --check`. On a host allowing sockets, set
`DVR_TEST_SOCKETS=1`; run browser checks with the existing Playwright analysis
configuration and its optional dependencies. No camera activation is required.

See [workflow, provenance, candidates and acceptance](../../enhancement-comparison.md).
