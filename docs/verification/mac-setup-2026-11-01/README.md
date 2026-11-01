# Mac source setup — November 1, 2026

[Verification index](../README.md) · [Mac setup and updates](../../setup-macos.md)

Base: `e073f281b04c2b2118a254b8ee60b5449b6ae958` (merged PR #70).
The changed setup/test sources are bound by [source-hashes.json](source-hashes.json).
The earlier local face-deletion/race fixes in `edge/local_service.py` and
`src/RecognitionReview.jsx` were already byte-identical to this base; they were
not reapplied or replaced. Historical qualification-bound inference, journal,
supervision, scheduler and profiling sources were not changed.

## Local checks

Apple silicon Mac, Python 3.12.15, Node.js 22.23.3. Runtime pins:
OpenCV headless 4.14.0.94, NumPy 2.5.4 and PyAV 19.0.2. ONNX 1.23.2 was added
only for generated fixtures; it is not an end-user runtime requirement.

- Frontend: **278 passed, 0 failed, 0 skipped**, including the explicit local
  socket check (`DVR_TEST_SOCKETS=1 npm test`).
- Packaging: **4 passed** (`npm run test:sites`).
- Python: **371 discovered, 258 passed, 113 skipped, 0 failed**. Skips explicitly
  retain Linux/Windows recorder, Linux recovery/qualification and other optional
  platform/runtime boundaries; these are not counted as Mac passes.
- Mac command syntax and Python compilation passed. Documentation and generated
  Wiki mirrors are checked with the repository's existing validators.
- The active installation's Check passed with `--skip-port-check`; the existing
  loopback service remained running. This does not assert port availability.

[Pretrained generated-clip receipt](pretrained-generated-clip.json) records the
three pinned model hashes/verification contracts exercised locally: the actual
YOLOX-S worker processed a generated three-second, 30-frame blank AVI, analyzed
6 samples and matched source bytes and decoded inventory. The face worker
loaded YuNet/SFace, checked six synthetic frames and found no usable faces;
SFace also produced a finite 128-value output for a synthetic aligned input.
This is runtime compatibility evidence, not recognition accuracy or enrollment
of a real person. No camera was connected.

[Model preparation](prepare-models.json) separately exercised fresh preparation
with all three actual pinned models, portable catalog validation and private
0600 file modes. An existing catalog is never replaced. Fault tests cover wrong
weights/labels, an incomplete face-model pair and interrupted catalog publication.

[Fresh-install summary](install-smoke.json) is produced by
`scripts/smoke-mac-install.py` in a disposable source folder whose path contains
spaces. It verifies hash-checked installation, repeat installation without changes
to fixture recordings/rules/templates/credentials, redacted readiness, native
generated-video/ONNX analysis, a second launch leaving the existing process alive,
a build-script change causing a rebuild, and stop/restart on the same port.
Its model emits constant boxes; this is a controlled software test.

One observed runtime diagnostic is that loading both bundled OpenCV and PyAV
libraries can print duplicate FFmpeg Objective-C class warnings on this Mac.
The native generated-clip/codec checks completed despite those warnings; no
endurance or crash-free operation claim follows from these short runs.

## Preservation and publication

The owner installations' complete local analysis folders and local source
settings were archived privately before repository edits, and the archive's
SHA-256 and expected entries were verified. The earlier webcam-tuning folder and
model provenance were retained in the active private folder. Original files and
the older installation remain available. No private paths, footage, biometric
templates, credentials, archive or runtime environment are part of this change.

Folder backups do not contain browser localStorage or IndexedDB. The update guide
requires separate browser exports, a stable browser/origin and export of temporary
last-job results before stopping the service. This session did not clear browser
storage, start a training capture or change enrollment consent.

The new [Mac CI workflow](../../../.github/workflows/mac-install.yml) runs these
install checks and the application tests on a GitHub-hosted Mac. Its status must
be read from the exact PR commit; local results above do not assert a completed
CI run. Existing Linux/Windows workflows remain separate regression gates.

These checks do not qualify physical-device compatibility, recognition accuracy,
sustained recording, anti-spoofing, power-loss recovery or 100-camera operation.
Mac analysis still has no address-space memory cap, and Linux last-job recovery
remains Linux-only.
