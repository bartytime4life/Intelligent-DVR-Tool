# One-camera recorder qualification — October 30, 2026

Baseline: PR #38 merge `96b485ea840bfe4f2ad73ff62c95262417e99e18`.
This change adds explicit one-camera segment capture using the existing RTSP
relay and OpenCV runtime, then the existing Jobs/Recognition workflow. It does
not establish physical-camera compatibility or operational recognition quality.

## Local checks

- 260 Python tests discovered: 254 passed, 6 socket-dependent tests skipped.
- Frontend suites run directly: 184 passed, 1 loopback test skipped. Direct runs
  avoid this environment's Node test-runner child output limitation.
- Production build passed. Native VP8 encoding, whole-file decode verification,
  actual CPU inference with the deterministic ONNX fixture, source/result hashing
  and persisted-pair recovery are exercised by `tests/test_lan_recorder.py`.
- Controlled failure checks cover disconnect/deadline/backoff, corrupt media,
  simulated disk exhaustion and write failures, interrupted capture/analysis,
  retention and queue drops, competing store owners, protected manual Linux
  last-job recovery, credential redaction and changed source/timing/results.

The automated native test uses generated pixels and a constant-output ONNX fixture.
A separate local smoke run used the actual pinned pretrained YOLOX-S on a generated
49-frame VP8 segment: 10 samples analyzed, completed state, matching source hash,
1.8 seconds elapsed on this execution host. This is not a physical camera, quality
evaluation or sustained throughput benchmark. Passing these checks proves pipeline
behavior, not YOLOX-S quality. The production profile and pinned weights are unchanged.

## CI and browser checks

The cross-platform workflow runs the Python suite with `DVR_TEST_SOCKETS=1` on
Linux and Windows. The recorder integration starts a controlled authenticated
RTSP/JPEG server, passes through the real pinned relay and native capture worker,
records WebM, runs native inference, checks HTTP boundaries, disconnects/restores
the upstream and reopens retained results after restart. Loopback camera sources
exist only inside these test fixtures; the production allowlist rejects them.

The browser workflow includes `playwright.recorder.config.mjs`: explicit start,
recording/analysis status, native segment review, playable source-matched footage,
reload without duplicate start, stop, lost-status recovery and a 390px layout.
Existing PC kit jobs still build, extract, install and launch on both operating
systems. Use the PR's exact-head CI results and artifacts; this document's local
results do not stand in for those jobs. They were pending when this record was authored.

This execution environment refuses loopback socket creation, so local RTSP/HTTP
and browser acceptance could not run. No physical camera was contacted. The
[one-camera acceptance checklist](../../lan-recording.md#one-camera-acceptance-before-expansion)
is required before deployment claims or expansion toward 100 cameras.

## Review corrections

GitHub review of the first candidate identified the inherited RTSP-only protocol
policy during local segment verification and retention running after queue
admission. Verification now explicitly selects file-only decoding and restores
the live policy; age expiration runs before analysis admission. Native regression
tests reproduce both conditions. A byte-budget test also verifies cleanup before
another segment reservation.
