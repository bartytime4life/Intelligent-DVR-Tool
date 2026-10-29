# Local analysis service qualification — October 29, 2026

Baseline: main `9294482ed38e025e413c3d735408b585b8ea7572`, including merged
PR #25. All 280 tracked files matched their Git blob hashes in a new working
snapshot. Previous workspaces and recordings were preserved.

The implementation adds one bounded loopback CPU job service and browser controls.
It reuses the existing analyzer, rule engine, review JSON parser and source matcher.
It does not establish live deployment, tracking, independent accuracy or camera
capacity. See [service behavior and limits](../../local-analysis-service.md).

Local focused tests initially passed 13 Python cases with one HTTP case skipped,
and seven new JavaScript contract cases. The native synthetic test ran the real
CPU worker and analyzer, producing six sampled frames and one rule observation.
The fixture is a constant ONNX output on generated pixels, not recognition quality.

An explicit local HTTP test failed at socket creation with `PermissionError:
Operation not permitted`. The environment forbids IPv4 loopback listeners. This
restriction was not changed or bypassed. HTTP and browser acceptance therefore
runs in GitHub CI and is reported separately in the pull request. No private
footage is sent there.

Final full-suite results and source revision are recorded in the pull request.

## Integrated qualification

Initial implementation head `7ac6db21e04ebf1d8a103a55cf2d91aac7433445` passed:

- [Linux and Windows CI](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/40893297619):
  88 frontend plus four packaging passes per OS; Python 157 passes on Linux,
  112 passes and 45 platform-specific skips on Windows. Includes real loopback
  Host/origin/token/path tests and the bounded native synthetic CPU worker.
- [Chromium](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/40893297334):
  all 18 existing scenarios plus five local-analysis scenarios, zero retries.
  Two new scenarios use actual HTTP/native inference; three inject transport or
  result faults to verify cancellation, reconnect, process errors and wrong-source
  rejection. Generated pixels and constant model only.
- [Browser evidence](https://github.com/bartytime4life/Intelligent-DVR-Tool/actions/runs/40893297334/artifacts/12905951876):
  desktop and 390 px mobile screenshots inspected. Controls wrap within the
  viewport; source-matched boxes, sampled counts, failure and cancellation states
  are present. This is a synthetic screenshot review, not novice/operator study.

The follow-up adds actual child-process cancellation/reaping coverage, clearer
terminal status text and elapsed time while a worker initializes. Final-head CI
is linked in the pull request; the initial results above are revision-bound.

Two additional **local trained-model** checks used the pinned YOLOX-S hash
`c5c2d13e59ae883e6af3b45daea64af4833a4951c92d116ec270d9ddbe998063` on copies
of existing reference excerpts (31 and 50 decoded frames). Jobs completed with
seven and ten sampled frames; both returned review bundles passed the existing
JavaScript parser. These excerpts emitted no detections or observations at the
analyzer's thresholds. This proves worker/contract integration, not a true-negative
or recognition-accuracy result. No clips, weights or detailed bundles were sent
to GitHub. The API/browser tests above remain separate from these socket-free
trained-model executions. No performance or target-camera capacity is inferred.
